import { GoogleGenAI } from "@google/genai";
import type { z } from "zod";
import { config } from "../config.js";

let ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!ai) ai = new GoogleGenAI({ apiKey: config.llm.apiKey });
  return ai;
}

/**
 * 무료 모델은 시간이 지나면 폐기됩니다(예: gemini-2.5-flash 는 신규 키에 404).
 * 후보를 순서대로 시도하고, 전부 실패하면 API 목록에서 사용 가능한 flash 모델을
 * 자동 탐색해 자가 복구합니다.
 */
const MODEL_CANDIDATES = [
  config.llm.model, // 사용자가 GEMINI_MODEL 로 지정했으면 최우선
  "gemini-3-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
].filter((v, i, a) => !!v && a.indexOf(v) === i);

let workingModel: string | null = null;

function isModelMissing(err: unknown): boolean {
  const status = (err as { status?: number; code?: number })?.status ?? (err as { code?: number })?.code;
  const msg = String((err as { message?: unknown })?.message ?? err);
  return status === 404 || /not[_ ]?found|no longer available|not supported/i.test(msg);
}

async function generateText(system: string, user: string, temperature: number): Promise<string> {
  const cfg = { systemInstruction: system, responseMimeType: "application/json", temperature };
  const tryModels = workingModel ? [workingModel] : [...MODEL_CANDIDATES];

  let lastErr: unknown;
  for (const model of tryModels) {
    try {
      const res = await getAI().models.generateContent({ model, contents: user, config: cfg });
      if (workingModel !== model) {
        workingModel = model;
        console.log(`  🤖 Gemini 모델: ${model}`);
      }
      return res.text ?? "";
    } catch (e) {
      lastErr = e;
      if (isModelMissing(e)) continue; // 다음 후보 모델 시도
      throw e; // 그 외 오류(인증/할당량 등)는 그대로
    }
  }

  // 후보 전부 실패 → 계정에서 쓸 수 있는 flash 모델 자동 탐색
  const discovered = await discoverFlashModel();
  if (discovered) {
    const res = await getAI().models.generateContent({ model: discovered, contents: user, config: cfg });
    workingModel = discovered;
    console.log(`  🤖 Gemini 모델(자동탐색): ${discovered}`);
    return res.text ?? "";
  }
  throw lastErr ?? new Error("사용 가능한 Gemini 모델을 찾지 못했습니다.");
}

async function discoverFlashModel(): Promise<string | null> {
  try {
    const pager = await getAI().models.list();
    const names: string[] = [];
    for await (const m of pager) {
      const name = (m.name ?? "").replace(/^models\//, "");
      const actions = m.supportedActions ?? [];
      const supportsGenerate = actions.length === 0 || actions.includes("generateContent");
      if (name.includes("flash") && supportsGenerate) names.push(name);
    }
    return (
      names.find((n) => !/lite|preview|exp|thinking|image|live|tts|audio/.test(n)) ??
      names.find((n) => !/image|live|tts|audio/.test(n)) ??
      names[0] ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * 구조화된 출력 생성 헬퍼 (Google Gemini 무료 등급).
 * JSON 모드로 응답을 강제하고 zod 로 검증합니다. 파싱 실패 시 재시도.
 */
export async function generateStructured<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: string;
  temperature?: number;
  maxRetries?: number;
}): Promise<z.infer<S>> {
  const { schema, system, user, temperature = 1.1, maxRetries = 2 } = opts;
  const sys =
    system + "\n\n반드시 유효한 JSON 하나만 출력해라. 코드블록 표시나 설명 문장은 넣지 마라.";

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const text = await generateText(sys, user, temperature);
    try {
      return schema.parse(JSON.parse(stripFences(text)));
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Gemini 구조화 출력 실패 (${maxRetries + 1}회 시도): ${String(lastErr)}`);
}

/** 모델이 ```json 펜스로 감싼 경우 제거 */
function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

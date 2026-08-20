import { GoogleGenAI } from "@google/genai";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { config } from "../config.js";
import { loadGeminiModel, persistGeminiModel } from "./geminiModel.js";

let ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!ai) ai = new GoogleGenAI({ apiKey: config.llm.apiKey });
  return ai;
}

/**
 * 무료 모델은 시간이 지나면 폐기됩니다(2026-08 실측: gemini-2.0-flash·gemini-2.5-flash·
 * gemini-2.5-flash-lite 모두 신규 키에 404 "no longer available"). 후보를 순서대로
 * 시도하고, 전부 실패하면 API 목록에서 사용 가능한 flash 모델을 자동 탐색해 자가 복구합니다.
 * ★models.list() 가 이미 죽은 모델을 여전히 목록에 올려주는 경우가 있어(실측 확인:
 * gemini-2.5-flash 가 목록엔 있지만 generateContent 는 404), discoverFlashModel() 은
 * 하나만 고르지 않고 순위가 매겨진 후보 목록을 돌려준다 — 1순위가 죽어 있어도
 * 2·3순위를 이어서 시도해 정적 목록까지 떨어지지 않게 한다.
 */
const MODEL_CANDIDATES = [
  config.llm.model, // 사용자가 GEMINI_MODEL 로 지정했으면 최우선 (기본값은 실측 확인된 gemini-flash-latest)
  "gemini-flash-lite-latest",
].filter((v, i, a) => !!v && a.indexOf(v) === i);

let workingModel: string | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number; code?: number })?.status ?? (err as { code?: number })?.code;
}
function isModelMissing(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err);
  return statusOf(err) === 404 || /not[_ ]?found|no longer available|not supported/i.test(msg);
}
function isRateLimited(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err);
  return statusOf(err) === 429 || /rate|quota|RESOURCE_EXHAUSTED/i.test(msg);
}
/** 일시적 서버 혼잡(503 UNAVAILABLE / 500). 잠시 후 또는 다른 모델로 재시도 가능. */
function isTransient(err: unknown): boolean {
  const s = statusOf(err);
  const msg = String((err as { message?: unknown })?.message ?? err);
  return s === 503 || s === 500 || /UNAVAILABLE|high demand|overloaded|internal error/i.test(msg);
}
/** 재시도해볼 가치가 있는 오류(한도·혼잡·모델없음) — 인증 오류 등은 즉시 실패 */
function isRetryable(err: unknown): boolean {
  return isRateLimited(err) || isTransient(err) || isModelMissing(err);
}

// 라운드별 대기: 1라운드는 대기 없이 전 모델을 즉시 한 번씩 시도 → 작동 모델을 초 단위로 발견
const ROUND_BACKOFF_MS = [0, 8000, 25000, 50000];

/**
 * 출력 상한.
 *
 * 16k 로는 롱폼 대본이 잘렸다(2026-08-19 실측: "Unterminated string in JSON").
 * 최신 Flash 계열은 생각(thinking) 토큰도 이 상한에서 함께 빠져나가므로, 본문이
 * 3,000자쯤 되는 롱폼에서는 생각이 예산을 먹고 JSON 이 중간에서 끊긴다.
 * 무료 등급은 토큰당 과금이 없어 상한을 열어도 비용이 늘지 않는다(실사용분만 소비).
 * 상한을 못 받는 구형 모델을 만나면 아래에서 자동으로 낮춰 다시 부른다.
 */
const MAX_OUTPUT_TOKENS = 65536;
const FALLBACK_OUTPUT_TOKENS = 16384;

/** 모델이 상한 자체를 거부하는가 (구형 모델은 8k 고정) */
function isTokenLimitRejection(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err);
  return statusOf(err) === 400 && /max_output_tokens|maxOutputTokens|output token/i.test(msg);
}

async function generateText(
  system: string,
  user: string,
  temperature: number,
  jsonSchema: Record<string, unknown>,
): Promise<string> {
  const cfg = {
    systemInstruction: system,
    responseMimeType: "application/json",
    responseJsonSchema: jsonSchema, // 스키마를 강제해 필수 필드 누락 방지
    temperature,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  };
  let candidates: string[];
  if (workingModel) {
    candidates = [workingModel, ...MODEL_CANDIDATES];
  } else {
    // 콜드 스타트(매 실행이 새 프로세스). 정적 후보 목록이 이미 죽어 있으면 매번
    // 실제 생성 호출을 낭비한다. 지난 실행에서 성공을 확인한 모델을 먼저 시도하고,
    // 기록이 없으면 라이브 탐색(models.list — 생성 호출이 아니라 별도 한도라 무해)
    // 으로 지금 쓸 수 있는 모델들을 순위대로 앞에 둔다. 목록의 1순위조차 실제로는
    // 죽어 있는 경우가 있어(models.list() 와 generateContent() 불일치, 실측 확인)
    // 여러 개를 앞에 깔아 하나만 믿지 않는다.
    const persisted = await loadGeminiModel();
    const preferred = persisted ? [persisted] : await discoverFlashModel();
    candidates = [...preferred, ...MODEL_CANDIDATES];
  }
  candidates = candidates.filter((v, i, a) => !!v && a.indexOf(v) === i);
  const dead = new Set<string>(); // 404(존재하지 않음) 모델은 이후 라운드에서 건너뜀

  let lastErr: unknown;
  for (let round = 0; round < ROUND_BACKOFF_MS.length; round++) {
    const wait = ROUND_BACKOFF_MS[round];
    if (wait > 0) {
      console.log(`  ⏳ Gemini 전 후보 혼잡/한도 — ${wait / 1000}s 후 재시도 (라운드 ${round + 1})`);
      await sleep(wait);
    }
    for (const model of candidates) {
      if (dead.has(model)) continue;
      try {
        let res;
        try {
          res = await getAI().models.generateContent({ model, contents: user, config: cfg });
        } catch (e) {
          if (!isTokenLimitRejection(e)) throw e;
          // 이 모델은 큰 상한을 못 받는다 — 낮춰서 한 번 더
          res = await getAI().models.generateContent({
            model,
            contents: user,
            config: { ...cfg, maxOutputTokens: FALLBACK_OUTPUT_TOKENS },
          });
        }
        if (workingModel !== model) {
          workingModel = model;
          console.log(`  🤖 Gemini 모델: ${model}`);
        }
        await persistGeminiModel(model).catch(() => {});
        // 잘려서 돌아오면 JSON 파싱 실패로만 드러나 원인을 알 수 없다 — 여기서 밝힌다
        const reason = res.candidates?.[0]?.finishReason;
        if (reason && String(reason) !== "STOP") {
          console.warn(`  ⚠️ Gemini 응답이 정상 종료되지 않음 (finishReason=${reason})`);
        }
        return res.text ?? "";
      } catch (e) {
        lastErr = e;
        // 왜 이 후보가 실패했는지(없음/한도/일시적/기타) 남겨야 어느 모델이
        // 실제로 얼마나 여유가 있는지 판단할 수 있다 — 안 남기면 항상 마지막
        // 후보에 정착하는 이유를 알 길이 없다.
        const reason = isModelMissing(e)
          ? "모델 없음"
          : isRateLimited(e)
            ? "한도 초과"
            : isTransient(e)
              ? "일시적 오류"
              : "기타";
        console.log(
          `  ⏭️  ${model} 실패(${reason}): ${String((e as { message?: unknown })?.message ?? e).slice(0, 150)}`,
        );
        if (isModelMissing(e)) {
          dead.add(model); // 존재하지 않는 모델 — 재시도 안 함
          if (workingModel === model) workingModel = null;
          continue;
        }
        if (isRateLimited(e) || isTransient(e)) {
          if (workingModel === model) workingModel = null;
          continue; // 다음 후보 모델로 즉시
        }
        throw e; // 인증 등 치명적 오류는 즉시 실패
      }
    }
    // 이번 라운드 전 후보 실패 — 재시도 불가한 오류였다면 중단
    if (!isRetryable(lastErr)) break;
  }

  // 후보 전부 실패 → 계정에서 쓸 수 있는 flash 모델 자동 탐색. 순위 목록 전체를
  // 순서대로 시도한다(1순위가 실제로는 죽어 있는 경우가 있어 하나만 믿지 않음).
  for (const discovered of await discoverFlashModel()) {
    if (dead.has(discovered)) continue;
    try {
      const res = await getAI().models.generateContent({ model: discovered, contents: user, config: cfg });
      workingModel = discovered;
      console.log(`  🤖 Gemini 모델(자동탐색): ${discovered}`);
      await persistGeminiModel(discovered).catch(() => {});
      return res.text ?? "";
    } catch (e) {
      lastErr = e;
      if (isModelMissing(e)) dead.add(discovered);
    }
  }
  throw lastErr ?? new Error("사용 가능한 Gemini 모델을 찾지 못했습니다.");
}

/**
 * 지금 이 API 키에서 실제로 쓸 수 있는 flash 계열 모델을 찾아 우선순위대로 정렬해 돌려준다.
 * 버전 고정 안정판 → '-latest' 실험판 → lite 계열 → 나머지 순.
 * ★models.list() 가 이미 지원 종료된 모델도 여전히 올려주는 경우가 있어(실측 확인:
 * gemini-2.5-flash 가 목록엔 있었지만 generateContent 는 404) 하나만 고르지 않고
 * 전체를 순서대로 반환한다 — 호출부가 1순위부터 차례로 시도한다.
 */
async function discoverFlashModel(): Promise<string[]> {
  try {
    const pager = await getAI().models.list();
    const names: string[] = [];
    for await (const m of pager) {
      const name = (m.name ?? "").replace(/^models\//, "");
      const actions = m.supportedActions ?? [];
      const supportsGenerate = actions.length === 0 || actions.includes("generateContent");
      if (name.includes("flash") && supportsGenerate) names.push(name);
    }
    if (!names.length) return [];
    const rank = (n: string): number => {
      if (!/lite|preview|exp|thinking|image|live|tts|audio|latest/.test(n)) return 0; // 버전 고정 안정판
      if (!/lite|preview|exp|thinking|image|live|tts|audio/.test(n)) return 1; // "-latest" 만 걸림
      if (!/preview|exp|thinking|image|live|tts|audio/.test(n)) return 2; // lite 계열
      return 3; // 프리뷰/실험판 등
    };
    const ranked = [...names].sort((a, b) => rank(a) - rank(b));
    console.log(
      `  🔎 사용 가능한 flash 계열: ${names.join(", ")} → 시도 순서: ${ranked.slice(0, 6).join(", ")}${ranked.length > 6 ? " …" : ""}`,
    );
    return ranked;
  } catch {
    return [];
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
  const jsonSchema = toJsonSchema(schema);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const text = await generateText(sys, user, temperature, jsonSchema);
    try {
      return schema.parse(JSON.parse(stripFences(text)));
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Gemini 구조화 출력 실패 (${maxRetries + 1}회 시도): ${String(lastErr)}`);
}

/** zod 스키마 → Gemini responseJsonSchema 용 JSON Schema (ref 인라인, $schema 제거) */
function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/** 모델이 ```json 펜스로 감싼 경우 제거 */
function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

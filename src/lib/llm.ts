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

/**
 * 오류 메시지를 cause 사슬까지 합쳐서 본다.
 *
 * Node fetch 는 네트워크 오류를 겉면 "TypeError: fetch failed" 하나로 감싸고
 * 진짜 원인(HeadersTimeoutError, ECONNRESET …)을 err.cause 에 숨긴다.
 * 겉면 메시지만 보면 모든 네트워크 장애가 '기타'로 분류돼 즉시 포기하게 된다
 * — 2026-08-24·08-26 롱폼 게시가 정확히 이걸로 두 번 죽었다.
 */
function fullMessage(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    const e = cur as { message?: unknown; code?: unknown; cause?: unknown };
    if (e.message) parts.push(String(e.message));
    if (e.code) parts.push(String(e.code));
    cur = e.cause;
  }
  return parts.length ? parts.join(" | ") : String(err);
}

/**
 * ★fullMessage() 가 cause 사슬의 err.code 까지 합치면서 생긴 오탐:
 * DNS 실패 코드 "ENOTFOUND" 가 /not[_ ]?found/i 에 걸려 '모델 없음(404)' 으로
 * 오분류됐다(실측 확인, 감사에서 발견). 네트워크 계층 오류면 모델 존재 여부를
 * 판단할 수 없으니 절대 모델없음으로 보지 않는다 — 이게 최우선 가드다.
 */
function isModelMissing(err: unknown): boolean {
  if (isNetworkError(err)) return false;
  return (
    statusOf(err) === 404 ||
    /\bnot[_ ]?found\b|no longer available|not supported for generateContent/i.test(fullMessage(err))
  );
}
/**
 * ★/rate/i 는 'generateContent' 같은 정상 문구에도 걸린다(gene-RATE-Content).
 * 403 PERMISSION_DENIED 같은 치명적 오류가 '한도 초과' 로 오분류돼 4라운드
 * 전체를 헛되이 재시도하는 사고가 감사에서 확인됐다 — 패턴을 한도 관련
 * 표현으로 좁힌다.
 */
function isRateLimited(err: unknown): boolean {
  return statusOf(err) === 429 || /RESOURCE_EXHAUSTED|\bquota\b|\brate.?limit/i.test(fullMessage(err));
}
/**
 * 네트워크 계층 장애 — 서버가 아니라 전송이 죽은 경우.
 *
 * 대표: undici HeadersTimeoutError(UND_ERR_HEADERS_TIMEOUT). Node fetch 는
 * 응답 헤더를 300초 안에 못 받으면 끊는데, 긴 롱폼 대본은 Gemini 가 생각에
 * 5분을 넘기는 회차가 실제로 있다(실측: 실패 두 건 모두 정확히 5분 0초에
 * 사망, 직후 재실행은 성공). 그래서 이 부류는 반드시 재시도 대상이다.
 */
function isNetworkError(err: unknown): boolean {
  return /fetch failed|UND_ERR|HeadersTimeout|BodyTimeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|socket hang up|network|terminated|aborted/i.test(
    fullMessage(err),
  );
}
/** 일시적 서버 혼잡(503 UNAVAILABLE / 500) 또는 네트워크 장애. 잠시 후 또는 다른 모델로 재시도 가능. */
function isTransient(err: unknown): boolean {
  const s = statusOf(err);
  return (
    s === 503 ||
    s === 500 ||
    /UNAVAILABLE|high demand|overloaded|internal error/i.test(fullMessage(err)) ||
    isNetworkError(err)
  );
}
/** 재시도해볼 가치가 있는 오류(한도·혼잡·네트워크·모델없음) — 인증 오류 등은 즉시 실패 */
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

/**
 * generateContent 호출당 상한. undici 기본(헤더 300초)에만 맡기면 '정상인데
 * 느린' 롱폼 응답(실측 5분대)과 '진짜 멈춘' 응답을 구분 못 해 애매하게 죽는다.
 * isNetworkError 재시도가 이미 붙어 있으니, 여기서는 실제로 죽은 요청만 끊기게
 * 정상 소요시간보다 넉넉히 잡는다(짧게 잡으면 '항상 이 시간에 죽고 항상
 * 재시도'하는 낭비 루프가 된다). 호출마다 새로 만든다 — cfg 에 박아두면
 * 라운드 사이 대기(최대 83초)·이전 시도 소요시간까지 하나의 데드라인을
 * 공유해 뒤 라운드가 억울하게 끊긴다.
 */
const GEMINI_CALL_TIMEOUT_MS = 9 * 60_000;

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
          res = await getAI().models.generateContent({
            model,
            contents: user,
            config: { ...cfg, abortSignal: AbortSignal.timeout(GEMINI_CALL_TIMEOUT_MS) },
          });
        } catch (e) {
          if (!isTokenLimitRejection(e)) throw e;
          // 이 모델은 큰 상한을 못 받는다 — 낮춰서 한 번 더
          res = await getAI().models.generateContent({
            model,
            contents: user,
            config: {
              ...cfg,
              maxOutputTokens: FALLBACK_OUTPUT_TOKENS,
              abortSignal: AbortSignal.timeout(GEMINI_CALL_TIMEOUT_MS),
            },
          });
        }
        if (workingModel !== model) {
          workingModel = model;
          console.log(`  🤖 Gemini 모델: ${model}`);
        }
        await persistGeminiModel(model).catch(() => {});
        // 잘리거나(MAX_TOKENS) 차단된(SAFETY 등) 응답을 성공으로 반환하면
        // JSON.parse 단계에서야 실패가 드러나 원인을 알 수 없고, generateStructured
        // 가 '똑같은 요청'을 최대 3번 반복해 무료 일일 한도만 태운다(실측: 감사에서
        // 확인). 이 부류는 같은 요청이면 거의 결정론적으로 재실패하므로 재시도할
        // 가치가 없다 — 원인을 담아 즉시 실패시킨다(다른 모델·라운드로도 안 넘어감).
        const blockReason = res.promptFeedback?.blockReason;
        if (blockReason) {
          throw new Error(`Gemini 프롬프트 차단 (blockReason=${blockReason}, 모델=${model})`);
        }
        const reason = res.candidates?.[0]?.finishReason;
        if (reason && String(reason) !== "STOP") {
          throw new Error(`Gemini 응답이 정상 종료되지 않음 (finishReason=${reason}, 모델=${model})`);
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
            : isNetworkError(e)
              ? "네트워크"
              : isTransient(e)
                ? "일시적 오류"
                : "기타";
        console.log(`  ⏭️  ${model} 실패(${reason}): ${fullMessage(e).slice(0, 200)}`);
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
      const res = await getAI().models.generateContent({
        model: discovered,
        contents: user,
        config: { ...cfg, abortSignal: AbortSignal.timeout(GEMINI_CALL_TIMEOUT_MS) },
      });
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
    const pager = await getAI().models.list({
      config: { abortSignal: AbortSignal.timeout(20_000) },
    });
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
  } catch (e) {
    // 이 함수는 전 후보 실패 후의 마지막 자가 복구 수단이다(208행) — 조용히
    // 빈 배열을 돌려주면 '탐색이 실패했다'와 '탐색할 게 없었다'를 구분할 수 없어
    // 재실행하면 성공하는 원인 불명 장애로 보인다(감사에서 확인). 최소한 로그는 남긴다.
    console.warn(`  ⚠️ models.list() 실패 — 자동탐색 불가: ${fullMessage(e)}`);
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

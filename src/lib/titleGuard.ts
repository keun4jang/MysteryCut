import fs from "node:fs/promises";
import path from "node:path";

/**
 * 롱폼 제목 검사(11/8) — 코드로만, LLM 없음.
 *
 * 최근 롱폼 18편 중 대부분이 '기록으로 남은 미스터리 N가지'·'사소한 단서 하나로 … 몰아보기'·'흔적도 없이 사라진 …'
 * 같은 틀이었다. 유튜브가 수익창출 부적합으로 드는 '템플릿 대량생산' 신호이고, 같은 틀의 제목이 이어질수록
 * 회차 시청시간도 줄었다(123→0분). 상투 표현과 최근 제목과의 유사도를 함께 본다.
 */

/**
 * 금지 표현. ★'\d+\s*(가지|선)' 뒤는 \b 가 아니라 '한글이 이어지지 않음'으로 본다 —
 * JS 의 \b 는 한글을 단어 문자로 보지 않아 '4가지' 뒤에서 절대 걸리지 않는다.
 */
/** 프롬프트에 보여줄 금지 표현(아래 정규식과 같은 뜻) */
export const BANNED_TITLE_PHRASES = ["몰아보기", "기록으로 남은", "사소한 단서", "흔적도 없이 사라진", "N가지", "N선", "모음", "역사 속"];

export const BANNED_TITLE_RE = /몰아보기|기록으로 남은|사소한 단서|흔적도?\s*없이 사라진|\d+\s*(가지|선)(?![가-힣])|모음|역사 속/;

/** 한글·영문·숫자 2글자 묶음(공백·문장부호 제거) */
function bigrams(s: string): Set<string> {
  const t = s.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

export function bigramJaccard(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

export const TITLE_SIMILARITY_MAX = 0.4;

export function checkTitle(t: string, recent: string[]): { ok: boolean; reason: string } {
  const title = (t ?? "").trim();
  if (!title) return { ok: false, reason: "제목이 비어 있음" };
  const banned = BANNED_TITLE_RE.exec(title);
  if (banned) return { ok: false, reason: `상투 표현 '${banned[0]}'` };
  for (const r of recent.slice(-20)) {
    const j = bigramJaccard(title, r);
    if (j >= TITLE_SIMILARITY_MAX) return { ok: false, reason: `최근 제목과 비슷함(${j.toFixed(2)}): ${r}` };
  }
  return { ok: true, reason: "" };
}

// ── 최근 롱폼 제목 상태 파일(data/longformTitles.json) ────────────────────────

const TITLES_FILE = path.join("data", "longformTitles.json");

/** 파일이 없을 때 쓰는 초기값 — 지금까지 올린 몰아보기 제목 18편(11/8 통계 보고서 원문 그대로 — 긴 제목은 보고서에서 잘린 채) */
export const KNOWN_COMPILATION_TITLES = [
  "흔적도 없이 사라진 사람들: 단 하나의 단서도 남기지 않은 5가지",
  "흔적도 없이 사라진 사람들: 역사 속 미해결 실종과 의문의 사건",
  "사소한 단서 하나로 뒤집힌 역사 속 5가지 거대한 미스터리 몰아보",
  "기록으로 남은 역사 속 미스터리 사건 4가지 몰아보기",
  "흔적도 없이 사라진 사람들부터 풀리지 않은 수수께끼까지, 역사 속",
  "기록으로 남은 미스터리 4가지 사건 몰아보기",
  "사소한 단서 하나로 기록된 인류 역사 속 미스터리 사건 몰아보기",
  "사소한 단서 하나로 역사 속에 묻혀버린 미스터리 사건 5선 몰아보",
  "기록으로 남은 미스터리 4가지: 수십 년이 지나도 풀리지 않은 사",
  "흔적 없이 사라진 이들과 사소한 단서로 뒤집힌 다섯 가지 기록 모",
  "수십 년간 기록과 기억 속에 남겨진 미스터리 사건 3가지 몰아보기",
  "사소한 단서 하나로 무너진 이중생활과 상속 분쟁 사건 모음",
  "기록으로 남은 미스터리 3가지: 괴담부터 세상을 뒤흔든 미제와 억",
  "사소한 단서 하나로 수십 년 만에 수면 위로 드러난 미제 사건 5",
  "기록으로 남은 미스터리 세 가지, 진실은 어디에 있는가",
  "기나긴 세월과 기록을 거쳐 진실에 다가간 미스터리 사건 4가지",
  "사소한 단서 하나로 수십 년 만에 뒤집힌 역사 속 미스터리 사건",
  "기록으로 남은 미스터리 2가지 : 바다의 전설부터 바위산의 돌원반까지",
];

export interface TitleEntry {
  title: string;
  at: string;
  mode?: "single" | "compilation";
  videoId?: string;
}

/** 최근 롱폼 제목(오래된 것 → 최신 순). 파일이 없으면 이력의 '｜' 제목 + 알려진 몰아보기 제목으로 시작 */
export async function loadRecentLongformTitles(historyTitles: string[] = []): Promise<string[]> {
  try {
    const raw = JSON.parse(await fs.readFile(TITLES_FILE, "utf8")) as { titles?: TitleEntry[] };
    if (Array.isArray(raw.titles) && raw.titles.length) return raw.titles.map((t) => t.title);
  } catch {
    /* 없음·손상 → 아래 초기값 */
  }
  const seeded = historyTitles.filter((t) => /[｜|]/.test(t)).slice(-10);
  return [...seeded, ...KNOWN_COMPILATION_TITLES];
}

/** 게시 후 제목 추가(최근 60개만 유지). 실패해도 게시엔 영향 없음 */
export async function appendLongformTitle(entry: TitleEntry, historyTitles: string[] = []): Promise<void> {
  let titles: TitleEntry[] = [];
  try {
    const raw = JSON.parse(await fs.readFile(TITLES_FILE, "utf8")) as { titles?: TitleEntry[] };
    if (Array.isArray(raw.titles)) titles = raw.titles;
  } catch {
    titles = (await loadRecentLongformTitles(historyTitles)).map((title) => ({ title, at: "" }));
  }
  titles.push(entry);
  await fs.mkdir(path.dirname(TITLES_FILE), { recursive: true });
  await fs.writeFile(TITLES_FILE, `${JSON.stringify({ titles: titles.slice(-60) }, null, 2)}\n`, "utf8");
}

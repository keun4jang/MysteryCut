import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { StoryIdea } from "../types.js";

/** 게시 이력 1건 */
export interface HistoryPost {
  caseKey: string; // 정규화된 사건 식별자
  title: string;
  premise?: string;
  at: string; // ISO 날짜 (YYYY-MM-DD)
  /** 이 게시물에 쓴 해시태그 (다음 게시에서 같은 세트 반복 방지) */
  hashtags?: string[];
}
interface HistoryFile {
  posts: HistoryPost[];
}

const HISTORY_PATH = path.join(config.paths.root, "data", "history.json");

/** 사건 식별자 정규화 (대소문자·공백·특수문자 무시) */
export function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function loadHistory(): Promise<HistoryFile> {
  let raw: string;
  try {
    raw = await fs.readFile(HISTORY_PATH, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { posts: [] }; // 파일 없음 → 정상적인 빈 이력
    throw e; // 그 외(권한 등)는 '빈 이력'으로 위장하지 않고 그대로 실패시킨다
  }
  // ★파일은 있는데 JSON 이 깨졌으면(잘린 쓰기, 수기 편집 실수) 절대 '빈 이력'으로
  // 위장하지 않는다 — 위장하면 그 실행의 중복 회피가 통째로 사라지고, 이어서
  // appendPost 가 빈 이력에 새 항목 1건만 써서 commitPostHistory 가 그걸 원격에
  // 그대로 push 해 90여 건의 게시 이력을 1건짜리로 영구 대체할 수 있다(감사에서
  // 확인된 연쇄 파괴 경로). 손상은 파이프라인을 죽여서 사람이 알아채게 한다.
  let parsed: Partial<HistoryFile>;
  try {
    parsed = JSON.parse(raw) as Partial<HistoryFile>;
  } catch (e) {
    throw new Error(
      `data/history.json 파싱 실패 — 파일이 손상된 것으로 보입니다(빈 이력으로 위장하지 않고 중단합니다): ${e instanceof Error ? e.message : e}`,
    );
  }
  return { posts: Array.isArray(parsed.posts) ? parsed.posts : [] };
}

/** 이미 게시된 사건 식별자 집합 (정규화됨) */
export function usedKeySet(hist: HistoryFile): Set<string> {
  return new Set(hist.posts.map((p) => normalizeKey(p.caseKey)));
}

/** LLM 프롬프트에 넘길 '최근 사용 소재' 요약 (caseKey + 제목 + 최근 해시태그) */
export function recentAvoidList(
  hist: HistoryFile,
  n = 80,
): { caseKeys: string[]; titles: string[]; recentHashtags: string[] } {
  const recent = hist.posts.slice(-n);
  // 해시태그는 최근 5개 게시물 것만 (그 이전 반복은 자연스러움)
  const recentTags = hist.posts.slice(-5).flatMap((p) => p.hashtags ?? []);
  return {
    caseKeys: recent.map((p) => p.caseKey),
    titles: recent.map((p) => p.title),
    recentHashtags: [...new Set(recentTags)],
  };
}

/**
 * caseKey 에서 '사건을 특정하는 이름 토큰'만 추린다.
 * LLM 이 같은 사건에 helen-brach-1977 / helen-brach-disappearance-1977 처럼
 * 수식어만 다른 슬러그를 만드는 일이 실제로 있어(2026-08-18 실측),
 * 완전 일치 비교만으로는 중복이 뚫린다. 장르·지역 같은 범용 단어를 걷어내고
 * 남는 고유명 토큰으로 비교한다.
 */
const GENERIC_KEY_TOKENS = new Set([
  // 장르·사건 유형
  "mystery", "mysteries", "case", "cases", "incident", "affair", "scandal",
  "disappearance", "disappear", "missing", "vanish", "vanished", "vanishing",
  "murder", "murders", "death", "deaths", "killing", "unsolved", "cold",
  "haunted", "haunting", "ghost", "curse", "cursed", "strange", "bizarre",
  "secret", "secrets", "hidden", "double", "life", "identity",
  "estate", "inheritance", "will", "fortune", "money", "fraud", "scam",
  "court", "trial", "verdict", "ruling", "lawsuit", "legal",
  "family", "wife", "husband", "widow", "heir", "heiress",
]);
// 지역명은 걸러내지 않는다 — seoul-fire-1971 vs daegu-fire-1971 처럼
// 지역이 사건을 가르는 유일한 단서인 경우가 있다.

function keyNameTokens(key: string): Set<string> {
  return new Set(
    normalizeKey(key)
      .split("-")
      .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !GENERIC_KEY_TOKENS.has(t)),
  );
}

function keyYear(key: string): string | null {
  // 조선 시대 소재는 1473 같은 연도도 나온다 — 1000~2099 전체를 연도로 인식
  const m = normalizeKey(key).match(/\b(1\d{3}|20\d\d)\b/);
  return m ? m[1] : null;
}

/**
 * 두 caseKey 가 사실상 같은 사건을 가리키는지 (수식어 차이 무시).
 * '강한 겹침' = 한쪽 고유명 집합이 다른 쪽에 온전히 포함되거나(수식어만 추가된
 * 경우), 고유명이 2개 이상 겹치는 경우. 고유명 1개만 겹치는 건(fire 등 소재
 * 명사 하나) 같은 사건의 증거로 약해서 오탐을 낳으므로 제외한다.
 * 연도가 양쪽에 있으면 반드시 일치해야 한다(1473 흉가 vs 1616 흉가는 다른 사건).
 */
export function isSameCase(a: string, b: string): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (na === nb) return true;
  const ta = keyNameTokens(a);
  const tb = keyNameTokens(b);
  if (!ta.size || !tb.size) return false;
  const shared = [...ta].filter((t) => tb.has(t));
  if (!shared.length) return false;
  const subset = shared.length === ta.size || shared.length === tb.size;
  const strong = subset || shared.length >= 2;
  if (!strong) return false;
  const ya = keyYear(a);
  const yb = keyYear(b);
  if (ya && yb) return ya === yb;
  return true;
}

export function isDuplicate(hist: HistoryFile, caseKey: string): boolean {
  return hist.posts.some((p) => isSameCase(p.caseKey, caseKey));
}

/** 이력에 1건 추가하고 파일 저장 (게시 성공 후 호출) */
export async function appendPost(idea: StoryIdea, hashtags?: string[]): Promise<void> {
  const hist = await loadHistory();
  const at = new Date().toISOString().slice(0, 10);
  hist.posts.push({
    caseKey: idea.caseKey,
    title: idea.title,
    premise: idea.premise,
    at,
    hashtags,
  });
  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  // 제자리 writeFile 은 쓰는 도중 크래시하면 잘린 JSON을 남긴다(위 loadHistory 의
  // '손상→중단' 가드가 바로 이 상황을 겨냥한 것) — tmp 파일 + rename 으로 원자화해
  // 애초에 잘린 파일이 남을 수 없게 한다.
  const tmp = `${HISTORY_PATH}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${JSON.stringify(hist, null, 2)}\n`, "utf8");
  await fs.rename(tmp, HISTORY_PATH);
  console.log(`  🗂️  이력 저장: ${idea.caseKey} (총 ${hist.posts.length}건)`);
}

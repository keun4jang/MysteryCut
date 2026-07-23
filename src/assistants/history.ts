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
  try {
    const raw = await fs.readFile(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<HistoryFile>;
    return { posts: Array.isArray(parsed.posts) ? parsed.posts : [] };
  } catch {
    return { posts: [] }; // 파일 없음/깨짐 → 빈 이력
  }
}

/** 이미 게시된 사건 식별자 집합 (정규화됨) */
export function usedKeySet(hist: HistoryFile): Set<string> {
  return new Set(hist.posts.map((p) => normalizeKey(p.caseKey)));
}

/** LLM 프롬프트에 넘길 '최근 사용 소재' 요약 (caseKey + 제목), 최신 순 최대 n개 */
export function recentAvoidList(
  hist: HistoryFile,
  n = 80,
): { caseKeys: string[]; titles: string[] } {
  const recent = hist.posts.slice(-n);
  return {
    caseKeys: recent.map((p) => p.caseKey),
    titles: recent.map((p) => p.title),
  };
}

export function isDuplicate(hist: HistoryFile, caseKey: string): boolean {
  return usedKeySet(hist).has(normalizeKey(caseKey));
}

/** 이력에 1건 추가하고 파일 저장 (게시 성공 후 호출) */
export async function appendPost(idea: StoryIdea): Promise<void> {
  const hist = await loadHistory();
  const at = new Date().toISOString().slice(0, 10);
  hist.posts.push({
    caseKey: idea.caseKey,
    title: idea.title,
    premise: idea.premise,
    at,
  });
  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await fs.writeFile(HISTORY_PATH, `${JSON.stringify(hist, null, 2)}\n`, "utf8");
  console.log(`  🗂️  이력 저장: ${idea.caseKey} (총 ${hist.posts.length}건)`);
}

import fs from "node:fs/promises";
import path from "node:path";

/**
 * 롱폼 전체 재생목록의 ID — 한 번 만들면 계속 재사용한다(같은 패턴:
 * lib/geminiModel.ts, lib/igGraphVersion.ts).
 *
 * 왜 재생목록인가: '최신 롱폼 1개' 링크(latestLongform.ts)는 링크를 걸 당시엔
 * 최신이어도 시간이 지나면 낡고, 롱폼이 뜸한 주엔 오래된 영상 하나만 계속
 * 가리킨다. 재생목록은 매번 자동으로 맨 위에 최신 항목이 올라가면서도 과거
 * 영상 전체로의 접근을 계속 유지한다 — 유튜브 쪽 추천 노출도 단일 영상보다
 * 유리하다.
 */
const STATE_FILE = path.join("data", "longformPlaylist.json");

let cached: string | null | undefined; // undefined = 아직 안 읽음

export async function loadLongformPlaylistId(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as { playlistId?: string };
    cached = parsed.playlistId?.trim() || null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function persistLongformPlaylistId(playlistId: string): Promise<void> {
  if (cached === playlistId) return;
  cached = playlistId;
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${JSON.stringify({ playlistId }, null, 2)}\n`, "utf8");
  await fs.rename(tmp, STATE_FILE);
}

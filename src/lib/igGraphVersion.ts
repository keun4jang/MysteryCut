import fs from "node:fs/promises";
import path from "node:path";

/**
 * Instagram Graph API 버전 자동 추종.
 *
 * 메타는 각 버전을 약 2년만 지원하고 주기적으로 새 버전을 낸다. 버전을 코드에
 * 고정해두면 5년 방치 시 확실히 한 번 이상 깨진다. 마지막으로 성공이 확인된
 * 버전을 이 파일에 기록해두고, 다음 실행은 거기서부터 시작한다(매번 시행착오를
 * 반복하지 않도록). 게시 워크플로가 data/history.json 과 함께 이 파일도 커밋한다.
 */
const STATE_FILE = path.join("data", "igGraphVersion.txt");

let cached: string | null = null;

/** 마지막으로 성공한 버전을 읽는다. 파일이 없으면(아직 올릴 필요가 없었던 경우) config 기본값. */
export async function loadGraphVersion(fallback: string): Promise<string> {
  if (cached) return cached;
  try {
    const raw = (await fs.readFile(STATE_FILE, "utf8")).trim();
    if (/^v\d+\.\d+$/.test(raw)) {
      cached = raw;
      return raw;
    }
  } catch {
    /* 파일 없음 — 기본값 사용 */
  }
  cached = fallback;
  return fallback;
}

/** 버전을 올려 파일에 기록 — 다음 실행부터 이 버전으로 바로 시작한다 */
export async function persistGraphVersion(v: string): Promise<void> {
  cached = v;
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, `${v}\n`);
}

/** "v21.0" → "v22.0" (메타는 대략 연 3~4회 새 버전을 낸다) */
export function nextGraphVersion(v: string): string {
  const m = /^v(\d+)\.(\d+)$/.exec(v);
  if (!m) return v;
  return `v${parseInt(m[1], 10) + 1}.0`;
}

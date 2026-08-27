import fs from "node:fs/promises";
import path from "node:path";

/**
 * 최신 롱폼 영상 정보 — 쇼츠 설명란에 "전체 분석은 롱폼에서" 링크를 자동으로
 * 붙이기 위한 상태 파일(같은 패턴: lib/geminiModel.ts, lib/igGraphVersion.ts).
 *
 * 왜 필요한가: 채널 Analytics 실측(2026-08-27) — 조회의 96%가 쇼츠 피드
 * 자체에서만 나고, 유튜브 수익창출 요건(4,000시간)은 쇼츠 시청시간이 산입
 * 안 돼 롱폼으로만 채울 수 있는데, 정작 롱폼 90일 시청시간이 18분에 그쳤다.
 * 쇼츠 시청자를 롱폼으로 데려오는 장치가 전혀 없었기 때문이다. 매일 나가는
 * 쇼츠 설명란에 최신 롱폼 링크를 자동으로 얹어 그 트래픽 일부를 흘려보낸다.
 */
const STATE_FILE = path.join("data", "latestLongform.json");

export interface LatestLongform {
  videoId: string;
  title: string;
  publishedAt: string; // YYYY-MM-DD
}

let cached: LatestLongform | null | undefined; // undefined = 아직 안 읽음

export async function loadLatestLongform(): Promise<LatestLongform | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<LatestLongform>;
    cached = parsed.videoId && parsed.title && parsed.publishedAt ? (parsed as LatestLongform) : null;
  } catch {
    cached = null; // 파일 없음(첫 롱폼 게시 전)/손상 — 링크 없이 진행
  }
  return cached;
}

export async function persistLatestLongform(info: LatestLongform): Promise<void> {
  cached = info;
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  // tmp+rename 원자적 교체 — history.ts/geminiModel.ts 와 동일한 이유
  // (제자리 쓰기 중 크래시하면 잘린 JSON이 남아 다음 로드가 깨진다).
  const tmp = `${STATE_FILE}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${JSON.stringify(info, null, 2)}\n`, "utf8");
  await fs.rename(tmp, STATE_FILE);
}

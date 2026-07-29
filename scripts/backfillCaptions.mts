/**
 * 기존에 올라간 유튜브 영상 전체에 '빈 자막 트랙'을 등록해 자동자막을 억제한다.
 * (이미 수동 자막이 있는 영상은 건너뜀)
 *
 * 사용: npx tsx scripts/backfillCaptions.mts [최대 처리 개수=4]
 * 쿼터: 영상당 약 450 유닛(captions.list 50 + insert 400). 유튜브 쿼터일(태평양 자정
 *       기준)에 게시가 4회 몰리는 날(랜덤 지연이 경계를 넘는 경우, 약 8,200유닛)에도
 *       10,000 무료 쿼터를 넘지 않도록 기본 4개 — 매일 자동 실행으로 이어서 처리.
 *
 * 처리한 영상은 data/captionsBackfill.json 에 기록해 다음 실행에서 API 호출 없이
 * 건너뛴다 (쿼터 낭비 방지). 남은 개수는 GITHUB_OUTPUT(remaining)으로 내보낸다.
 */
import fs from "node:fs";
import {
  getYoutubeAccessToken,
  suppressAutoCaptions,
} from "../src/assistants/youtubePublisher.js";

const CHECKPOINT = "data/captionsBackfill.json";
const limit = Math.max(0, Number(process.argv[2] || "4") || 0);
const token = await getYoutubeAccessToken();
const H = { Authorization: `Bearer ${token}` };

const processed = new Set<string>(
  fs.existsSync(CHECKPOINT)
    ? ((JSON.parse(fs.readFileSync(CHECKPOINT, "utf8")) as { done?: string[] }).done ?? [])
    : [],
);
const saveCheckpoint = () =>
  fs.writeFileSync(CHECKPOINT, `${JSON.stringify({ done: [...processed].sort() }, null, 2)}\n`);

// 1) 내 채널의 업로드 재생목록 ID
const chRes = await fetch(
  "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true",
  { headers: H },
);
const ch = (await chRes.json()) as {
  items?: Array<{ contentDetails: { relatedPlaylists: { uploads: string } } }>;
  error?: { message?: string };
};
if (!chRes.ok || !ch.items?.length) {
  throw new Error(`채널 조회 실패: ${JSON.stringify(ch).slice(0, 300)}`);
}
const uploads = ch.items[0].contentDetails.relatedPlaylists.uploads;

// 2) 업로드된 영상 ID 전부 수집
const videoIds: string[] = [];
let pageToken = "";
do {
  const plRes = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${pageToken ? `&pageToken=${pageToken}` : ""}`,
    { headers: H },
  );
  const pl = (await plRes.json()) as {
    items?: Array<{ contentDetails: { videoId: string } }>;
    nextPageToken?: string;
  };
  if (!plRes.ok) throw new Error(`업로드 목록 조회 실패: ${JSON.stringify(pl).slice(0, 300)}`);
  for (const it of pl.items ?? []) videoIds.push(it.contentDetails.videoId);
  pageToken = pl.nextPageToken ?? "";
} while (pageToken);
const candidates = videoIds.filter((id) => !processed.has(id));
console.log(
  `채널 영상 ${videoIds.length}개 발견 (기록상 처리 완료 ${videoIds.length - candidates.length}개). ` +
    `이번 실행 최대 ${limit}개 처리.`,
);

// 3) 수동 자막 없는 영상에 빈 트랙 등록
let done = 0;
let skipped = 0;
for (const id of candidates) {
  if (done >= limit) break;
  const capRes = await fetch(
    `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${id}`,
    { headers: H },
  );
  const caps = (await capRes.json()) as {
    items?: Array<{ snippet: { trackKind: string; language: string } }>;
  };
  if (!capRes.ok) {
    console.log(`  ❌ ${id}: 자막 목록 조회 실패 — 중단`);
    break;
  }
  const hasManual = (caps.items ?? []).some((c) => c.snippet.trackKind !== "asr");
  if (hasManual) {
    skipped++;
    processed.add(id);
    console.log(`  ⏭️  ${id}: 수동 자막 이미 있음 — 건너뜀`);
    continue;
  }
  const ok = await suppressAutoCaptions(id, token);
  if (ok) {
    done++;
    processed.add(id);
    console.log(`  ✅ ${id}: 빈 자막 등록 (${done}/${limit})`);
  } else {
    console.log(`  ❌ ${id}: 실패 — 중단`);
    break; // 권한/쿼터 문제면 나머지도 실패할 것이므로 중단
  }
}
saveCheckpoint();

const remaining = videoIds.filter((id) => !processed.has(id)).length;
console.log(`완료: 등록 ${done}개, 건너뜀 ${skipped}개, 남은 후보 ${remaining}개`);
if (remaining > 0) {
  console.log("남은 영상은 다음 자동 실행에서 이어서 처리됩니다 (쿼터 보호).");
} else {
  console.log("🎉 모든 영상 처리 완료!");
}
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `remaining=${remaining}\n`);
}

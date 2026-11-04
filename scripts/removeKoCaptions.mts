/**
 * 미스터리 컷 영상(2026-01-01 이후)에 우리가 올린 '한국어' 자막 트랙을 지운다.
 * 한국어는 화면에 이미 박혀 있어 이 트랙이 켜지면 같은 문장이 두 번 보인다(11/4 사장님 요청).
 *
 * 사용: npx tsx scripts/removeKoCaptions.mts [--apply]
 *   기본은 미리보기. --apply 를 붙여야 실제 삭제.
 * 지우는 것: 언어 ko 이고 trackKind 가 standard(직접 올린 것)인 트랙만. 유튜브 자동 생성(ASR)·영어 트랙은 그대로.
 * 옛 '새미했다' 영상(2026-01-01 이전)은 legacyGuard 로 절대 건드리지 않는다.
 * 쿼터: captions.list 50/영상 + captions.delete 50/건 — 하루 한도가 1만이라 최신 영상부터 --max 개(기본 40)만 본다.
 *   (40개 = 목록 2,000 + 삭제 최대 2,000. 업로드 1건이 1,600 이라 게시 날에도 여유를 남긴다.) 나머지는 다음 날 다시 돌린다.
 */
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";
import { isLegacyVideo } from "./legacyGuard.mjs";

const apply = process.argv.includes("--apply");
const maxArg = process.argv.indexOf("--max");
const max = maxArg > 0 ? Number(process.argv[maxArg + 1]) || 40 : 40;
const skipArg = process.argv.indexOf("--skip");
const skip = skipArg > 0 ? Number(process.argv[skipArg + 1]) || 0 : 0;
const token = await getYoutubeAccessToken();
const H = { Authorization: `Bearer ${token}` };
const get = async (url: string) => (await fetch(url, { headers: H })).json();

const ch = await get("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true");
const uploads: string | undefined = ch.items?.[0]?.contentDetails.relatedPlaylists.uploads;
if (!uploads) throw new Error(`채널 조회 실패: ${JSON.stringify(ch).slice(0, 200)}`);

const vids: Array<{ id: string; publishedAt?: string; title: string }> = [];
let pageToken = "";
do {
  const pl = await get(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${uploads}${pageToken ? `&pageToken=${pageToken}` : ""}`,
  );
  for (const it of pl.items ?? []) {
    vids.push({ id: it.contentDetails.videoId, publishedAt: it.contentDetails.videoPublishedAt, title: it.snippet.title });
  }
  pageToken = pl.nextPageToken ?? "";
} while (pageToken);

const all = vids
  .filter((v) => !isLegacyVideo(v.publishedAt))
  .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
const targets = all.slice(skip, skip + max);
console.log(`채널 영상 ${vids.length}개 중 미스터리 컷 영상 ${all.length}개 — 이번에 ${skip + 1}~${skip + targets.length}번째 확인${apply ? " (실제 삭제 모드)" : " (미리보기 모드)"}`);

let found = 0, deleted = 0, failed = 0;
for (const v of targets) {
  const cl = await get(`https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${v.id}`);
  if (cl.error) {
    failed++;
    console.log(`⚠️ 자막 목록 실패 ${v.id}: ${cl.error.message}`);
    continue;
  }
  for (const c of cl.items ?? []) {
    const s = c.snippet;
    if (s.language !== "ko" || s.trackKind !== "standard") continue;
    found++;
    console.log(`🔎 ${v.publishedAt?.slice(0, 10)} ${v.title} — 트랙 "${s.name}" (${c.id})`);
    if (!apply) continue;
    const res = await fetch(`https://www.googleapis.com/youtube/v3/captions?id=${c.id}`, { method: "DELETE", headers: H });
    if (res.ok) {
      deleted++;
      console.log("   🗑️ 삭제함");
    } else {
      failed++;
      console.log(`   ❌ 삭제 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
}
if (skip + targets.length < all.length) console.log(`\n남은 영상 ${all.length - skip - targets.length}개 — 다음에 skip=${skip + targets.length} 로 다시 돌리세요.`);
console.log(`\n한국어 업로드 트랙 ${found}개 발견, 삭제 ${deleted}개, 실패 ${failed}개`);
if (failed) process.exitCode = 1;

/**
 * 이미 게시된 유튜브 영상을 재생목록에 추가한다. 자동 파이프라인의
 * playlistItems.insert 가 일시 오류(예: 409 SERVICE_UNAVAILABLE)로 실패했을 때
 * 수동으로 채워 넣는 용도.
 * 사용: npx tsx scripts/addToPlaylist.mts <playlistId> <videoId>
 * 쿼터: playlistItems.insert 50유닛.
 */
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";

const [playlistId, videoId] = process.argv.slice(2);
if (!playlistId || !videoId) {
  throw new Error("사용법: npx tsx scripts/addToPlaylist.mts <playlistId> <videoId>");
}
const token = await getYoutubeAccessToken();
const res = await fetch("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    snippet: { playlistId, position: 0, resourceId: { kind: "youtube#video", videoId } },
  }),
});
if (!res.ok) {
  throw new Error(`재생목록 추가 실패: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}
console.log(`📃 ${videoId} → 재생목록 ${playlistId} 추가 완료`);

/**
 * 이미 게시된 유튜브 영상을 재생목록에 추가한다. 자동 파이프라인의
 * playlistItems.insert 가 일시 오류(예: 409 SERVICE_UNAVAILABLE)로 실패했을 때
 * 수동으로 채워 넣거나, 재생목록 도입 이전에 게시된 영상을 소급 추가할 때 쓴다.
 * 사용: npx tsx scripts/addToPlaylist.mts <playlistId> <videoId> [position]
 *   position 생략 시 맨 끝에 추가(과거 영상 소급용). 최신 영상을 맨 위에
 *   두려면 0을 명시(자동 파이프라인이 쓰는 방식과 동일).
 * 쿼터: playlistItems.insert 50유닛.
 */
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";

const [playlistId, videoId, positionArg] = process.argv.slice(2);
if (!playlistId || !videoId) {
  throw new Error("사용법: npx tsx scripts/addToPlaylist.mts <playlistId> <videoId> [position]");
}
const position = positionArg ? Number(positionArg) : undefined;
const token = await getYoutubeAccessToken();
const res = await fetch("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    snippet: {
      playlistId,
      resourceId: { kind: "youtube#video", videoId },
      ...(position === undefined ? {} : { position }),
    },
  }),
});
if (!res.ok) {
  throw new Error(`재생목록 추가 실패: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}
console.log(`📃 ${videoId} → 재생목록 ${playlistId} 추가 완료`);

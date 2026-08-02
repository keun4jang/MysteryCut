/**
 * 이미 게시된 유튜브 영상의 커스텀 썸네일을 지정 이미지로 교체한다.
 * 사용: npx tsx scripts/setThumb.mts <videoId> <이미지경로>
 * 쿼터: thumbnails.set 약 50유닛.
 */
import fs from "node:fs/promises";
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";

const [videoId, imagePath] = process.argv.slice(2);
if (!videoId || !imagePath) {
  throw new Error("사용법: npx tsx scripts/setThumb.mts <videoId> <이미지경로>");
}
const token = await getYoutubeAccessToken();
const img = await fs.readFile(imagePath);
const res = await fetch(
  `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "image/jpeg",
      "Content-Length": String(img.byteLength),
    },
    body: new Uint8Array(img),
  },
);
if (!res.ok) {
  throw new Error(`썸네일 교체 실패: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}
console.log(`🖼️ ${videoId} 썸네일 교체 완료 (${imagePath})`);

/**
 * 게시된 유튜브 영상 1개의 제목만 바꾼다.
 *
 * 사용: VIDEO_ID=... NEW_TITLE=... npx tsx scripts/setTitle.mts [--apply]
 *   기본은 미리보기 — 현재 제목과 바뀔 제목만 출력. --apply 를 붙여야 실제 변경.
 * 쿼터: videos.list 1 + videos.update 50.
 */
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";

const apply = process.argv.includes("--apply");
const videoId = process.env.VIDEO_ID?.trim();
const newTitle = process.env.NEW_TITLE?.trim();
if (!videoId || !newTitle) throw new Error("VIDEO_ID 와 NEW_TITLE 이 필요합니다.");
if (newTitle.length > 100) throw new Error(`제목이 ${newTitle.length}자입니다(유튜브 최대 100자).`);
if (/[<>]/.test(newTitle)) throw new Error("유튜브 제목에는 < > 를 쓸 수 없습니다.");

const token = await getYoutubeAccessToken();
const H = { Authorization: `Bearer ${token}` };

type Snippet = {
  title: string;
  description: string;
  tags?: string[];
  categoryId: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
};
const res = (await (
  await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}`, {
    headers: H,
  })
).json()) as { items?: Array<{ id: string; snippet: Snippet }> };
const s = res.items?.[0]?.snippet;
if (!s) throw new Error(`영상을 찾지 못했습니다: ${videoId}`);

console.log(`영상 ${videoId}${apply ? " (실제 변경 모드)" : " (미리보기 모드)"}`);
console.log(`  현재: ${s.title}`);
console.log(`  변경: ${newTitle}`);
if (!apply) process.exit(0);
if (s.title === newTitle) {
  console.log("이미 같은 제목이라 변경하지 않습니다.");
  process.exit(0);
}

// part=snippet 업데이트는 snippet 을 통째로 덮는다 — 쓰기 가능한 필드를 현재 값 그대로
// 싣지 않으면 설명·태그·언어 설정이 지워진다. 응답을 그대로 보내면 읽기 전용 필드 때문에 거부된다.
const snippet: Snippet = {
  title: newTitle,
  description: s.description,
  tags: s.tags ?? [],
  categoryId: s.categoryId,
  ...(s.defaultLanguage ? { defaultLanguage: s.defaultLanguage } : {}),
  ...(s.defaultAudioLanguage ? { defaultAudioLanguage: s.defaultAudioLanguage } : {}),
};
const up = await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet", {
  method: "PUT",
  headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify({ id: videoId, snippet }),
});
if (!up.ok) {
  console.error(`❌ 변경 실패 (HTTP ${up.status}): ${(await up.text()).slice(0, 300)}`);
  process.exit(1);
}
console.log("✅ 제목 변경 완료");

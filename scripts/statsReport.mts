/**
 * 유튜브·인스타그램 최근 게시물의 조회수/반응 리포트 (읽기 전용, 무료).
 * 사용: npx tsx scripts/statsReport.mts [최근 개수=15]
 * 쿼터: 유튜브 약 3~5유닛 (channels 1 + playlistItems 1~ + videos.list 1) — 사실상 무료.
 */
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";

const limit = Math.min(50, Number(process.argv[2] || "15") || 15);
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString("ko-KR");

// ---------- YouTube ----------
try {
  const token = await getYoutubeAccessToken();
  const H = { Authorization: `Bearer ${token}` };
  const ch = (await (
    await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=contentDetails,statistics&mine=true",
      { headers: H },
    )
  ).json()) as {
    items?: Array<{
      contentDetails: { relatedPlaylists: { uploads: string } };
      statistics: { subscriberCount?: string; viewCount?: string; videoCount?: string };
    }>;
  };
  const c = ch.items?.[0];
  if (!c) throw new Error("채널 조회 실패");
  console.log("=== 유튜브 채널 ===");
  console.log(
    `구독자 ${fmt(c.statistics.subscriberCount)}명 | 총 조회수 ${fmt(c.statistics.viewCount)}회 | 영상 ${fmt(c.statistics.videoCount)}개`,
  );

  const pl = (await (
    await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=${limit}&playlistId=${c.contentDetails.relatedPlaylists.uploads}`,
      { headers: H },
    )
  ).json()) as { items?: Array<{ contentDetails: { videoId: string } }> };
  const ids = (pl.items ?? []).map((i) => i.contentDetails.videoId);

  const vids = (await (
    await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(",")}`,
      { headers: H },
    )
  ).json()) as {
    items?: Array<{
      id: string;
      snippet: { title: string; publishedAt: string };
      statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
    }>;
  };
  console.log(`\n=== 유튜브 최근 ${ids.length}개 ===`);
  for (const v of vids.items ?? []) {
    console.log(
      `[${v.snippet.publishedAt.slice(0, 10)}] 조회 ${fmt(v.statistics.viewCount)} | ` +
        `좋아요 ${fmt(v.statistics.likeCount)} | 댓글 ${fmt(v.statistics.commentCount)} | ` +
        `${v.snippet.title.slice(0, 40)} (${v.id})`,
    );
  }
} catch (e) {
  console.warn(`유튜브 통계 실패: ${e instanceof Error ? e.message : e}`);
}

// ---------- Instagram ----------
try {
  const igToken = process.env.IG_ACCESS_TOKEN;
  if (!igToken) throw new Error("IG_ACCESS_TOKEN 미설정");
  const media = (await (
    await fetch(
      `https://graph.instagram.com/me/media?fields=id,caption,like_count,comments_count,timestamp,permalink&limit=${limit}&access_token=${igToken}`,
    )
  ).json()) as {
    data?: Array<{
      id: string;
      caption?: string;
      like_count?: number;
      comments_count?: number;
      timestamp: string;
      permalink?: string;
    }>;
    error?: { message?: string };
  };
  if (!media.data) throw new Error(JSON.stringify(media.error ?? media).slice(0, 200));
  console.log(`\n=== 인스타그램 최근 ${media.data.length}개 ===`);
  for (const m of media.data) {
    // 조회수(릴스 재생수)는 insights 로 — 실패해도 좋아요/댓글은 표시
    let views = "";
    try {
      const ins = (await (
        await fetch(
          `https://graph.instagram.com/${m.id}/insights?metric=views&access_token=${igToken}`,
        )
      ).json()) as { data?: Array<{ values?: Array<{ value?: number }> }> };
      const v = ins.data?.[0]?.values?.[0]?.value;
      if (v != null) views = `조회 ${fmt(v)} | `;
    } catch {
      /* insights 미지원 미디어는 생략 */
    }
    const head = (m.caption ?? "").split("\n")[0].slice(0, 34);
    console.log(
      `[${m.timestamp.slice(0, 10)}] ${views}좋아요 ${fmt(m.like_count)} | 댓글 ${fmt(m.comments_count)} | ${head}`,
    );
  }
} catch (e) {
  console.warn(`인스타 통계 실패: ${e instanceof Error ? e.message : e}`);
}

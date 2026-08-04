/**
 * 이미 게시된 유튜브 영상의 제목·설명·태그에서 연령제한 유발 표현을
 * 찾아 중립 표현으로 일괄 수정한다.
 *
 * 사용: npx tsx scripts/fixPublishedText.mts [--apply]
 *   (기본은 미리보기 — 무엇이 어떻게 바뀌는지만 출력. --apply 를 붙여야 실제 수정)
 * 쿼터: videos.list 1/50개 + videos.update 50/건 — 수정 대상만 호출.
 */
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";
import { findSensitiveTerms, softenText } from "../src/lib/safeText.js";

const apply = process.argv.includes("--apply");
const token = await getYoutubeAccessToken();
const H = { Authorization: `Bearer ${token}` };

// 1) 내 채널 업로드 목록
const ch = (await (
  await fetch("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true", {
    headers: H,
  })
).json()) as { items?: Array<{ contentDetails: { relatedPlaylists: { uploads: string } } }> };
const uploads = ch.items?.[0]?.contentDetails.relatedPlaylists.uploads;
if (!uploads) throw new Error(`채널 조회 실패: ${JSON.stringify(ch).slice(0, 200)}`);

const videoIds: string[] = [];
let pageToken = "";
do {
  const pl = (await (
    await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${pageToken ? `&pageToken=${pageToken}` : ""}`,
      { headers: H },
    )
  ).json()) as {
    items?: Array<{ contentDetails: { videoId: string } }>;
    nextPageToken?: string;
  };
  for (const it of pl.items ?? []) videoIds.push(it.contentDetails.videoId);
  pageToken = pl.nextPageToken ?? "";
} while (pageToken);
console.log(`채널 영상 ${videoIds.length}개 검사${apply ? " (실제 수정 모드)" : " (미리보기 모드)"}`);

// 2) 50개씩 snippet 조회 → 위험 표현 탐지
type Snippet = {
  title: string;
  description: string;
  tags?: string[];
  categoryId: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
};
let flaggedCount = 0;
let fixedCount = 0;

for (let i = 0; i < videoIds.length; i += 50) {
  const batch = videoIds.slice(i, i + 50);
  const res = (await (
    await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${batch.join(",")}`,
      { headers: H },
    )
  ).json()) as { items?: Array<{ id: string; snippet: Snippet }> };

  for (const v of res.items ?? []) {
    const s = v.snippet;
    const hits = findSensitiveTerms([s.title, s.description, ...(s.tags ?? [])]);
    if (!hits.length) continue;
    flaggedCount++;

    const next: Snippet = {
      ...s,
      title: softenText(s.title).slice(0, 100),
      description: softenText(s.description),
      tags: (s.tags ?? []).map(softenText),
    };
    console.log(`\n🚩 ${v.id} — 걸린 표현: ${hits.join(", ")}`);
    if (next.title !== s.title) console.log(`   제목: ${s.title}\n     → ${next.title}`);
    const before = firstHitLine(s.description, hits);
    if (before) console.log(`   설명: ${before}\n     → ${softenText(before)}`);

    if (!apply) continue;

    // 3) 수정 적용 (snippet 전체를 되돌려보내야 기존 값이 지워지지 않음)
    const up = await fetch(
      "https://www.googleapis.com/youtube/v3/videos?part=snippet",
      {
        method: "POST",
        headers: { ...H, "Content-Type": "application/json" },
        body: JSON.stringify({ id: v.id, snippet: next }),
      },
    );
    if (up.ok) {
      fixedCount++;
      console.log("   ✅ 수정 완료");
    } else {
      console.warn(`   ❌ 수정 실패: HTTP ${up.status} ${(await up.text()).slice(0, 200)}`);
    }
  }
}

console.log(
  `\n완료: 위험 표현 포함 ${flaggedCount}개` +
    (apply ? `, 수정 ${fixedCount}개` : " (미리보기 — --apply 로 실제 수정)"),
);

/** 설명에서 걸린 표현 주변만 잘라 미리보기용으로 반환 (앞뒤 50자) */
function firstHitLine(desc: string, hits: string[]): string | undefined {
  for (const h of hits) {
    const at = desc.indexOf(h);
    if (at < 0) continue;
    const from = Math.max(0, at - 50);
    return (from > 0 ? "…" : "") + desc.slice(from, at + h.length + 50).replace(/\n/g, " ") + "…";
  }
  return undefined;
}

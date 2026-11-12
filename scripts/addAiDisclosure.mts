/**
 * 이미 올린 영상 설명란에 'AI 음성 내레이션' 고지 한 줄을 덧붙인다(11/12, 수익창출 심사 대비).
 * 11/8 이후 롱폼은 코드가 자동으로 붙이지만, 그 전 롱폼 20편에는 없었다(주간 YPP 리포트 ③).
 *
 *   npx tsx scripts/addAiDisclosure.mts            # 미리보기
 *   npx tsx scripts/addAiDisclosure.mts --apply    # 실제 수정
 *   --shorts 를 붙이면 쇼츠도 포함(기본은 3분 넘는 롱폼만)
 *
 * - 옛 '새미했다' 영상(2026-01-01 이전)은 절대 건드리지 않는다(scripts/legacyGuard.mts).
 * - 제목·태그·나머지 설명은 그대로. 설명 맨 끝에 한 줄만 추가하고, 이미 'AI 음성'이 있으면 건너뛴다.
 * - 쿼터: 목록 조회 몇 unit + 수정 50/건.
 */
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";
import { isLegacyVideo } from "./legacyGuard.mjs";

const apply = process.argv.includes("--apply");
const withShorts = process.argv.includes("--shorts");
const LINE = "AI 음성 내레이션을 사용했습니다. 실제 기록을 공개 자료에 근거해 재구성한 해설입니다.";
const token = await getYoutubeAccessToken();
const H = { Authorization: `Bearer ${token}` };

const ch = (await (await fetch("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true", { headers: H })).json()) as {
  items?: Array<{ contentDetails: { relatedPlaylists: { uploads: string } } }>;
};
const uploads = ch.items?.[0]?.contentDetails.relatedPlaylists.uploads;
if (!uploads) throw new Error(`채널 조회 실패: ${JSON.stringify(ch).slice(0, 200)}`);

const ids: string[] = [];
let pageToken = "";
do {
  const pl = (await (
    await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${pageToken ? `&pageToken=${pageToken}` : ""}`,
      { headers: H },
    )
  ).json()) as { items?: Array<{ contentDetails: { videoId: string; videoPublishedAt?: string } }>; nextPageToken?: string };
  for (const it of pl.items ?? []) if (!isLegacyVideo(it.contentDetails.videoPublishedAt)) ids.push(it.contentDetails.videoId);
  pageToken = pl.nextPageToken ?? "";
} while (pageToken);

type Snippet = {
  title: string;
  description: string;
  tags?: string[];
  categoryId: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  publishedAt?: string;
};
let todo = 0;
let done = 0;
for (let i = 0; i < ids.length; i += 50) {
  const res = (await (
    await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${ids.slice(i, i + 50).join(",")}`, { headers: H })
  ).json()) as { items?: Array<{ id: string; snippet: Snippet; contentDetails: { duration: string } }> };
  for (const v of res.items ?? []) {
    const s = v.snippet;
    if (isLegacyVideo(s.publishedAt)) continue; // 이중 확인
    const d = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(v.contentDetails.duration);
    const sec = d ? Number(d[1] ?? 0) * 3600 + Number(d[2] ?? 0) * 60 + Number(d[3] ?? 0) : 0;
    if (sec <= 180 && !withShorts) continue;
    if (/AI 음성/.test(s.description)) continue;
    const description = `${s.description.trimEnd()}\n\n${LINE}`;
    if (Buffer.byteLength(description, "utf8") > 4990) {
      console.log(`⚠️ ${v.id} 설명란이 길어 건너뜀 — ${s.title.slice(0, 40)}`);
      continue;
    }
    todo++;
    console.log(`${apply ? "✏️" : "👀"} ${s.publishedAt?.slice(0, 10)} ${v.id} ${s.title.slice(0, 50)}`);
    if (!apply) continue;
    const next: Snippet = {
      title: s.title,
      description,
      tags: s.tags,
      categoryId: s.categoryId,
      ...(s.defaultLanguage ? { defaultLanguage: s.defaultLanguage } : {}),
      ...(s.defaultAudioLanguage ? { defaultAudioLanguage: s.defaultAudioLanguage } : {}),
    };
    const up = await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet", {
      method: "PUT",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ id: v.id, snippet: next }),
    });
    if (up.ok) done++;
    else console.warn(`   ❌ 수정 실패: HTTP ${up.status} ${(await up.text()).slice(0, 200)}`);
  }
}
console.log(`\n대상 ${todo}편${apply ? `, 수정 ${done}편` : " (미리보기 — --apply 로 실제 수정)"}`);
if (apply && done < todo) process.exitCode = 1;

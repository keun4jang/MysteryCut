/**
 * 구조 점검(11/15, 사장님 "잘하고 있는지 체크하고 피드백") — 읽기 전용, 무료.
 *
 *   npx tsx scripts/structureAudit.mts
 *
 * A. 우리 채널: 최근 90일 영상별 조회·평균 시청률·평균 시청시간·구독 증가(쇼츠/롱폼 따로),
 *    상위·하위 롱폼의 시청 유지 곡선(어디서 빠지는가)
 * B. 같은 장르 잘되는 영상: 한국 미스터리 검색 상위(최근 180일) 영상의 길이·조회·제목 —
 *    결과물이 아니라 구조(길이, 제목 틀, 채널 규모 대비 조회)를 본다. 우리 채널은 제외.
 * 어떤 영상도 수정하지 않는다. 옛 '새미했다' 영상(2026-01-01 이전)은 A 에서 뺀다.
 */
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";
import { isLegacyVideo } from "./legacyGuard.mjs";

const token = await getYoutubeAccessToken();
const H = { Authorization: `Bearer ${token}` };
const day = (o: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + o);
  return d.toISOString().slice(0, 10);
};
async function get<T>(url: string): Promise<T | null> {
  const r = await fetch(url, { headers: H });
  if (!r.ok) {
    console.log(`❌ ${r.status} ${url.split("?")[0]} ${(await r.text()).slice(0, 160)}`);
    return null;
  }
  return (await r.json()) as T;
}
const secs = (d: string) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d);
  return m ? +(m[1] ?? 0) * 3600 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0) : 0;
};
type V = { id: string; snippet: { title: string; publishedAt: string; channelId: string; channelTitle: string }; contentDetails: { duration: string }; statistics: { viewCount?: string; likeCount?: string; commentCount?: string } };
async function videos(ids: string[]): Promise<V[]> {
  const out: V[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const j = await get<{ items?: V[] }>(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${ids.slice(i, i + 50).join(",")}`);
    out.push(...(j?.items ?? []));
  }
  return out;
}

// ── A. 우리 채널 ──
const me = await get<{ items?: Array<{ id: string }> }>("https://www.googleapis.com/youtube/v3/channels?part=id&mine=true");
const myId = me?.items?.[0]?.id ?? "";
const rep = await get<{ rows?: unknown[][] }>(
  `https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({
    ids: "channel==MINE",
    startDate: day(-90),
    endDate: day(0),
    metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained",
    dimensions: "video",
    sort: "-views",
    maxResults: "200",
  })}`,
);
const rows = rep?.rows ?? [];
const info = new Map((await videos(rows.map((r) => String(r[0])))).map((v) => [v.id, v]));
const mine = rows
  .map((r) => ({ id: String(r[0]), views: +r[1]!, min: +r[2]!, avd: +r[3]!, pct: +r[4]!, subs: +r[5]!, v: info.get(String(r[0])) }))
  .filter((x) => x.v && !isLegacyVideo(x.v.snippet.publishedAt));
const fmt = (x: (typeof mine)[0]) =>
  `${x.v!.snippet.publishedAt.slice(0, 10)} ${Math.round(secs(x.v!.contentDetails.duration) / 6) / 10}분 조회${x.views} 시청률${x.pct.toFixed(0)}% 평균${x.avd}초 구독+${x.subs} | ${x.v!.snippet.title.slice(0, 50)}`;
for (const [label, list] of [
  ["쇼츠", mine.filter((x) => secs(x.v!.contentDetails.duration) <= 180)],
  ["롱폼", mine.filter((x) => secs(x.v!.contentDetails.duration) > 180)],
] as const) {
  console.log(`\n=== A. 우리 ${label} (최근 90일, 조회 순) ${list.length}편 ===`);
  list.slice(0, 12).forEach((x) => console.log("▲ " + fmt(x)));
  console.log("...");
  list.slice(-6).forEach((x) => console.log("▼ " + fmt(x)));
  const tot = list.reduce((n, x) => n + x.views, 0);
  console.log(`합계 조회 ${tot}, 시청 ${Math.round(list.reduce((n, x) => n + x.min, 0))}분, 구독 +${list.reduce((n, x) => n + x.subs, 0)}`);
}

// 상위 3·하위 2 롱폼 유지 곡선
const lfs = mine.filter((x) => secs(x.v!.contentDetails.duration) > 180);
for (const x of [...lfs.slice(0, 3), ...lfs.slice(-2)]) {
  const c = await get<{ rows?: unknown[][] }>(
    `https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({
      ids: "channel==MINE",
      startDate: "2026-01-01",
      endDate: day(0),
      metrics: "audienceWatchRatio",
      dimensions: "elapsedVideoTimeRatio",
      filters: `video==${x.id}`,
    })}`,
  );
  const pts = (c?.rows ?? []).filter((r) => [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.95].some((p) => Math.abs(+r[0]! - p) < 0.006));
  console.log(`\n유지곡선 ${x.v!.snippet.title.slice(0, 40)} (${Math.round(secs(x.v!.contentDetails.duration) / 60)}분): ${pts.map((r) => `${Math.round(+r[0]! * 100)}%→${(+r[1]! * 100).toFixed(0)}`).join(" ")}`);
}

// ── B. 같은 장르 잘되는 영상 ──
const QUERIES = ["미스터리 사건", "미제사건", "실종 미스터리", "세계 미스터리 다큐"];
const found = new Set<string>();
for (const q of QUERIES) {
  const s = await get<{ items?: Array<{ id: { videoId?: string } }> }>(
    `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
      part: "id",
      q,
      type: "video",
      regionCode: "KR",
      relevanceLanguage: "ko",
      order: "viewCount",
      publishedAfter: new Date(Date.now() - 180 * 86400000).toISOString(),
      maxResults: "25",
    })}`,
  );
  for (const it of s?.items ?? []) if (it.id.videoId) found.add(it.id.videoId);
}
const bench = (await videos([...found])).filter((v) => v.snippet.channelId !== myId);
const chIds = [...new Set(bench.map((v) => v.snippet.channelId))];
const subs = new Map<string, number>();
for (let i = 0; i < chIds.length; i += 50) {
  const j = await get<{ items?: Array<{ id: string; statistics: { subscriberCount?: string } }> }>(
    `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${chIds.slice(i, i + 50).join(",")}`,
  );
  for (const c of j?.items ?? []) subs.set(c.id, +(c.statistics.subscriberCount ?? 0));
}
const lf = bench.filter((v) => secs(v.contentDetails.duration) > 180).sort((a, b) => +b.statistics.viewCount! - +a.statistics.viewCount!);
console.log(`\n=== B. 미스터리 검색 상위 롱폼 (최근 180일, 한국) ${lf.length}편 ===`);
for (const v of lf.slice(0, 40)) {
  const sc = subs.get(v.snippet.channelId) ?? 0;
  const vw = +(v.statistics.viewCount ?? 0);
  console.log(
    `${Math.round(secs(v.contentDetails.duration) / 60)}분 조회${vw} 구독자${sc} 조회/구독${sc ? (vw / sc).toFixed(1) : "?"} 댓글${v.statistics.commentCount ?? 0} | ${v.snippet.channelTitle.slice(0, 14)} | ${v.snippet.title.slice(0, 60)}`,
  );
}
const buckets: Record<string, number[]> = {};
for (const v of lf) {
  const m = secs(v.contentDetails.duration) / 60;
  const k = m < 10 ? "3-10분" : m < 20 ? "10-20분" : m < 40 ? "20-40분" : m < 90 ? "40-90분" : "90분+";
  (buckets[k] ??= []).push(+(v.statistics.viewCount ?? 0));
}
console.log("\n길이별 편수·조회 중앙값:");
for (const [k, a] of Object.entries(buckets)) console.log(`  ${k}: ${a.length}편, 중앙값 ${a.sort((x, y) => x - y)[Math.floor(a.length / 2)]}`);
const sh = bench.filter((v) => secs(v.contentDetails.duration) <= 180).sort((a, b) => +b.statistics.viewCount! - +a.statistics.viewCount!);
console.log(`\n=== B. 미스터리 검색 상위 쇼츠 ${sh.length}편 ===`);
for (const v of sh.slice(0, 15)) console.log(`조회${v.statistics.viewCount} | ${v.snippet.channelTitle.slice(0, 14)} | ${v.snippet.title.slice(0, 60)}`);

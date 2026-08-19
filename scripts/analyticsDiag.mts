/**
 * 채널 심층 진단 (YouTube Analytics API v2, 읽기 전용·무료).
 *
 * 목적: "구독자 15,100명이 실제로 활성인가"와 "쇼츠가 어디서 막히는가"를
 * 조회수만으로는 알 수 없으므로, 시청 지속·구독 출처·유입 경로로 확인한다.
 * 롱폼 전환 여부를 결정하기 전에 반드시 봐야 하는 수치들.
 *
 * 필요 스코프: https://www.googleapis.com/auth/yt-analytics.readonly
 *   (없으면 403 — OAuth Playground 재인증 필요. 이 스크립트가 그 사실을 알려준다)
 *
 * 사용: npx tsx scripts/analyticsDiag.mts
 */
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";

const token = await getYoutubeAccessToken();
const H = { Authorization: `Bearer ${token}` };

const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const TODAY = day(0);
const D28 = day(-28);
const D90 = day(-90);
const ALL = "2020-01-01";

/** Analytics 리포트 1건 조회. 실패해도 다른 질의는 계속 돌도록 사유만 반환. */
async function report(
  label: string,
  params: Record<string, string>,
): Promise<{ headers: string[]; rows: unknown[][] } | null> {
  const qs = new URLSearchParams({ ids: "channel==MINE", ...params });
  const res = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${qs}`, {
    headers: H,
  });
  const text = await res.text();
  if (!res.ok) {
    const scopeIssue = /insufficient|scope|forbidden/i.test(text);
    console.log(`\n❌ [${label}] 실패 (HTTP ${res.status})${scopeIssue ? " — 스코프 부족 의심" : ""}`);
    console.log(`   ${text.slice(0, 240)}`);
    return null;
  }
  const json = JSON.parse(text) as {
    columnHeaders?: Array<{ name: string }>;
    rows?: unknown[][];
  };
  return {
    headers: (json.columnHeaders ?? []).map((c) => c.name),
    rows: json.rows ?? [],
  };
}

function table(label: string, r: { headers: string[]; rows: unknown[][] } | null, limit = 25) {
  if (!r) return;
  console.log(`\n=== ${label} ===`);
  if (!r.rows.length) {
    console.log("(데이터 없음)");
    return;
  }
  console.log(r.headers.join(" | "));
  for (const row of r.rows.slice(0, limit)) {
    console.log(row.map((v) => (typeof v === "number" ? v.toLocaleString("ko-KR") : v)).join(" | "));
  }
  if (r.rows.length > limit) console.log(`... 외 ${r.rows.length - limit}행`);
}

console.log(`진단 기준일: ${TODAY} (28일=${D28}, 90일=${D90})`);

// ── ① 가장 중요: 구독자가 실제로 보고 있는가 ──
table(
  "① 최근 90일 구독/비구독 시청 비교 (구독자 활성도의 핵심 지표)",
  await report("subscribedStatus", {
    startDate: D90,
    endDate: TODAY,
    metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
    dimensions: "subscribedStatus",
  }),
);

// ── ② 채널 전체 요약 ──
table(
  "② 최근 28일 채널 요약",
  await report("summary28", {
    startDate: D28,
    endDate: TODAY,
    metrics:
      "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares",
  }),
);
table(
  "③ 최근 90일 채널 요약",
  await report("summary90", {
    startDate: D90,
    endDate: TODAY,
    metrics:
      "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost",
  }),
);

// ── ③ 구독자가 어디서 왔는가 (15,100명의 출처 추적) ──
table(
  "④ 구독자를 가장 많이 만든 영상 (전 기간) — 15,100명의 출처",
  await report("subsByVideo", {
    startDate: ALL,
    endDate: TODAY,
    metrics: "subscribersGained,subscribersLost,views",
    dimensions: "video",
    sort: "-subscribersGained",
    maxResults: "20",
  }),
);

// ── ④ 콘텐츠 유형별 (쇼츠 vs 롱폼) ──
table(
  "⑤ 최근 90일 콘텐츠 유형별 (쇼츠/롱폼 구분)",
  await report("contentType", {
    startDate: D90,
    endDate: TODAY,
    metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
    dimensions: "creatorContentType",
  }),
);

// ── ⑤ 유입 경로 ──
table(
  "⑥ 최근 90일 트래픽 소스",
  await report("traffic", {
    startDate: D90,
    endDate: TODAY,
    metrics: "views,estimatedMinutesWatched,averageViewDuration",
    dimensions: "insightTrafficSourceType",
    sort: "-views",
  }),
);

// ── ⑥ 국가별 (한국 65% / 미국 22%의 실체) ──
table(
  "⑦ 최근 90일 국가별 시청 품질",
  await report("country", {
    startDate: D90,
    endDate: TODAY,
    metrics: "views,averageViewDuration,averageViewPercentage,subscribersGained",
    dimensions: "country",
    sort: "-views",
    maxResults: "10",
  }),
);

// ── ⑦ 영상별 시청 지속 (조회수 상위) ──
table(
  "⑧ 최근 90일 조회수 상위 영상의 시청 지속률",
  await report("videoRetention", {
    startDate: D90,
    endDate: TODAY,
    metrics: "views,averageViewDuration,averageViewPercentage,subscribersGained,likes,shares",
    dimensions: "video",
    sort: "-views",
    maxResults: "20",
  }),
);

// ── ⑧ 일자별 추세 ──
table(
  "⑨ 최근 28일 일자별 추세",
  await report("daily", {
    startDate: D28,
    endDate: TODAY,
    metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained",
    dimensions: "day",
  }),
  40,
);

console.log("\n※ ①번 표가 핵심입니다. SUBSCRIBED 조회수가 전체의 5% 미만이면");
console.log("   15,100명은 사실상 비활성이고, 롱폼 초기 추진력을 기대할 수 없습니다.");

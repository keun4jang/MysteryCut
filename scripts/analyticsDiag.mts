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
 * 사용: npx tsx scripts/analyticsDiag.mts [롱폼videoId]
 *   videoId 를 생략하면 data/latestLongform.json 의 최신 롱폼을 본다.
 */
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";
import { loadLatestLongform } from "../src/lib/latestLongform.js";

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

// ── ⑨ 롱폼 시청 지속률 곡선 (몇 % 지점에서 이탈하는가) ──
// ★평균 시청 완료율(⑤번, 예: 19.2%) 하나만으로는 "초반 이탈"인지 "끝까지
// 골고루 새는지"를 구분할 수 없다 — 대응이 완전히 다르다(콜드오픈 문제 vs
// 본문 밀도 문제). elapsedVideoTimeRatio 로 10%씩 끊어 실제 이탈 지점을 본다.
const targetVideoId = process.argv[2] ?? (await loadLatestLongform())?.videoId;
if (targetVideoId) {
  const retention = await report(`retentionCurve:${targetVideoId}`, {
    startDate: ALL,
    endDate: TODAY,
    metrics: "audienceWatchRatio,relativeRetentionPerformance",
    dimensions: "elapsedVideoTimeRatio",
    filters: `video==${targetVideoId}`,
  });
  if (retention) {
    // 100개 포인트(1%~100%)는 로그가 너무 기니 10%p 단위로만 추린다.
    const decile = {
      headers: retention.headers,
      rows: retention.rows.filter((_, i) => (i + 1) % 10 === 0),
    };
    table(`⑩ 롱폼 ${targetVideoId} 시청 지속률 곡선 (10%p 단위)`, decile, 10);
    console.log(
      "   audienceWatchRatio=이 지점까지 본 비율, relativeRetentionPerformance=같은 길이 다른 영상 대비(1.0=평균).",
    );
    console.log("   앞쪽(10~30%)에서 이미 크게 꺾이면 콜드오픈 문제, 뒤로 갈수록 완만히 새면 본문 밀도 문제.");
  }
  table(
    `⑩-b 롱폼 ${targetVideoId} 누적 성적`,
    await report(`latestTotals:${targetVideoId}`, {
      startDate: ALL,
      endDate: TODAY,
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained",
      filters: `video==${targetVideoId}`,
    }),
  );
  table(
    `⑩-c 롱폼 ${targetVideoId} 유입 경로 — 조회가 어디서 왔나`,
    await report(`latestTraffic:${targetVideoId}`, {
      startDate: ALL,
      endDate: TODAY,
      metrics: "views,estimatedMinutesWatched,averageViewDuration",
      dimensions: "insightTrafficSourceType",
      filters: `video==${targetVideoId}`,
      sort: "-views",
    }),
  );
} else {
  console.log("\n⑩ 롱폼 시청 지속률 곡선 — 스킵(아직 게시된 롱폼 없음, data/latestLongform.json 비어있음)");
}

// ── ⑪~⑭ 수익화(YPP) 판단용 ──
// YPP 조건은 "최근 365일 공개 롱폼 시청시간 4,000시간"이고 쇼츠 시청시간은 안 친다.
// ⑤번(90일)만으로는 이 숫자를 알 수 없어 365일 기준을 따로 본다.
const D365 = day(-365);
// 값 표기는 응답과 같은 camelCase — "VIDEO_ON_DEMAND" 로 쓰면 400(실측 2026-09-28).
const VOD = "creatorContentType==videoOnDemand";

const ypp = await report("ypp365", {
  startDate: D365,
  endDate: TODAY,
  metrics: "views,estimatedMinutesWatched",
  dimensions: "creatorContentType",
});
table("⑪ 최근 365일 콘텐츠 유형별 시청 (YPP 기준 기간)", ypp);
if (ypp) {
  const iType = ypp.headers.indexOf("creatorContentType");
  const iMin = ypp.headers.indexOf("estimatedMinutesWatched");
  const vod = ypp.rows.find((r) => String(r[iType]) === "videoOnDemand");
  const hours = vod ? Number(vod[iMin]) / 60 : 0;
  console.log(
    `   → 롱폼 시청시간 ${hours.toFixed(1)}시간 / 4,000시간 (${((hours / 4000) * 100).toFixed(2)}%) — 쇼츠는 합산 안 됨.`,
  );
  console.log("     (스튜디오 '수익 창출' 탭 수치와 약간 다를 수 있다: 거기는 공개 영상만, 이 API 는 추정치)");
}

/** 영상 ID → 제목·길이(초). Data API 1회 호출(50개까지). */
async function videoInfo(ids: string[]): Promise<Map<string, { title: string; seconds: number }>> {
  const out = new Map<string, { title: string; seconds: number }>();
  if (!ids.length) return out;
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${ids.slice(0, 50).join(",")}`,
    { headers: H },
  );
  if (!res.ok) return out;
  const json = (await res.json()) as {
    items?: Array<{ id: string; snippet: { title: string }; contentDetails: { duration: string } }>;
  };
  for (const v of json.items ?? []) {
    const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(v.contentDetails.duration);
    const seconds = m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
    out.set(v.id, { title: v.snippet.title, seconds });
  }
  return out;
}

const perLong = await report("longformByVideo", {
  startDate: D365,
  endDate: TODAY,
  metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained",
  dimensions: "video",
  filters: VOD,
  sort: "-estimatedMinutesWatched",
  maxResults: "40",
});
if (perLong) {
  const info = await videoInfo(perLong.rows.map((r) => String(r[0])));
  table(
    "⑫ 최근 365일 롱폼 영상별 (시청시간 순) — 어떤 롱폼이 시간을 벌었나",
    {
      headers: ["길이", "제목", ...perLong.headers],
      rows: perLong.rows.map((r) => {
        const v = info.get(String(r[0]));
        const len = v ? `${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, "0")}` : "?";
        return [len, (v?.title ?? "?").slice(0, 36), ...r];
      }),
    },
    40,
  );
}

table(
  "⑬ 최근 28일 롱폼만 요약 (몰아보기 전환 이후 속도 확인용)",
  await report("vod28", {
    startDate: D28,
    endDate: TODAY,
    metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
    filters: VOD,
  }),
);

table(
  "⑭ 최근 90일 롱폼 유입 경로 — 롱폼 시청자가 어디서 오나",
  await report("vodTraffic", {
    startDate: D90,
    endDate: TODAY,
    metrics: "views,estimatedMinutesWatched,averageViewDuration",
    dimensions: "insightTrafficSourceType",
    filters: VOD,
    sort: "-views",
  }),
);

console.log("\n※ ①번 표가 핵심입니다. SUBSCRIBED 조회수가 전체의 5% 미만이면");
console.log("   15,100명은 사실상 비활성이고, 롱폼 초기 추진력을 기대할 수 없습니다.");

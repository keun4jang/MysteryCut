/**
 * 수익창출(YPP) 준비 주간 리포트 (11/12) — 읽기 전용, 무료, 사장님 손 안 감.
 *
 *   npx tsx scripts/yppReport.mts
 *
 * ① 조건 진행: 구독자 1,000 / 최근 365일 '지금 공개 중인 롱폼' 시청시간 4,000시간
 *    (쇼츠·비공개 영상은 합산 안 됨 — 옛 '새미했다' 영상은 비공개라 빠진다)
 *    + 최근 28일 속도로 3,000·4,000·8,000시간 도달 예상일(8,000은 2027-02 변경 보도, 공식 확인 전)
 * ② 롱폼별 시청시간(단일 사건 vs 몰아보기) — 수요일 형식 결정 규칙(0.7×/0.4×) 권고
 * ③ 심사 대비 점검: 최근 롱폼 20편의 제목(상투 표현)·설명란(출처·AI 음성 고지·챕터)
 * ④ 두 조건과 ③이 모두 통과할 때만 'READY TO APPLY' — 신청 버튼은 사장님이 누른다(재거절 시 90일 대기)
 *
 * 어떤 영상도 수정·삭제·댓글하지 않는다. 옛 영상(2026-01-01 이전)은 집계에서도 뺀다.
 */
import fs from "node:fs";
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";
import { BANNED_TITLE_RE } from "../src/lib/titleGuard.js";
import { isLegacyVideo } from "./legacyGuard.mjs";

type HistoryPost = { caseKey: string; title: string; at: string; format?: string; mode?: string; videoId?: string };

const token = await getYoutubeAccessToken();
const H = { Authorization: `Bearer ${token}` };
const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const TODAY = day(0);
const out: string[] = [];
const say = (s = "") => {
  console.log(s);
  out.push(s);
};

async function api<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: H });
  if (!res.ok) {
    say(`❌ 조회 실패 HTTP ${res.status}: ${url.split("?")[0]} — ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  return (await res.json()) as T;
}

async function analytics(params: Record<string, string>) {
  const qs = new URLSearchParams({ ids: "channel==MINE", ...params });
  return api<{ columnHeaders?: Array<{ name: string }>; rows?: unknown[][] }>(
    `https://youtubeanalytics.googleapis.com/v2/reports?${qs}`,
  );
}

type VideoInfo = { id: string; title: string; publishedAt: string; privacy: string; seconds: number; description: string };
async function videos(ids: string[]): Promise<Map<string, VideoInfo>> {
  const m = new Map<string, VideoInfo>();
  for (let i = 0; i < ids.length; i += 50) {
    const j = await api<{
      items?: Array<{
        id: string;
        snippet: { title: string; publishedAt: string; description: string };
        status: { privacyStatus: string };
        contentDetails: { duration: string };
      }>;
    }>(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails&id=${ids.slice(i, i + 50).join(",")}`);
    for (const v of j?.items ?? []) {
      const d = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(v.contentDetails.duration);
      const seconds = d ? Number(d[1] ?? 0) * 3600 + Number(d[2] ?? 0) * 60 + Number(d[3] ?? 0) : 0;
      m.set(v.id, {
        id: v.id,
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        privacy: v.status.privacyStatus,
        seconds,
        description: v.snippet.description,
      });
    }
  }
  return m;
}

/** 롱폼별 시청 분(기간 지정) */
async function minutesByVideo(start: string): Promise<Map<string, number>> {
  const r = await analytics({
    startDate: start,
    endDate: TODAY,
    metrics: "estimatedMinutesWatched",
    dimensions: "video",
    filters: "creatorContentType==videoOnDemand",
    sort: "-estimatedMinutesWatched",
    maxResults: "200",
  });
  return new Map((r?.rows ?? []).map((row) => [String(row[0]), Number(row[1])]));
}

say(`# 수익창출 준비 리포트 — ${TODAY}`);

// ── ① 조건 진행 ──
const ch = await api<{ items?: Array<{ statistics: { subscriberCount: string } }> }>(
  "https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true",
);
const subs = Number(ch?.items?.[0]?.statistics.subscriberCount ?? 0);

const min365 = await minutesByVideo(day(-365));
const min28 = await minutesByVideo(day(-28));
// 시청이 아직 0분인 새 롱폼도 ③ 점검에 들어가게 이력의 롱폼 videoId 도 함께 조회한다
const histIds = (JSON.parse(fs.readFileSync("data/history.json", "utf8")) as { posts: HistoryPost[] }).posts
  .filter((p) => p.format === "longform" && p.videoId)
  .map((p) => p.videoId!);
const info = await videos([...new Set([...min365.keys(), ...min28.keys(), ...histIds])]);
// 지금 공개 중이고 옛 영상이 아닌 롱폼만 센다(YPP 는 공개 영상 시청시간만 인정)
const counts = (id: string) => {
  const v = info.get(id);
  return !!v && v.privacy === "public" && !isLegacyVideo(v.publishedAt);
};
const sumH = (m: Map<string, number>) => [...m].filter(([id]) => counts(id)).reduce((n, [, x]) => n + x, 0) / 60;
const h365 = sumH(min365);
const h28 = sumH(min28);
const perDay = h28 / 28;
const eta = (goal: number) => {
  if (h365 >= goal) return "달성";
  if (perDay <= 0) return "속도 0 — 예측 불가";
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Math.ceil((goal - h365) / perDay));
  return `${d.toISOString().slice(0, 10)} 예상(최근 28일 속도 유지 시, 1년 창 만료분은 미반영)`;
};

say("\n## ① 조건 진행");
say(`- 구독자: ${subs.toLocaleString("ko-KR")} / 1,000 ${subs >= 1000 ? "✅" : "❌"}`);
say(`- 최근 365일 공개 롱폼 시청시간: ${h365.toFixed(1)}시간 / 4,000 (${((h365 / 4000) * 100).toFixed(1)}%) ${h365 >= 4000 ? "✅" : "❌"}`);
say(`- 최근 28일 속도: ${h28.toFixed(1)}시간 (하루 ${perDay.toFixed(2)}시간)`);
say(`- 3,000시간(2027-02 팬 후원 등급 보도): ${eta(3000)}`);
say(`- 4,000시간(현재 기준): ${eta(4000)}`);
say(`- 8,000시간(2027-02 광고 등급 보도, 공식 확인 전): ${eta(8000)}`);

// ── ② 형식별 성과 ──
const hist = (JSON.parse(fs.readFileSync("data/history.json", "utf8")) as { posts: HistoryPost[] }).posts;
const lfPosts = hist.filter((p) => p.format === "longform" && p.videoId);
say("\n## ② 롱폼 형식별 (게시 후 14일 이상 지난 영상, 최근 365일 시청 분)");
const byMode: Record<string, number[]> = { single: [], compilation: [] };
for (const p of lfPosts) {
  const age = (Date.now() - Date.parse(p.at)) / 86400000;
  const m = min365.get(p.videoId!) ?? 0;
  say(`- ${p.at.slice(0, 10)} [${p.mode ?? "?"}] ${p.title.slice(0, 40)} — ${m.toFixed(0)}분 (게시 ${age.toFixed(0)}일)`);
  if (age >= 14 && p.mode && byMode[p.mode]) byMode[p.mode].push(m);
}
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const [s, c] = [byMode.single, byMode.compilation];
if (s.length >= 4 && c.length >= 4) {
  const ratio = median(s) / Math.max(1, median(c));
  const rec = ratio >= 0.7 ? "수요일 단일 사건 유지" : ratio < 0.4 ? "수요일도 테마 몰아보기로(단일 사건은 2주 1회 유지)" : "4주 더 시험";
  say(`- 판정: 단일 중앙값 ${median(s).toFixed(0)}분 / 몰아보기 ${median(c).toFixed(0)}분 = ${ratio.toFixed(2)}× → ${rec}`);
} else {
  say(`- 판정 보류: 14일 지난 영상이 형식마다 4편 이상 필요(단일 ${s.length}편, 몰아보기 ${c.length}편)`);
}

// ── ③ 심사 대비 점검: 최근 공개 롱폼 20편 ──
const recentLf = [...info.values()]
  .filter((v) => v.privacy === "public" && !isLegacyVideo(v.publishedAt) && v.seconds >= 180)
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  .slice(0, 20);
say(`\n## ③ 최근 공개 롱폼 ${recentLf.length}편 점검 (제목 상투 표현·출처·AI 음성 고지·챕터)`);
let lintFail = 0;
for (const v of recentLf) {
  const issues: string[] = [];
  if (BANNED_TITLE_RE.test(v.title)) issues.push("상투 제목");
  if (!/참고 자료|위키백과|Wikipedia/.test(v.description)) issues.push("출처 없음");
  if (!/AI 음성/.test(v.description)) issues.push("AI 음성 고지 없음");
  if (!/^0:00 /m.test(v.description)) issues.push("챕터 없음");
  if (issues.length) lintFail++;
  say(`- ${issues.length ? "⚠️" : "✅"} ${v.publishedAt.slice(0, 10)} ${v.title.slice(0, 44)}${issues.length ? ` — ${issues.join(", ")}` : ""}`);
}
say(
  lintFail
    ? `- ${lintFail}편이 기준 미달. 11/8 이전 영상은 새 규칙 전이라 대부분 걸린다 — 비공개 전환 여부는 사장님 결정(시청시간 손실 vs 심사 위험).`
    : "- 전부 통과",
);

// ── ④ 신청 가능 여부 ──
const ready = subs >= 1000 && h365 >= 4000 && lintFail === 0;
say("\n## ④ 판정");
say(
  ready
    ? "🟢 READY TO APPLY — 스튜디오 '수익 창출'에서 신청하세요(신청은 사장님이 직접)."
    : `🔴 아직 신청하지 마세요 — ${[
        subs < 1000 ? "구독자 부족" : "",
        h365 < 4000 ? `시청시간 ${(4000 - h365).toFixed(0)}시간 부족` : "",
        lintFail ? `심사 점검 미달 ${lintFail}편` : "",
      ]
        .filter(Boolean)
        .join(", ")}. 거절되면 90일 뒤에야 다시 신청할 수 있습니다.`,
);

if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${out.join("\n")}\n`);

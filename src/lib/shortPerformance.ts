import fs from "node:fs/promises";
import { getYoutubeAccessToken } from "../assistants/youtubePublisher.js";
import { isLongformPost, isSameCase, type HistoryPost } from "../assistants/history.js";
import { isNonCaseTitle, isSexCrimeCase } from "./sources.js";

/**
 * 단일 사건 롱폼의 시드 고르기(11/8) — 반응이 좋았던 쇼츠 사건을 깊게 다룬다(11/3 사장님 요청).
 *
 * caseKey ↔ videoId 는 thumbnails/<날짜>-<caseKey>-<videoId>.jpg 와 이력의 videoId 로만 잇는다.
 * 통계는 videos.list(읽기 전용, 50개당 1 unit)만 쓴다 — 드라이런에서도 부른다. 어떤 영상도 수정하지 않는다.
 */

/**
 * 옛 영상 기준일 — scripts/legacyGuard.mts 의 LEGACY_CUTOFF 와 같은 값(src 는 scripts 를 import 하지 않아 복사).
 * 바꿀 때는 두 곳을 같이 바꾼다.
 */
export const LEGACY_CUTOFF = "2026-01-01T00:00:00Z";
export function isLegacyVideo(publishedAt: string | undefined): boolean {
  return !publishedAt || publishedAt < LEGACY_CUTOFF;
}

/** API 가 안 될 때 쓰는 고정 후보(11/8 분석 기준 상위 쇼츠) — 아래 필터는 똑같이 거친다 */
export const STATIC_SEED_FALLBACK = [
  "ss-meredith-victory-1950",
  "voynich-manuscript-1912",
  "kim-seon-dal-18th-century",
  "aurora-aliens-1897",
  "tasmanian-tiger-thylacine-sightings",
];

/** 감동 실화 단일 롱폼은 미스터리 단일 편이 이만큼 나간 뒤에만(11/8 계획) */
const WARM_AFTER_SINGLES = 2;
const MIN_AGE_DAYS = 7;

export interface SeedCandidate {
  post: HistoryPost;
  videoId?: string;
  views?: number;
  likes?: number;
  score: number;
  publishedAt?: string;
  /** 'api' = 실제 통계, 'fallback' = 고정 후보 */
  via: "api" | "fallback";
}

const THUMB_RE = /^(\d{4}-\d\d-\d\d)-(.+)-([A-Za-z0-9_-]{11})\.jpg$/;

/** thumbnails/ 파일명 + 이력 videoId → caseKey 별 videoId 목록. 이력에 없는 키는 버린다(파일명 오인 방지) */
export async function mapCaseVideoIds(posts: HistoryPost[], thumbDir = "thumbnails"): Promise<Map<string, string[]>> {
  const keys = new Set(posts.map((p) => p.caseKey));
  const map = new Map<string, string[]>();
  const add = (k: string, id: string) => {
    const arr = map.get(k) ?? [];
    if (!arr.includes(id)) arr.push(id);
    map.set(k, arr);
  };
  let files: string[] = [];
  try {
    files = await fs.readdir(thumbDir);
  } catch {
    /* 폴더 없음 */
  }
  for (const f of files) {
    const m = THUMB_RE.exec(f);
    if (!m || m[2].startsWith("lf-compilation") || !keys.has(m[2])) continue;
    add(m[2], m[3]);
  }
  for (const p of posts) if (p.videoId && p.format !== "longform") add(p.caseKey, p.videoId);
  return map;
}

interface VideoStat {
  id: string;
  publishedAt?: string;
  views: number;
  likes: number;
}

async function fetchStats(ids: string[]): Promise<Map<string, VideoStat>> {
  const token = await getYoutubeAccessToken();
  const out = new Map<string, VideoStat>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${batch.join(",")}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) throw new Error(`videos.list HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      items?: Array<{ id: string; snippet?: { publishedAt?: string }; statistics?: { viewCount?: string; likeCount?: string } }>;
    };
    for (const it of json.items ?? []) {
      out.set(it.id, {
        id: it.id,
        publishedAt: it.snippet?.publishedAt,
        views: Number(it.statistics?.viewCount ?? 0),
        likes: Number(it.statistics?.likeCount ?? 0),
      });
    }
  }
  return out;
}

const isWarmPost = (p: HistoryPost) => !!p.angle && p.angle.includes("감동 실화");

/** 이 쇼츠 사건이 시드가 될 수 있는가(통계와 무관한 코드 검사) */
export function seedEligible(post: HistoryPost, posts: HistoryPost[]): { ok: boolean; why: string } {
  if (isLongformPost(post)) return { ok: false, why: "롱폼 항목" };
  if (isNonCaseTitle(post.title, post.caseKey)) return { ok: false, why: "사건이 아닌 소재" };
  if (isSexCrimeCase(post.title, post.premise ?? "", post.caseKey)) return { ok: false, why: "성범죄·아동 피해 소재" };
  const singles = posts.filter((p) => p.mode === "single").length;
  if (isWarmPost(post) && singles < WARM_AFTER_SINGLES) return { ok: false, why: `감동 실화(단일 미스터리 ${singles}/${WARM_AFTER_SINGLES}편 전)` };
  const covered = posts.some((p) => (isLongformPost(p) || p.mode === "single") && isSameCase(p.caseKey, post.caseKey));
  if (covered) return { ok: false, why: "이미 롱폼으로 다룸" };
  return { ok: true, why: "" };
}

/**
 * 시드 후보를 점수순으로 돌려준다. 점수 = 조회수 × (1 + 10 × 좋아요/조회수).
 * API 실패(자격 없음·쿼터 등) 시 고정 후보로 대체. 빈 배열이면 호출부가 일반 선정으로 간다.
 */
export async function pickSeedShorts(
  posts: HistoryPost[],
  opts?: { seedVideoId?: string; now?: Date },
): Promise<SeedCandidate[]> {
  const now = opts?.now ?? new Date();
  const shorts = posts.filter((p) => !isLongformPost(p) && p.at >= LEGACY_CUTOFF.slice(0, 10));
  const idMap = await mapCaseVideoIds(posts);

  const log = (c: SeedCandidate) =>
    `${c.post.caseKey}${c.videoId ? ` (${c.videoId})` : ""}${c.views !== undefined ? ` 조회 ${c.views} · 좋아요 ${c.likes} · 점수 ${Math.round(c.score)}` : ""}`;

  // 특정 쇼츠 지정(workflow 입력 seed_video_id) — 코드 검사는 그대로 거친다
  if (opts?.seedVideoId) {
    const key = [...idMap.entries()].find(([, ids]) => ids.includes(opts.seedVideoId!))?.[0];
    const post = key ? [...shorts].reverse().find((p) => p.caseKey === key) : undefined;
    if (!post) {
      console.warn(`   ⚠️ 지정한 쇼츠 ${opts.seedVideoId} 를 이력에서 찾지 못함 — 자동 선정으로`);
    } else {
      const el = seedEligible(post, posts);
      if (el.ok) {
        console.log(`   🎯 지정 시드: ${post.title} (${post.caseKey})`);
        return [{ post, videoId: opts.seedVideoId, score: 0, via: "fallback" }];
      }
      console.warn(`   ⚠️ 지정한 쇼츠는 시드로 못 씀(${el.why}) — 자동 선정으로`);
    }
  }

  const eligible = new Map<string, HistoryPost>(); // caseKey → 최신 쇼츠 항목
  for (const p of shorts) {
    const el = seedEligible(p, posts);
    if (el.ok) eligible.set(p.caseKey, p);
  }

  try {
    const ids = [...eligible.keys()].flatMap((k) => idMap.get(k) ?? []);
    if (!ids.length) throw new Error("videoId 를 아는 후보 없음");
    const stats = await fetchStats(ids);
    const out: SeedCandidate[] = [];
    for (const [key, post] of eligible) {
      for (const id of idMap.get(key) ?? []) {
        const st = stats.get(id);
        if (!st || isLegacyVideo(st.publishedAt)) continue;
        const ageDays = (now.getTime() - Date.parse(st.publishedAt!)) / 86_400_000;
        if (ageDays < MIN_AGE_DAYS) continue;
        const score = st.views * (1 + 10 * (st.views ? st.likes / st.views : 0));
        out.push({ post, videoId: id, views: st.views, likes: st.likes, score, publishedAt: st.publishedAt, via: "api" });
      }
    }
    // 같은 사건이 쇼츠 두 편이면(merdith/meredith) 점수 높은 쪽 하나만
    const best = new Map<string, SeedCandidate>();
    for (const c of out.sort((a, b) => b.score - a.score)) {
      if (![...best.values()].some((b) => isSameCase(b.post.caseKey, c.post.caseKey))) best.set(c.post.caseKey, c);
    }
    const ranked = [...best.values()];
    if (!ranked.length) throw new Error("조건(7일 이상·옛 영상 제외)을 만족하는 후보 없음");
    console.log(`   📈 시드 후보 상위: ${ranked.slice(0, 5).map(log).join(" / ")}`);
    return ranked;
  } catch (e) {
    console.warn(`   ⚠️ 쇼츠 통계 조회 실패 — 고정 후보 사용: ${e instanceof Error ? e.message : e}`);
    const out: SeedCandidate[] = [];
    for (const key of STATIC_SEED_FALLBACK) {
      const post = [...eligible.values()].find((p) => isSameCase(p.caseKey, key));
      if (post && !out.some((c) => isSameCase(c.post.caseKey, post.caseKey))) {
        out.push({ post, videoId: idMap.get(post.caseKey)?.[0], score: 0, via: "fallback" });
      }
    }
    console.log(`   📋 고정 후보: ${out.map(log).join(" / ") || "(없음)"}`);
    return out;
  }
}

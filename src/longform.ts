import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { proposeCase, type AvoidList, type CaseProbe } from "./assistants/producer.js";
import {
  writeLongform,
  writeCompilationMeta,
  totalChars,
  countSegments,
} from "./assistants/longformProducer.js";
import { narrateLongform } from "./assistants/narrator.js";
import { attachChapterBroll, fetchThumbBg } from "./assistants/broll.js";
import { renderLongform, renderLongformThumb } from "./render.js";
import {
  publishLongform,
  buildLongformDescription,
  buildLongformDescriptionEn,
  normalizeTags,
} from "./assistants/youtubePublisher.js";
import {
  loadHistory,
  recentAvoidList,
  isDuplicate,
  isSameCase,
  isLongformPost,
  appendPost,
  type HistoryPost,
} from "./assistants/history.js";
import { persistLatestLongform } from "./lib/latestLongform.js";
import {
  gatherSources,
  politicalControversy,
  sameCaseInHistory,
  isNonCaseTitle,
  isSexCrimeCase,
  confirmCaseIdentity,
  yearsMissingFromSource,
  type SourceDoc,
} from "./lib/sources.js";
import { verifyFacts, type FactItem } from "./lib/factcheck.js";
import { reviewDesign } from "./assistants/artDirector.js";
import { longformSrt } from "./lib/captions.js";
import { dropUnreadableVisuals } from "./lib/visual/normalize.js";
import {
  pickRegionAngle,
  pickCompilationTheme,
  pickLongformTitleStyle,
  seededPick,
  CASE_TRANSITIONS,
  LONGFORM_VOICE,
  type CompilationTheme,
} from "./lib/variety.js";
import { deriveGrade } from "./lib/grade.js";
import { checkTitle, loadRecentLongformTitles, appendLongformTitle } from "./lib/titleGuard.js";
import { pickSeedShorts, type SeedCandidate } from "./lib/shortPerformance.js";
import { longformDurationInFrames, longformChapterTimestamps } from "./remotion/timing.js";
import type { LongformInputProps, LongformScript, NarratedChapter, StoryIdea } from "./types.js";

/**
 * 롱폼(가로형 사건 분석 다큐) 파이프라인.
 *
 * 2026-09-13 몰아보기(여러 사건 모음) 포맷으로 전환 — 단일 사건 방식으로 90일 롱폼 시청시간이 3.5시간에 그쳤다.
 *
 * 2026-11-08 두 형식으로 나눈다(YPP 심사 대비 + 시청시간):
 *   수요일 = 단일 사건 심층(쇼츠 성과 상위 사건을 새 원고로 깊게 — 11/3 사장님 요청, 원본성 신호가 가장 강함)
 *   토요일 = 테마 몰아보기 4건(18~22분, 한 회차 한 테마 — 실종 테마 두 편만 327·256분을 벌었다)
 * 형식은 --mode=auto|single|compilation. auto 는 수요일(KST)이면 data/longformConfig.json 의 wedMode, 그 외는 몰아보기.
 * 되돌리기: longformConfig.json 의 wedMode 를 "compilation" 으로.
 *
 * 모든 사건(몰아보기 각 꼭지 포함)은 같은 게이트를 지난다 — 사건 아닌 소재·성범죄·아동 피해 코드 검사,
 * 중복(규칙 + AI, 실패 시 탈락), 원문 분량, 제목 연도·원문 대조, 소재 안전(정치·아동·장르·생존 유명인, 실패 시 탈락),
 * 원고 사실 검증(실패 시 탈락), 사건 식별 확인. 게이트가 Gemini 오류로 판정을 못 하면 통과가 아니라 탈락이다.
 *
 * 인스타그램에는 올리지 않는다 — 릴스는 세로 90초 포맷이라 맞지 않는다.
 */

/** 몰아보기 목표 사건 수(11/8: 5→4, 18~22분) */
const CASES_PER_COMPILATION = 4;
/** 사건 칸 시도 상한 — 한 칸이 실패해도 4건을 채울 여유 1칸 */
const MAX_CASE_SLOTS = 5;
/** 몰아보기 사건당 글자수(4건 ≈ 7,600~9,600자 ≈ 18~22.6분, 초당 7.08자) */
const CASE_CHAR_LIMITS = { min: 1900, max: 2400 };
/** 이보다 적으면 그 회차는 게시하지 않는다(11/7 에 2건짜리가 나갔다 — 11/8 2→3) */
const MIN_CASES = 3;
/** 예상 길이가 이 분을 넘으면 마지막 사건을 뺀다(3건까지만) */
const TRIM_ABOVE_MIN = 23;
/** 몰아보기 사건 원문 하한(자) */
const COMPILATION_MIN_SOURCE = 1800;
/** 단일 사건: 원문 하한과 '넉넉한 원문' 기준 — MAX_CHARS(6,000)는 longformProducer.ts 그대로 */
const SINGLE_MIN_SOURCE = 3000;
const SINGLE_RICH_SOURCE = 5300;
const singleCharLimits = (sourceChars: number) =>
  sourceChars >= SINGLE_RICH_SOURCE ? { min: 5000, max: 6000 } : { min: 4250, max: 6000 };

const FPS = 30;
const CONFIG_FILE = path.join("data", "longformConfig.json");

type Mode = "single" | "compilation";

interface ProducedCase {
  probe: CaseProbe;
  script: LongformScript;
  chapters: NarratedChapter[];
  sources: SourceDoc[];
  topicAngle: string;
  sourceChars: number;
}

/** KST 기준 날짜·요일 */
function kstNow(now = new Date()): { date: string; weekday: number } {
  const k = new Date(now.getTime() + 9 * 3600_000);
  return { date: k.toISOString().slice(0, 10), weekday: k.getUTCDay() };
}

async function resolveMode(arg: string): Promise<Mode> {
  if (arg === "single" || arg === "compilation") return arg;
  const { weekday } = kstNow();
  if (weekday !== 3) return "compilation";
  try {
    const cfg = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8")) as { wedMode?: string };
    return cfg.wedMode === "single" ? "single" : "compilation";
  } catch {
    console.warn(`   ⚠️ ${CONFIG_FILE} 없음·손상 — 수요일도 몰아보기로`);
    return "compilation";
  }
}

/** 롱폼 항목만(이번 실행에서 고른 사건 포함) — 단일 사건·시드 쇼츠의 중복 검사 대상 */
const longformOnly = (posts: HistoryPost[]) => posts.filter((p) => isLongformPost(p) || p.mode !== undefined);

/** caseKey → 영어 검색어·태그('voynich-manuscript-1912' → 'voynich manuscript') */
const keyToWords = (key: string) =>
  key.replace(/-(1\d{3}|20\d\d)(?=-|$)/g, "").replace(/-\d+(st|nd|rd|th)-century/g, "").replace(/-/g, " ").trim();

/** 사건명(챕터·해시태그용) — 제목 꼬리표 제거 */
const caseLabel = (c: { probe: CaseProbe }) => c.probe.title.split(/[｜|]/)[0].replace(/#/g, "").trim();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const history = await loadHistory();
  console.log(`🗂️  게시 이력 ${history.posts.length}건 (중복 회피)`);
  const mode = await resolveMode(args.mode);
  const { date: kstDate } = kstNow();
  console.log(`🎛️  형식: ${mode === "single" ? "단일 사건 심층" : "테마 몰아보기"} (--mode=${args.mode})`);
  const recentTitles = await loadRecentLongformTitles(history.posts.map((p) => p.title));

  // isDuplicate() 는 디스크 이력만 본다 — 이번 실행에서 고른 사건은 이 사본에 곧바로 더해
  // 같은 회차 안에서도 같은 사건이 두 번 뽑히지 않게 한다(appendPost 는 전부 끝난 뒤에 한다).
  const workingHistory = { posts: [...history.posts] };

  if (mode === "single") await runSingle({ args, workingHistory, recentTitles, kstDate });
  else await runCompilation({ args, workingHistory, recentTitles, kstDate });
}

// ── 단일 사건(수요일) ──────────────────────────────────────────────────

async function runSingle(ctx: {
  args: ReturnType<typeof parseArgs>;
  workingHistory: { posts: HistoryPost[] };
  recentTitles: string[];
  kstDate: string;
}) {
  const { args, workingHistory, recentTitles, kstDate } = ctx;
  const titleStyle = pickLongformTitleStyle(kstDate);
  console.log(`   🏷️  ${titleStyle.split(".")[0]}`);
  const base = {
    workingHistory,
    isFirst: true,
    caseNo: 0,
    format: "single" as const,
    titleStyle,
    minSourceChars: SINGLE_MIN_SOURCE,
    charLimits: singleCharLimits,
    topicAngle: "",
  };

  let produced: ProducedCase | null = null;
  let seedShort: SeedCandidate | undefined;
  console.log("① 시드 쇼츠 고르기(성과 상위 · 읽기 전용 통계)...");
  const seeds = args.seed && !args.seedVideoId ? [] : await pickSeedShorts(workingHistory.posts, { seedVideoId: args.seedVideoId });
  const lfAvoid = recentAvoidList({ posts: longformOnly(workingHistory.posts) });
  for (const cand of seeds.slice(0, 3)) {
    console.log(
      `   🌱 시드: ${cand.post.title} (${cand.post.caseKey})${cand.views !== undefined ? ` — 조회 ${cand.views} · 좋아요 ${cand.likes}` : ` — ${cand.via}`}`,
    );
    try {
      // 검색어만 얻으려고 한 번 부른다 — 사건 자체는 시드로 고정
      const p = await proposeCase(`${cand.post.title} (${cand.post.caseKey})`, lfAvoid, {});
      const same = isSameCase(p.caseKey, cand.post.caseKey);
      const fixedProbe: CaseProbe = {
        caseKey: cand.post.caseKey,
        title: same ? p.title : keyToWords(cand.post.caseKey), // 다른 사건이 오면 쇼츠 낚시 제목 대신 사건 키 낱말
        premise: cand.post.premise || (same ? p.premise : cand.post.title),
        searchTerms: [...(same ? p.searchTerms : []), keyToWords(cand.post.caseKey)].filter(Boolean),
      };
      produced = await produceOneCase({
        ...base,
        fixedProbe,
        avoid: recentAvoidList({ posts: longformOnly(workingHistory.posts) }),
        // 원본 쇼츠는 이력에 있는 게 정상 — 롱폼 항목하고만 겹치는지 본다
        dedupePosts: () => longformOnly(workingHistory.posts),
      });
    } catch (e) {
      console.warn(`   ⚠️ 시드 사건 제작 중 오류 — 다음 후보로: ${e instanceof Error ? e.message : e}`);
      produced = null;
    }
    if (produced) {
      seedShort = cand;
      break;
    }
  }
  if (!produced) {
    console.log("   ↩︎ 시드 쇼츠로 만들지 못함 — 일반 사건 선정으로");
    produced = await produceOneCase({
      ...base,
      seed: args.seed,
      avoid: recentAvoidList({ posts: workingHistory.posts }),
      dedupePosts: () => workingHistory.posts,
    });
  }
  if (!produced) throw new Error("단일 사건 롱폼에 쓸 사건을 확보하지 못했습니다 — 확인되지 않은 소재로 채우지 않고 중단합니다.");

  const c = produced;
  // 제목 검사(상투 표현·최근 제목 유사도) — 실패하면 '사건명, 핵심 질문'으로
  let title = c.script.title;
  let titleEn = c.script.titleEn ?? "";
  const tc = checkTitle(title, recentTitles);
  if (!tc.ok) {
    const fb = `${caseLabel(c)}, ${c.script.centralQuestion}`.slice(0, 90);
    console.warn(`   ⚠️ 제목 탈락(${tc.reason}): ${title} → ${fb} (${checkTitle(fb, recentTitles).ok ? "통과" : "검사 미통과"})`);
    title = fb;
    titleEn = "";
  }
  console.log(`   💡 제목: ${title} [제목 검사 ${checkTitle(title, recentTitles).ok ? "통과" : "미통과"}]`);

  // 챕터 목록·분석 비중 로그(드라이런 검토용)
  const chars = totalChars(c.script);
  c.script.chapters.forEach((ch, i) =>
    console.log(`      ${String(i + 1).padStart(2, "0")}. ${ch.heading} (${ch.segments.reduce((n, g) => n + g.text.length, 0)}자)`),
  );
  const analysis = c.script.chapters.slice(-3).reduce((n, ch) => n + ch.segments.reduce((m, g) => m + g.text.length, 0), 0);
  console.log(`   📊 원문 ${c.sourceChars}자 → 대본 ${chars}자 · 뒤 3챕터(분석) ${Math.round((analysis / chars) * 100)}%`);

  const groups = c.chapters.map((ch) => ({ label: ch.heading, chapters: [ch] }));
  await finishAndPublish({
    args,
    mode: "single",
    cases: [c],
    title,
    titleEn,
    hook: c.script.description,
    hookEn: c.script.descriptionEn ?? "",
    llmTags: c.script.tags,
    category: c.script.thumbBadge,
    thumbBadge: c.script.thumbBadge,
    topicAngle: c.topicAngle,
    groups,
    recentTitles,
    kstDate,
    historyExtra: { mode: "single", sourceShort: seedShort?.videoId },
    seedInfo: seedShort ? { caseKey: seedShort.post.caseKey, videoId: seedShort.videoId, views: seedShort.views, likes: seedShort.likes, via: seedShort.via } : null,
  });
}

// ── 테마 몰아보기(토요일) ──────────────────────────────────────────────

async function runCompilation(ctx: {
  args: ReturnType<typeof parseArgs>;
  workingHistory: { posts: HistoryPost[] };
  recentTitles: string[];
  kstDate: string;
}) {
  const { args, workingHistory, recentTitles, kstDate } = ctx;
  // 최근 2회 몰아보기의 테마는 쉰다
  const recentThemes: string[] = [];
  for (const p of workingHistory.posts) {
    if (p.mode === "compilation" && p.theme && recentThemes[recentThemes.length - 1] !== p.theme) recentThemes.push(p.theme);
  }
  const theme: CompilationTheme = pickCompilationTheme(recentThemes, kstDate);
  console.log(`🎞️  테마: ${theme.label} (${theme.id}) — 최근 테마 ${recentThemes.slice(-2).join(", ") || "없음"}`);
  // 소재 각도는 테마가 대신한다(회차당 하나) — 지역만 사건마다 바꾼다(produceOneCase)

  // 첫 사건 후보: 성과 좋은 쇼츠 중 테마에 맞는 것(모델이 테마 적합 여부를 판단) — 없으면 테마로 새로 고른다
  const seeds = args.seed ? [] : await pickSeedShorts(workingHistory.posts);
  const seedKeys = seeds.slice(0, 8).map((s) => s.post.caseKey);
  const seedHint = seeds.length
    ? `아래는 이 채널 쇼츠에서 반응이 좋았던 사건들이다. 이 중 이번 테마에 정말 맞는 사건이 있으면 그 사건을 골라라(영상의 첫 사건이 된다). 맞는 것이 없으면 테마에 맞는 다른 사건을 골라라: ${seeds
        .slice(0, 8)
        .map((s) => `${s.post.title} (${s.post.caseKey})`)
        .join(" / ")}`
    : undefined;
  const isSeedCase = (p: CaseProbe) => seedKeys.some((k) => isSameCase(k, p.caseKey));

  const avoid: AvoidList = recentAvoidList({ posts: workingHistory.posts });
  const cases: ProducedCase[] = [];
  avoid.rejected ??= []; // 첫 칸용 사본(caseAvoid)과 버린 목록을 공유한다
  for (let slot = 0; slot < MAX_CASE_SLOTS && cases.length < CASES_PER_COMPILATION; slot++) {
    if (cases.length + (MAX_CASE_SLOTS - slot) < MIN_CASES) break; // 남은 칸으로 최소 건수를 못 채우면 Gemini 를 더 쓰지 않는다
    const lead = cases.length === 0;
    console.log(`① 사건 ${cases.length + 1}/${CASES_PER_COMPILATION} 선정 + 원문 수집 (칸 ${slot + 1}/${MAX_CASE_SLOTS})...`);
    // 첫 사건은 시드 쇼츠 사건을 허용하므로 그 사건들을 회피 목록에서 뺀다
    const caseAvoid: AvoidList =
      lead && seedKeys.length
        ? {
            ...avoid,
            caseKeys: avoid.caseKeys.filter((k) => !seedKeys.some((s) => isSameCase(s, k))),
            titles: workingHistory.posts.filter((p) => !seedKeys.some((s) => isSameCase(s, p.caseKey))).map((p) => p.title),
          }
        : avoid;
    let produced: ProducedCase | null = null;
    try {
      produced = await produceOneCase({
        seed: lead ? (args.seed ?? seedHint) : undefined,
        avoid: caseAvoid,
        workingHistory,
        // 시드 쇼츠 사건이면 롱폼하고만 겹치는지 본다(쇼츠는 이력에 있는 게 정상), 나머지는 전체 이력
        dedupePosts: (p) => (lead && isSeedCase(p) ? longformOnly(workingHistory.posts) : workingHistory.posts),
        isFirst: lead,
        caseNo: slot,
        format: "compilation",
        minSourceChars: COMPILATION_MIN_SOURCE,
        charLimits: () => CASE_CHAR_LIMITS,
        topicAngle: theme.seedHint,
        theme: theme.seedHint,
        transitionSeed: `${kstDate}-${slot}`,
      });
    } catch (e) {
      // 사건 하나의 제작 오류로 이미 만든 사건까지 버리지 않는다(2026-10-05 RECITATION 사고)
      console.warn(`   ⚠️ 사건 제작 중 오류 — 이 칸만 건너뜀: ${e instanceof Error ? e.message : e}`);
    }
    // 첫 칸에서 버린 후보를 다음 칸도 피하게 원래 회피 목록에 되돌려 넣는다(11/8 검토)
    if (caseAvoid !== avoid) {
      for (const k of caseAvoid.caseKeys) if (!avoid.caseKeys.includes(k)) avoid.caseKeys.push(k);
      for (const t of caseAvoid.titles) if (!avoid.titles.includes(t)) avoid.titles.push(t);
    }
    if (!produced) {
      console.log("   ↩︎ 이 칸 사건 확보 실패 — 건너뜀");
      continue;
    }
    cases.push(produced);
    avoid.caseKeys.push(produced.probe.caseKey);
    avoid.titles.push(produced.probe.title);
    workingHistory.posts.push({
      caseKey: produced.probe.caseKey,
      title: produced.probe.title,
      premise: produced.probe.premise,
      at: kstDate,
      format: "longform",
      mode: "compilation",
      theme: theme.id,
    });
  }

  if (cases.length < MIN_CASES) {
    throw new Error(
      `몰아보기에 쓸 사건을 ${cases.length}건밖에 확보하지 못했습니다(최소 ${MIN_CASES}건 필요). ` +
        "확인되지 않은 사실로 채우거나 2건짜리를 내보내는 것보다 이번 회차를 중단하는 편이 낫습니다.",
    );
  }
  // 길이 상한 — 23분을 넘으면 마지막 사건을 뺀다(3건까지만)
  let secs = longformDurationInFrames(cases.flatMap((c) => c.chapters), FPS) / FPS;
  while (cases.length > MIN_CASES && secs > TRIM_ABOVE_MIN * 60) {
    const dropped = cases.pop()!;
    console.log(`   ✂️ 예상 ${Math.round(secs / 60)}분 > ${TRIM_ABOVE_MIN}분 — 마지막 사건 제외(${dropped.probe.title})`);
    secs = longformDurationInFrames(cases.flatMap((c) => c.chapters), FPS) / FPS;
  }
  console.log(`   ✅ 사건 ${cases.length}건 확보: ${cases.map((c) => caseLabel(c)).join(" / ")}`);

  // ② 종합 제목·설명 — 첫 사건의 훅 + 테마. 상투 표현·최근 제목 유사도는 코드로 검사
  console.log("② 종합 제목·설명 생성...");
  const meta = await writeCompilationMeta(
    cases.map((c) => ({
      title: c.script.title,
      centralQuestion: c.script.centralQuestion,
      description: c.script.description,
      caseName: caseLabel(c),
    })),
    { themeLabel: theme.label, recentTitles },
  );
  // 종합 제목도 실제 구성과 대조 — 10/21 '수십 년이 지나도 풀리지 않은 사건들'에 1869·1888년 사건과 이미 설명된 자연재해가 섞였다
  const caseList = cases
    .map((c, i) => `${i + 1}. ${c.script.title} — ${c.script.centralQuestion}\n${c.script.description}`)
    .join("\n\n");
  const titleBefore = meta.title;
  await verifyFacts(
    [{ id: "title", text: meta.title, apply: (f) => { meta.title = f; } }],
    `[이번 영상에 실제로 들어간 사건 목록 — 제목은 이 모두에 맞아야 한다]\n${caseList}`,
    "몰아보기 종합 제목",
  );
  if (meta.title !== titleBefore) meta.titleEn = ""; // 교정된 제목과 영어 제목이 어긋나지 않게
  console.log(`   💡 ${meta.title} [제목 검사 ${checkTitle(meta.title, recentTitles).ok ? "통과" : "미통과"}]`);

  const groups = cases.map((c) => ({ label: caseLabel(c), chapters: c.chapters }));
  await finishAndPublish({
    args,
    mode: "compilation",
    cases,
    title: meta.title,
    titleEn: meta.titleEn ?? "",
    hook: meta.description,
    hookEn: meta.descriptionEn ?? "",
    llmTags: meta.tags,
    category: theme.label,
    thumbBadge: theme.badge,
    topicAngle: theme.seedHint,
    groups,
    recentTitles,
    kstDate,
    historyExtra: { mode: "compilation", theme: theme.id },
    seedInfo: { theme: theme.id, leadFromShort: isSeedCase(cases[0].probe) },
  });
}

// ── 공통: 렌더·게시·기록 ───────────────────────────────────────────────

async function finishAndPublish(p: {
  args: ReturnType<typeof parseArgs>;
  mode: Mode;
  cases: ProducedCase[];
  title: string;
  titleEn: string;
  hook: string;
  hookEn: string;
  llmTags: string[];
  category: string;
  thumbBadge: string;
  topicAngle: string;
  groups: Array<{ label: string; chapters: NarratedChapter[] }>;
  recentTitles: string[];
  kstDate: string;
  historyExtra: { mode: Mode; theme?: string; sourceShort?: string };
  seedInfo: Record<string, unknown> | null;
}) {
  const { cases, mode } = p;
  const allChapters = cases.flatMap((c) => c.chapters);
  const allSources = cases.flatMap((c) => c.sources);
  const secs = longformDurationInFrames(allChapters, FPS) / FPS;
  const totalCuts = allChapters.reduce((n, c) => n + c.segments.length, 0);
  const chars = cases.reduce((n, c) => n + totalChars(c.script), 0);
  console.log(
    `   ⏱️ 사건 ${cases.length}건 · ${chars}자 · ${totalCuts}컷 → 예상 러닝타임 ${Math.floor(secs / 60)}분 ${Math.round(secs % 60)}초`,
  );

  // 설명란 챕터(렌더와 같은 계산) — 10초 미만은 앞 줄에 합치고 3줄 미만이면 생략
  const chaptersBlock = longformChapterTimestamps(p.groups, FPS);
  console.log(chaptersBlock ? `   🔖 챕터\n${chaptersBlock.replace(/^/gm, "      ")}` : "   🔖 챕터 3개 미만 — 설명란 챕터 생략");

  const description = buildLongformDescription({
    hook: p.hook,
    chaptersBlock,
    sources: allSources,
    category: p.category,
    caseName: caseLabel(cases[0]),
    seed: `${p.kstDate}-${p.title}`,
  });
  const tags = normalizeTags(
    cases.flatMap((c) => [caseLabel(c), keyToWords(c.probe.caseKey)]),
    p.llmTags,
  );
  const localizationEn = p.titleEn.trim() && p.hookEn.trim()
    ? { title: p.titleEn, description: buildLongformDescriptionEn(p.hookEn, allSources) }
    : undefined;
  console.log("   📄 설명란 ────────");
  console.log(description.replace(/^/gm, "      "));
  console.log(`   🏷️  태그(${tags.length}개): ${tags.join(", ")}`);
  console.log(`   🌐 영어 제목: ${localizationEn?.title || "(없음 — 현지화 생략)"}`);

  // 썸네일 배경·장르 그레이드는 1번째 사건 기준(영상 전체에 하나)
  const thumbBgSrc = await fetchThumbBg(cases[0].script.thumbQuery);
  const grade = deriveGrade(cases[0].probe.caseKey, p.thumbBadge, p.topicAngle);
  console.log(`   🎨 장르 그레이드: ${grade.genre} · 배지 '${p.thumbBadge}'`);

  // 썸네일 문구는 1번째 사건 것(thumbTitleIssues 검증 통과분). 배지는 몰아보기=테마, 단일=사건 분류(11/8 '사건 모음' 고정 폐지)
  const inputProps: LongformInputProps = {
    title: p.title,
    thumbTitle: cases[0].script.thumbTitle,
    thumbBadge: p.thumbBadge,
    centralQuestion: cases[0].script.centralQuestion,
    chapters: allChapters,
    thumbBgSrc,
    bgmSrc: await findBgm(),
    grade,
  };

  await fs.mkdir(config.paths.out, { recursive: true });
  await fs.writeFile(
    path.join(config.paths.out, "longform.json"),
    JSON.stringify(
      {
        mode,
        seed: p.seedInfo,
        meta: { title: p.title, titleEn: p.titleEn, description, chaptersBlock, tags, thumbBadge: p.thumbBadge },
        estimatedSeconds: Math.round(secs),
        cases: cases.map((c) => ({ probe: c.probe, sourceChars: c.sourceChars, sources: c.sources.map((d) => d.url), script: c.script })),
      },
      null,
      2,
    ),
  );
  // 자막 트랙은 게시 때 올리지만, 드라이런에서도 파일로 남겨 눈으로 확인한다
  await fs.writeFile(path.join(config.paths.out, "longform.ko.srt"), longformSrt(allChapters, FPS));
  await fs.writeFile(path.join(config.paths.out, "longform.en.srt"), longformSrt(allChapters, FPS, "en"));

  console.log("④ 영상 렌더 (1920x1080)...");
  const videoPath = await renderLongform(inputProps);
  console.log(`   🎬 ${videoPath}`);
  const thumbPath = await renderLongformThumb(inputProps);
  console.log(`   🖼️  썸네일: ${thumbPath}`);
  // 아트디렉터 디자인 검수 — 로그만 남기고 게시는 막지 않는다
  await reviewDesign({ kind: "longform", videoPath, thumbPath, title: p.title });

  if (!p.args.publish) {
    console.log("   ⏭️  업로드 생략 (--no-publish). 영상 파일만 생성했습니다.");
    return;
  }

  console.log("⑤ 유튜브 업로드...");
  const srt = longformSrt(allChapters, FPS);
  const srtEn = longformSrt(allChapters, FPS, "en");
  // publishLongform 은 title 과 opts(설명·태그·현지화)만 쓴다 — 나머지는 1번째 사건 것으로 타입만 맞춘다
  const publishScript: LongformScript = { ...cases[0].script, title: p.title, description, tags };
  const { videoId } = await publishLongform(videoPath, publishScript, undefined, thumbPath, srt, srtEn, {
    description,
    tags,
    localizationEn,
  });
  console.log(`   ✅ 롱폼(${mode === "single" ? "단일 사건" : `몰아보기 ${cases.length}건`}) 게시 완료: https://youtu.be/${videoId}`);
  if (localizationEn) console.log(`   🔍 첫 업로드 확인용(읽기 전용 1 unit): videos.list?part=snippet,localizations&id=${videoId}`);

  // 쇼츠 설명란 링크용 — 실패해도 게시엔 영향 없음
  await persistLatestLongform({ videoId, title: p.title, publishedAt: new Date().toISOString().slice(0, 10) }).catch(() => {});
  await appendLongformTitle(
    { title: p.title, at: new Date().toISOString().slice(0, 10), mode, videoId },
    p.recentTitles,
  ).catch((e) => console.warn(`   ⚠️ 롱폼 제목 기록 실패(게시는 완료됨): ${e instanceof Error ? e.message : e}`));

  // 이력엔 사건별로 남긴다 — 사건 단위 중복 회피(쇼츠 포함)가 계속 동작해야 한다
  for (const c of cases) {
    const idea: StoryIdea = {
      caseKey: c.probe.caseKey,
      thumbTitle: c.script.thumbTitle,
      thumbBadge: c.script.thumbBadge,
      hook: c.script.centralQuestion,
      title: c.script.title,
      premise: c.probe.premise,
      synopsis: c.script.description.slice(0, 300),
      twist: "",
      basedOnRealEvents: true,
      factNote: c.sources.map((d) => d.title).join(", "),
      moodKeywords: [],
    };
    await appendPost(idea, c.script.tags, undefined, {
      format: "longform",
      videoId,
      sourceUrl: c.sources[0]?.url,
      ...p.historyExtra,
    });
  }

  // 썸네일 보관 (쇼츠와 동일하게 저장소에 남긴다)
  try {
    await fs.mkdir("thumbnails", { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const name = mode === "single" ? `${date}-lf-single-${cases[0].probe.caseKey}-${videoId}.jpg` : `${date}-lf-compilation-${videoId}.jpg`;
    await fs.copyFile(thumbPath, path.join("thumbnails", name));
  } catch {
    /* 보관 실패는 게시에 영향 없음 */
  }
}

// ── 사건 1건 제작(모든 게이트) ─────────────────────────────────────────

/**
 * 사건 1건을 선정 → 게이트 → 원문 → 대본 → 사실 검증 → 나레이션 → 챕터 배경까지 끝낸다.
 * 실패하면 null — 호출부가 다음 칸·다음 후보로 간다.
 *
 * fixedProbe 가 있으면(단일 사건 시드) 사건을 바꾸지 않고 1회만 본다.
 * isFirst 가 아니면 대본 맨 앞에 짧은 '사건 전환' 챕터를 붙인다(귀로 들어도 사건이 바뀐 걸 알게).
 */
async function produceOneCase(opts: {
  seed?: string;
  fixedProbe?: CaseProbe;
  avoid: AvoidList;
  workingHistory: { posts: HistoryPost[] };
  /** 중복 검사 대상(기본: 전체 이력) */
  dedupePosts: (probe: CaseProbe) => HistoryPost[];
  isFirst: boolean;
  /** 음성·배경 파일 이름을 칸마다 다르게 */
  caseNo: number;
  format: Mode;
  minSourceChars: number;
  charLimits: (sourceChars: number) => { min: number; max: number };
  topicAngle: string;
  theme?: string;
  titleStyle?: string;
  transitionSeed?: string;
}): Promise<ProducedCase | null> {
  const { avoid, workingHistory, isFirst, caseNo } = opts;
  const maxTries = opts.fixedProbe ? 1 : 5;
  const planOpts = () => ({
    topicAngle: opts.topicAngle || undefined,
    regionAngle: pickRegionAngle(), // 지역은 사건마다 바꾼다(9/25 5건이 전부 한국 상속 분쟁)
    theme: opts.theme,
  });
  const rejectAndLog = (probe: CaseProbe, why: string) => {
    avoid.caseKeys.push(probe.caseKey);
    (avoid.rejected ??= []).push(`${probe.title} (${probe.caseKey}) — 버린 이유: ${why || "기타"}`);
    avoid.titles.push(probe.title);
  };
  const isDup = async (probe: CaseProbe, urls?: string[]) => {
    const posts = opts.dedupePosts(probe);
    return (
      isDuplicate({ posts }, probe.caseKey, probe.title, urls) ||
      !!(await sameCaseInHistory(probe, posts, { failClosed: true }))
    );
  };

  let probe: CaseProbe | undefined;
  let sources: SourceDoc[] = [];
  for (let tries = 0; tries < maxTries; tries++) {
    if (!probe) {
      const po = planOpts();
      console.log(`   🧭 ${po.regionAngle.split(" — ")[0]}`);
      probe = opts.fixedProbe ?? (await proposeCase(tries === 0 ? opts.seed : undefined, avoid, po));
    }
    let why = "";
    sources = [];
    if (isNonCaseTitle(probe.title, probe.caseKey)) {
      why = "실제 사건이 아닌 문서(목록·작품·개념)";
    } else if (isSexCrimeCase(probe.title, probe.premise, probe.caseKey)) {
      why = "채널 기준 위반: 성범죄·아동 피해 사건";
    } else if (await isDup(probe)) {
      why = "이미 게시함(또는 이력 대조 실패)";
    } else {
      console.log(`   🔎 후보: ${probe.title} (${probe.caseKey})`);
      // 주인공 본인 전기도 원문으로 인정(10/13 사장님 결정). 동명이인은 여전히 제외.
      const docs = await gatherSources(probe.searchTerms, { title: probe.title, premise: probe.premise, protagonistBioOk: true });
      const volume = docs.reduce((n, d) => n + d.extract.length, 0);
      const srcText = docs.map((d) => d.extract).join("\n");
      const badYears = yearsMissingFromSource(probe.title, srcText);
      if (!docs.length || volume < opts.minSourceChars) {
        why = `원문 부족(${docs.length}건 ${volume}자, 최소 ${opts.minSourceChars}자)`;
      } else if (isDuplicate({ posts: opts.dedupePosts(probe) }, probe.caseKey, probe.title, docs.map((d) => d.url))) {
        why = "이미 게시함(같은 원문 문서)";
      } else if (badYears.length) {
        why = `제목 연도(${badYears.join(", ")})가 원문에 없음`;
      } else {
        // 정치·성범죄·아동·장르 밖·생존 유명인 — 확인 실패도 탈락(sources.ts)
        const unsafe = await politicalControversy(docs, { title: probe.title, premise: probe.premise });
        if (unsafe) {
          why = `채널 기준 위반: ${unsafe}`;
        } else {
          sources = docs;
          console.log(`   📚 원문 ${docs.length}건 / ${volume}자: ${docs.map((d) => d.title).join(", ")}`);
          break;
        }
      }
    }
    console.log(`   ↩︎ ${probe.title} (${probe.caseKey}) — ${why}`);
    rejectAndLog(probe, why);
    probe = undefined;
  }
  if (!probe || !sources.length) return null;

  const sourceChars = sources.reduce((n, d) => n + d.extract.length, 0);
  const script = await writeLongform({
    forcedCase: probe,
    sources,
    avoidTitles: avoid.titles,
    charLimits: opts.charLimits(sourceChars),
    format: opts.format,
    lead: isFirst,
    titleStyle: opts.titleStyle,
  });
  console.log(`   💡 ${script.title}`);
  // 완성 제목으로 한 번 더 — 소재 선정 단계 제목엔 연도가 빠져 제목 비교가 안 잡히는 경우가 있다
  if (isDuplicate({ posts: opts.dedupePosts(probe) }, probe.caseKey, script.title)) {
    console.log(`   ♻️  완성 제목이 이미 게시한 사건과 겹침(${script.title}) — 이 사건은 건너뜀`);
    return null;
  }
  // 원고를 원문과 한 줄씩 대조해 틀린 사실을 고친다. 고친 뒤에도 남거나 검증 자체를 못 하면 이 사건은 버린다.
  const factItems: FactItem[] = [
    { id: "title", text: script.title, apply: (f) => { script.title = f; } },
    { id: "thumb", text: script.thumbTitle, apply: (f) => { script.thumbTitle = f; } },
    { id: "question", text: script.centralQuestion, apply: (f) => { script.centralQuestion = f; } },
  ];
  script.chapters.forEach((ch, c) => {
    factItems.push({ id: `c${c + 1}`, text: ch.heading, apply: (f) => { ch.heading = f; } });
    ch.segments.forEach((seg, i) => {
      factItems.push({
        id: `c${c + 1}s${i + 1}/en`,
        text: seg.text,
        apply: (f, en) => { seg.text = f; if (en) seg.textEn = en; },
      });
      const frame = seg.frame;
      if (frame) {
        factItems.push({ id: `c${c + 1}s${i + 1}L`, text: frame.label, apply: (f) => { frame.label = f; } });
        if (frame.support) factItems.push({ id: `c${c + 1}s${i + 1}S`, text: frame.support, apply: (f) => { frame.support = f; } });
      }
    });
  });
  const sourceText = sources.map((d) => `[${d.title}]\n${d.extract}`).join("\n\n");
  if (!(await verifyFacts(factItems, sourceText, probe.title, { failClosed: true }))) {
    console.log(`   ↩︎ 사실 검증 실패 — 이 사건은 건너뜀(${probe.title})`);
    // 이번 회차에서 다시 고르지 않게 기록한다 — 10/19 오언 파핏이 사실 검증 탈락 직후 다음 슬롯에 또 뽑혔다
    workingHistory.posts.push({ caseKey: probe.caseKey, title: probe.title, premise: probe.premise, at: "", format: "longform" });
    rejectAndLog(probe, "원고 사실 검증 실패");
    return null;
  }
  // 원고가 실제로 다룬 사건과 caseKey 가 맞는지 — 어긋나면 바로잡아 이력에 저장(10/21 화이트홀↔화이트채플)
  const corrected = await confirmCaseIdentity(
    { caseKey: probe.caseKey, title: probe.title },
    [script.title, ...script.chapters.flatMap((ch) => ch.segments.map((s) => s.text))].join("\n"),
  );
  if (corrected) {
    const fixed = { ...probe, caseKey: corrected.caseKey, title: corrected.caseName };
    if (isNonCaseTitle(fixed.title, fixed.caseKey) || isSexCrimeCase(fixed.title, fixed.premise, fixed.caseKey) || (await isDup(fixed))) {
      console.log(`   ♻️  원고가 실제로 다룬 사건(${fixed.title})이 이미 게시했거나 쓸 수 없는 사건 — 이 사건은 건너뜀`);
      workingHistory.posts.push({ caseKey: probe.caseKey, title: probe.title, premise: probe.premise, at: "", format: "longform" });
      return null;
    }
    probe.caseKey = fixed.caseKey;
    probe.title = fixed.title;
  }
  // 제목 연도가 원문에 없으면 연도를 뺀다(코드 검사 — 9/30 수에즈 키에 '1815년' 제목, 10/21 버클랜드 키에 '1869년' 제목)
  const badYears = yearsMissingFromSource(script.title, sourceText);
  if (badYears.length) {
    const before = script.title;
    for (const y of badYears) script.title = script.title.replace(new RegExp(`${y}\\s*년(?!대)\\s*`, "g"), "").trim();
    script.titleEn = "";
    console.log(`   ✂️ 제목 연도(${badYears.join(", ")})가 원문에 없어 뺌: ${before} → ${script.title}`);
  }

  if (!isFirst) {
    const tr = seededPick(CASE_TRANSITIONS, opts.transitionSeed ?? `${probe.caseKey}`);
    script.chapters.unshift({
      heading: "다음 사건",
      // 이 케이스의 실제 1번째 챕터 배경을 그대로 물려받는다
      visualQuery: script.chapters[0]?.visualQuery || "dark mysterious empty room",
      segments: [
        { text: tr.text, textEn: tr.textEn, emphasis: "normal" },
        { text: script.centralQuestion, textEn: "", emphasis: "normal" },
      ],
    });
  }

  // 사건마다 파일 이름을 다르게(c0-…, c1-…) — 같은 이름이면 뒤 사건 음성·사진이 앞 사건 것을 덮어쓴다(2026-10-05)
  const chapters = await narrateLongform(script, LONGFORM_VOICE, `lf-c${caseNo}`);
  const dropped = dropUnreadableVisuals(chapters, FPS);
  if (dropped) console.log(`   ⏱️ 읽을 시간이 모자란 그래픽 ${dropped}개 폐기`);
  await attachChapterBroll(chapters, `lf-c${caseNo}-ch`);

  console.log(`   ⏱️ 대본 ${totalChars(script)}자 / ${countSegments(script)}컷 (전환 챕터 제외)`);
  return { probe, script, chapters, sources, topicAngle: opts.topicAngle, sourceChars };
}

async function findBgm(): Promise<string | undefined> {
  try {
    // warm*.mp3 는 쇼츠 감동 실화 편 전용 — 롱폼 사건 다큐에는 깔지 않는다
    const files = (await fs.readdir(config.paths.bgm)).filter(
      (f) => f.toLowerCase().endsWith(".mp3") && !f.startsWith("warm"),
    );
    const mp3 = files[Math.floor(Math.random() * files.length)];
    if (mp3) {
      console.log(`   🎵 BGM: bgm/${mp3}`);
      return `bgm/${mp3}`;
    }
  } catch {
    /* bgm 폴더 없음 */
  }
  return undefined;
}

function parseArgs(argv: string[]) {
  const args = {
    seed: undefined as string | undefined,
    publish: true,
    mode: "auto",
    seedVideoId: undefined as string | undefined,
  };
  for (const a of argv) {
    if (a.startsWith("--seed=")) args.seed = a.slice("--seed=".length).trim() || undefined;
    else if (a.startsWith("--mode=")) args.mode = a.slice("--mode=".length).trim() || "auto";
    else if (a.startsWith("--seed-video-id=")) args.seedVideoId = a.slice("--seed-video-id=".length).trim() || undefined;
    else if (a === "--no-publish") args.publish = false;
  }
  if (!["auto", "single", "compilation"].includes(args.mode)) throw new Error(`--mode 는 auto|single|compilation (받은 값: ${args.mode})`);
  return args;
}

main().catch((err) => {
  console.error("롱폼 파이프라인 실패:", err);
  process.exit(1);
});

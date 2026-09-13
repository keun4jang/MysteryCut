import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { proposeCase } from "./assistants/producer.js";
import {
  writeLongform,
  writeCompilationMeta,
  totalChars,
  countSegments,
} from "./assistants/longformProducer.js";
import { narrateLongform } from "./assistants/narrator.js";
import { attachChapterBroll, fetchThumbBg } from "./assistants/broll.js";
import { renderLongform, renderLongformThumb } from "./render.js";
import { publishLongform } from "./assistants/youtubePublisher.js";
import { loadHistory, recentAvoidList, isDuplicate, appendPost, type HistoryPost } from "./assistants/history.js";
import { persistLatestLongform } from "./lib/latestLongform.js";
import { gatherSources, sourcesCitation, type SourceDoc } from "./lib/sources.js";
import { longformSrt } from "./lib/captions.js";
import { dropUnreadableVisuals } from "./lib/visual/normalize.js";
import { pickStylePack, LONGFORM_VOICE } from "./lib/variety.js";
import { deriveGrade } from "./lib/grade.js";
import { longformDurationInFrames } from "./remotion/timing.js";
import type { LongformInputProps, LongformScript, NarratedChapter, StoryIdea } from "./types.js";

/**
 * 롱폼(가로형 사건 분석 다큐, 몰아보기 포맷) 파이프라인.
 *
 *   [사건 선정 → 원문 → 대본 → 나레이션 → 챕터 배경] × N개 사건 → 이어붙이기
 *   → 종합 제목·설명 → 렌더 → 유튜브
 *
 * 2026-09-13 몰아보기(여러 사건 모음) 포맷으로 전환. 왜:
 * 실측(2026-09-13, Analytics API) — 단일 사건 심층 다큐 방식으로 90일 롱폼
 * 시청시간이 3.5시간에 그쳤다. 이 속도로는 YPP 4,000시간 목표에 사실상
 * 도달 불가능하다. 반면 유사 국내 채널(실화 괴담 채널들) 리서치로 확인된
 * 이 장르의 지배적 롱폼 관습은 여러 사건을 묶은 장시간 '몰아보기' 영상이고,
 * 통근·취침 전 틀어놓는 용도로 소비돼 원시 시청 시간을 쌓기에 구조적으로
 * 유리하다 — 그래서 사건당 분량은 줄이는 대신(CASE_CHAR_LIMITS) 한 편에
 * 여러 사건을 담아 총 러닝타임을 늘린다. 사건별 사실검증 파이프라인
 * (gatherSources — 원문 없으면 그 사건은 버림)은 사건마다 그대로 유지해
 * 정확성 기준은 낮추지 않는다.
 *
 * 인스타그램에는 올리지 않는다 — 릴스는 세로 90초 포맷이라 맞지 않는다.
 */

/** 한 편에 담을 사건 수 — 첫 롤아웃은 보수적으로. 목표 총 러닝타임 ≈ 20~30분. */
const CASES_PER_COMPILATION = 5;
/**
 * 사건당 글자수 한도. 단일 사건 롱폼(2,600~6,000자)보다 낮춰 '한 사건을 깊게'가
 * 아니라 '여러 사건을 적당한 깊이로'를 우선한다. 5건 × 최대 2,600자 ≈ 13,000자
 * ≈ 30분 — longformProducer.ts 의 주석대로 "CI 180분 타임아웃은 MAX_CHARS 의
 * 2배(12,000자)를 줘도 여유롭다"는 실측 여유 안에 들어간다(5×2,600=13,000자는
 * 그보다 살짝 위지만, 사건마다 별도 API 호출·별도 TTS라 한 사건이 아니라
 * 다섯 사건에 나눠 걸리므로 그 여유 판단이 그대로 적용된다).
 */
const CASE_CHAR_LIMITS = { min: 1600, max: 2600 };
/** 최소 이 정도는 확보해야 '몰아보기'라고 부를 수 있다 — 못 채우면 이번 회차는 중단. */
const MIN_CASES = 2;

interface ProducedCase {
  probe: Awaited<ReturnType<typeof proposeCase>>;
  script: LongformScript;
  chapters: NarratedChapter[];
  sources: SourceDoc[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const history = await loadHistory();
  const avoid = recentAvoidList(history);
  console.log(`🗂️  게시 이력 ${history.posts.length}건 (중복 회피)`);

  const pack = pickStylePack();
  console.log(`   🧭 ${pack.topicAngle.split(" — ")[0]} | ${pack.regionAngle.split(" — ")[0]}`);

  // isDuplicate() 는 디스크 이력만 본다 — 이번 실행에서 이미 고른 사건은 아직
  // 디스크에 없으므로, 고를 때마다 이 사본에 곧바로 더해 같은 회차 안에서도
  // 같은 사건이 두 번 뽑히지 않게 한다(appendPost 는 전부 끝난 뒤에 한다).
  const workingHistory = { posts: [...history.posts] };

  const cases: ProducedCase[] = [];
  for (let i = 0; i < CASES_PER_COMPILATION; i++) {
    console.log(`① 사건 ${i + 1}/${CASES_PER_COMPILATION} 선정 + 원문 수집...`);
    const produced = await produceOneCase({
      seed: i === 0 ? args.seed : undefined,
      avoid,
      pack,
      workingHistory,
      isFirst: i === 0,
    });
    if (!produced) {
      console.log(`   ↩︎ 사건 ${i + 1} 확보 실패(5회 시도) — 건너뜀`);
      continue;
    }
    cases.push(produced);
    avoid.caseKeys.push(produced.probe.caseKey);
    avoid.titles.push(produced.probe.title);
    workingHistory.posts.push({
      caseKey: produced.probe.caseKey,
      title: produced.probe.title,
      premise: produced.probe.premise,
      at: new Date().toISOString().slice(0, 10),
    });
  }

  if (cases.length < MIN_CASES) {
    throw new Error(
      `몰아보기에 쓸 사건을 ${cases.length}건밖에 확보하지 못했습니다(최소 ${MIN_CASES}건 필요). ` +
        "확인되지 않은 사실로 채우는 것보다 이번 회차를 중단하는 편이 낫습니다.",
    );
  }
  console.log(`   ✅ 사건 ${cases.length}/${CASES_PER_COMPILATION}건 확보`);

  const allChapters = cases.flatMap((c) => c.chapters);
  const allSources = cases.flatMap((c) => c.sources);

  // ② 종합 제목·설명 — 개별 사건 대본과 별개로, 영상 전체를 아우르는 메타데이터.
  console.log("② 종합 제목·설명 생성...");
  const meta = await writeCompilationMeta(
    cases.map((c) => ({
      title: c.script.title,
      centralQuestion: c.script.centralQuestion,
      description: c.script.description,
    })),
  );
  console.log(`   💡 ${meta.title}`);

  const secs = longformDurationInFrames(allChapters, 30) / 30;
  const totalCuts = allChapters.reduce((n, c) => n + c.segments.length, 0);
  console.log(
    `   ⏱️ 사건 ${cases.length}건 합계 ${totalCuts}컷 → 예상 러닝타임 ${Math.floor(secs / 60)}분 ${Math.round(secs % 60)}초`,
  );

  // ③ 챕터 배경은 사건별로 이미 붙었다(produceOneCase 안에서) — 여기선 썸네일 배경만.
  const thumbBgSrc = await fetchThumbBg(cases[0].script.thumbQuery);
  // 장르 그레이드(색감·톤)는 영상 전체에 하나만 적용되는 값이라 1번째 사건 기준으로 고정한다.
  const grade = deriveGrade(cases[0].probe.caseKey, cases[0].script.thumbBadge, pack.topicAngle);
  console.log(`   🎨 장르 그레이드: ${grade.genre} (1번째 사건 기준 — 영상 전체 톤)`);

  // 썸네일 문구(thumbTitle/thumbBadge)는 새로 짓지 않고 1번째 사건 것을 그대로 쓴다
  // (longformProducer.ts 의 thumbTitleIssues() 검증·재시도를 이미 통과한 결과이고,
  // 썸네일은 원래 '가장 강한 훅 하나'가 국룰이라 여러 사건을 욱여넣으면 약해진다).
  // 배지만 '사건 모음'으로 바꿔 몰아보기라는 걸 한눈에 알린다.
  const inputProps: LongformInputProps = {
    title: meta.title,
    thumbTitle: cases[0].script.thumbTitle,
    thumbBadge: "사건 모음",
    centralQuestion: cases[0].script.centralQuestion,
    chapters: allChapters,
    thumbBgSrc,
    bgmSrc: await findBgm(),
    grade,
  };

  await fs.mkdir(config.paths.out, { recursive: true });
  await fs.writeFile(
    path.join(config.paths.out, "longform.json"),
    JSON.stringify({ cases: cases.map((c) => ({ probe: c.probe, script: c.script })), meta }, null, 2),
  );
  // 자막 트랙은 게시 때 올리지만, 드라이런에서도 파일로 남겨 눈으로 확인한다
  await fs.writeFile(path.join(config.paths.out, "longform.ko.srt"), longformSrt(allChapters, 30));
  await fs.writeFile(path.join(config.paths.out, "longform.en.srt"), longformSrt(allChapters, 30, "en"));

  // ④ 렌더 (영상 + 전용 썸네일)
  console.log("④ 영상 렌더 (1920x1080)...");
  const videoPath = await renderLongform(inputProps);
  console.log(`   🎬 ${videoPath}`);
  const thumbPath = await renderLongformThumb(inputProps);
  console.log(`   🖼️  썸네일: ${thumbPath}`);

  if (!args.publish) {
    console.log("   ⏭️  업로드 생략 (--no-publish). 영상 파일만 생성했습니다.");
    return;
  }

  // ⑤ 유튜브 업로드 (인스타 제외 — 가로 장편은 릴스 포맷이 아니다)
  console.log("⑤ 유튜브 업로드...");
  const citation = sourcesCitation(allSources);
  const srt = longformSrt(allChapters, 30);
  const srtEn = longformSrt(allChapters, 30, "en");
  // publishLongform 은 script.title/description/tags 만 읽는다 — 나머지 필드는
  // 1번째 사건 것을 그대로 채워 타입만 맞춘다(실제로 쓰이지 않음).
  const publishScript: LongformScript = {
    ...cases[0].script,
    title: meta.title,
    description: meta.description,
    tags: meta.tags,
  };
  const { videoId } = await publishLongform(videoPath, publishScript, citation, thumbPath, srt, srtEn);
  console.log(`   ✅ 롱폼(몰아보기, 사건 ${cases.length}건) 게시 완료: https://youtu.be/${videoId}`);

  // 쇼츠 설명란이 이 정보로 "전체 분석은 롱폼에서" 링크를 건다(youtubePublisher.ts
  // buildDescription 참고) — 실패해도 게시 자체엔 영향 없으니 링크만 못 붙는다.
  await persistLatestLongform({
    videoId,
    title: meta.title,
    publishedAt: new Date().toISOString().slice(0, 10),
  }).catch(() => {});

  // 이력엔 사건별로 각각 남긴다 — 한 영상에 N건이 들어가도 향후 중복 회피(쇼츠 포함)는
  // 사건 단위로 계속 동작해야 하기 때문이다. history.json 은 videoId 를 안 갖고 있어
  // (원래부터 순수 중복 회피용) 여러 건이 영상 하나를 공유해도 스키마 변경이 필요 없다.
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
    await appendPost(idea, c.script.tags);
  }

  // 썸네일 보관 (쇼츠와 동일하게 저장소에 남긴다)
  try {
    await fs.mkdir("thumbnails", { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    await fs.copyFile(thumbPath, path.join("thumbnails", `${date}-lf-compilation-${videoId}.jpg`));
  } catch {
    /* 보관 실패는 게시에 영향 없음 */
  }
}

/**
 * 사건 1건을 선정 → 원문 수집 → 대본 → 나레이션 → 챕터 배경까지 끝낸다
 * (예전 단일 사건 롱폼의 ①~④ 단계와 동일한 로직을 사건 하나 몫으로 뗀 것).
 * 원문을 5회 시도해도 못 찾으면 null — 호출부가 이번 칸을 건너뛴다.
 *
 * isFirst 가 아니면 대본 맨 앞에 짧은 '사건 전환' 챕터를 붙인다. 나레이션 대본
 * (narrateLongform)이 이미 이 챕터까지 통째로 읽으므로 별도 TTS 경로가 필요
 * 없다 — 몰아보기 특유의 '틀어놓고 듣는' 소비 방식에서, 화면을 안 보고 있어도
 * "사건이 바뀌었다"는 게 귀로 들려야 한다.
 */
async function produceOneCase(opts: {
  seed: string | undefined;
  avoid: ReturnType<typeof recentAvoidList>;
  pack: ReturnType<typeof pickStylePack>;
  workingHistory: { posts: HistoryPost[] };
  isFirst: boolean;
}): Promise<ProducedCase | null> {
  const { avoid, pack, workingHistory, isFirst } = opts;
  let probe = await proposeCase(opts.seed, avoid, {
    topicAngle: pack.topicAngle,
    regionAngle: pack.regionAngle,
  });
  let sources: SourceDoc[] = [];
  for (let tries = 0; tries < 5; tries++) {
    if (isDuplicate(workingHistory, probe.caseKey)) {
      console.log(`   ♻️  중복 소재(${probe.caseKey}) — 다른 사건으로`);
    } else {
      console.log(`   🔎 후보: ${probe.title} (${probe.caseKey})`);
      sources = await gatherSources(probe.searchTerms);
      const volume = sources.reduce((n, d) => n + d.extract.length, 0);
      // 원문이 짧으면 최소 러닝타임을 채울 정보가 없다 — 다른 사건으로 간다.
      // 몰아보기는 사건당 목표 분량이 낮아(CASE_CHAR_LIMITS.min) 단일 사건
      // 롱폼(3000자 기준)보다 문턱을 살짝 낮춰도 지어낼 위험이 크지 않다.
      if (sources.length && volume >= 1800) {
        console.log(`   📚 원문 ${sources.length}건 / ${volume}자: ${sources.map((d) => d.title).join(", ")}`);
        break;
      }
      console.log(`   ↩︎ 원문 부족(${sources.length}건 ${volume}자)`);
      sources = [];
    }
    avoid.caseKeys.push(probe.caseKey);
    avoid.titles.push(probe.title);
    if (tries === 4) return null;
    probe = await proposeCase(undefined, avoid, {
      topicAngle: pack.topicAngle,
      regionAngle: pack.regionAngle,
    });
  }
  if (!sources.length) return null;

  const script = await writeLongform({
    forcedCase: probe,
    sources,
    avoidTitles: avoid.titles,
    charLimits: CASE_CHAR_LIMITS,
  });
  console.log(`   💡 ${script.title}`);

  if (!isFirst) {
    script.chapters.unshift({
      heading: "다음 사건",
      // 이 케이스의 실제 1번째 챕터 배경을 그대로 물려받는다 — 전환 챕터만
      // 따로 배경 검색어를 짓지 않아도 톤이 자연스럽게 이어진다.
      visualQuery: script.chapters[0]?.visualQuery || "dark mysterious empty room",
      segments: [
        { text: "다음 사건입니다.", textEn: "Here's the next case.", emphasis: "normal" },
        { text: script.centralQuestion, textEn: "", emphasis: "normal" },
      ],
    });
  }

  const chapters = await narrateLongform(script, LONGFORM_VOICE);
  const dropped = dropUnreadableVisuals(chapters, 30);
  if (dropped) console.log(`   ⏱️ 읽을 시간이 모자란 그래픽 ${dropped}개 폐기`);
  await attachChapterBroll(chapters);

  console.log(
    `   ⏱️ 대본 ${totalChars(script)}자 / ${countSegments(script)}컷 (전환 챕터 제외)`,
  );

  return { probe, script, chapters, sources };
}

async function findBgm(): Promise<string | undefined> {
  try {
    const files = (await fs.readdir(config.paths.bgm)).filter((f) =>
      f.toLowerCase().endsWith(".mp3"),
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
  const args = { seed: undefined as string | undefined, publish: true };
  for (const a of argv) {
    if (a.startsWith("--seed=")) args.seed = a.slice("--seed=".length) || undefined;
    else if (a === "--no-publish") args.publish = false;
  }
  return args;
}

main().catch((err) => {
  console.error("롱폼 파이프라인 실패:", err);
  process.exit(1);
});

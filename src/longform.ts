import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { proposeCase } from "./assistants/producer.js";
import { writeLongform, totalChars, countSegments } from "./assistants/longformProducer.js";
import { narrateLongform } from "./assistants/narrator.js";
import { attachChapterBroll } from "./assistants/broll.js";
import { renderLongform, renderLongformThumb } from "./render.js";
import { publishLongform } from "./assistants/youtubePublisher.js";
import { loadHistory, recentAvoidList, isDuplicate, appendPost } from "./assistants/history.js";
import { gatherSources, sourcesCitation, type SourceDoc } from "./lib/sources.js";
import { pickStylePack, LONGFORM_VOICE } from "./lib/variety.js";
import { deriveGrade } from "./lib/grade.js";
import { longformDurationInFrames } from "./remotion/timing.js";
import type { LongformInputProps, StoryIdea } from "./types.js";

/**
 * 롱폼(가로형 사건 분석 다큐) 파이프라인.
 *
 *   사건 선정 → 위키백과 원문 → 다큐 대본 → 나레이션 → 챕터 배경 → 렌더 → 유튜브
 *
 * 왜 롱폼인가: 쇼츠로는 YPP 에 못 간다(90일 1,000만 조회 기준까지 약 41배 부족).
 * 반면 구독자 1,000명 조건은 이미 넘었으므로 시청 시간 4,000시간만 채우면 된다.
 * 쇼츠 조회수는 시청 시간에 산입되지 않지만 롱폼은 산입된다.
 *
 * 인스타그램에는 올리지 않는다 — 릴스는 세로 90초 포맷이라 맞지 않는다.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  const history = await loadHistory();
  const avoid = recentAvoidList(history);
  console.log(`🗂️  게시 이력 ${history.posts.length}건 (중복 회피)`);

  const pack = pickStylePack();
  console.log(`   🧭 ${pack.topicAngle.split(" — ")[0]} | ${pack.regionAngle.split(" — ")[0]}`);

  // ① 사건 선정 + 원문 수집 — 롱폼은 정보량이 많아야 하므로 원문이 필수에 가깝다.
  //    원문을 못 찾은 사건으로 8분을 채우면 반드시 지어내게 된다.
  console.log("① 사건 선정 + 원문 수집...");
  let probe = await proposeCase(args.seed, avoid, {
    topicAngle: pack.topicAngle,
    regionAngle: pack.regionAngle,
  });
  let sources: SourceDoc[] = [];
  for (let tries = 0; tries < 5; tries++) {
    if (isDuplicate(history, probe.caseKey)) {
      console.log(`   ♻️  중복 소재(${probe.caseKey}) — 다른 사건으로`);
    } else {
      console.log(`   🔎 후보: ${probe.title} (${probe.caseKey})`);
      sources = await gatherSources(probe.searchTerms);
      const volume = sources.reduce((n, d) => n + d.extract.length, 0);
      // 원문이 짧으면 8분을 채울 정보가 없다 — 다른 사건으로 간다
      if (sources.length && volume >= 3000) {
        console.log(`   📚 원문 ${sources.length}건 / ${volume}자: ${sources.map((d) => d.title).join(", ")}`);
        break;
      }
      console.log(`   ↩︎ 원문 부족(${sources.length}건 ${volume}자) — 롱폼에는 정보가 모자람`);
      sources = [];
    }
    avoid.caseKeys.push(probe.caseKey);
    avoid.titles.push(probe.title);
    if (tries === 4) break;
    probe = await proposeCase(args.seed, avoid, {
      topicAngle: pack.topicAngle,
      regionAngle: pack.regionAngle,
    });
  }
  if (!sources.length) {
    throw new Error(
      "롱폼에 쓸 만한 원문을 5회 시도에도 찾지 못했습니다. " +
        "확인되지 않은 사실로 8분을 채우는 것은 채널 신뢰와 수익창출 심사 양쪽에 치명적이라 중단합니다.",
    );
  }

  // ② 다큐 대본
  console.log("② 다큐 대본 생성...");
  const script = await writeLongform({
    forcedCase: probe,
    sources,
    avoidTitles: avoid.titles,
  });
  console.log(`   💡 ${script.title}`);
  console.log(`   ❓ ${script.centralQuestion}`);
  for (const c of script.chapters) {
    console.log(`      · ${c.heading} (${c.segments.length}컷, ${c.cardKind} ${c.cardItems.length}항목)`);
  }

  // ③ 나레이션 (쇼츠보다 느린 고정 보이스)
  console.log("③ 나레이션(TTS) 합성...");
  const chapters = await narrateLongform(script, LONGFORM_VOICE);
  const secs = longformDurationInFrames(chapters, 30) / 30;
  console.log(
    `   ⏱️ 대본 ${totalChars(script)}자 / ${countSegments(script)}컷 → 예상 러닝타임 ${Math.floor(secs / 60)}분 ${Math.round(secs % 60)}초`,
  );
  if (secs < 300) console.warn(`   ⚠️ 5분 미만(${secs.toFixed(0)}초) — 목표(6~8분)보다 짧습니다.`);
  if (secs > 660) console.warn(`   ⚠️ 11분 초과(${secs.toFixed(0)}초) — 분량 기준 확인 필요.`);

  // ④ 챕터 배경
  console.log("④ 챕터 배경 자료화면(Pexels)...");
  await attachChapterBroll(chapters);

  const grade = deriveGrade(probe.caseKey, script.thumbBadge, pack.topicAngle);
  console.log(`   🎨 장르 그레이드: ${grade.genre}`);

  const inputProps: LongformInputProps = {
    title: script.title,
    thumbTitle: script.thumbTitle,
    thumbBadge: script.thumbBadge,
    centralQuestion: script.centralQuestion,
    chapters,
    bgmSrc: await findBgm(),
    grade,
  };

  await fs.mkdir(config.paths.out, { recursive: true });
  await fs.writeFile(
    path.join(config.paths.out, "longform.json"),
    JSON.stringify({ probe, script, inputProps }, null, 2),
  );

  // ⑤ 렌더 (영상 + 전용 썸네일)
  console.log("⑤ 영상 렌더 (1920x1080)...");
  const videoPath = await renderLongform(inputProps);
  console.log(`   🎬 ${videoPath}`);
  const thumbPath = await renderLongformThumb(inputProps);
  console.log(`   🖼️  썸네일: ${thumbPath}`);

  if (!args.publish) {
    console.log("   ⏭️  업로드 생략 (--no-publish). 영상 파일만 생성했습니다.");
    return;
  }

  // ⑥ 유튜브 업로드 (인스타 제외 — 가로 8분은 릴스 포맷이 아니다)
  console.log("⑥ 유튜브 업로드...");
  const citation = sourcesCitation(sources);
  const { videoId } = await publishLongform(videoPath, script, citation, thumbPath);
  console.log(`   ✅ 롱폼 게시 완료: https://youtu.be/${videoId}`);

  // 이력에 기록 — 쇼츠와 같은 history.json 을 써서 소재가 겹치지 않게 한다
  const idea: StoryIdea = {
    caseKey: probe.caseKey,
    thumbTitle: script.thumbTitle,
    thumbBadge: script.thumbBadge,
    hook: script.centralQuestion,
    title: script.title,
    premise: probe.premise,
    synopsis: script.description.slice(0, 300),
    twist: "",
    basedOnRealEvents: true,
    factNote: sources.map((d) => d.title).join(", "),
    moodKeywords: [],
  };
  await appendPost(idea, script.tags);

  // 썸네일 보관 (쇼츠와 동일하게 저장소에 남긴다)
  try {
    await fs.mkdir("thumbnails", { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    await fs.copyFile(thumbPath, path.join("thumbnails", `${date}-lf-${probe.caseKey}-${videoId}.jpg`));
  } catch {
    /* 보관 실패는 게시에 영향 없음 */
  }
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

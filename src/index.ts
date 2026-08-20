import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import { writeReelPlan, proposeCase } from "./assistants/producer.js";
import { gatherSources, sourcesCitation, type SourceDoc } from "./lib/sources.js";
import { narrate } from "./assistants/narrator.js";
import { attachBroll } from "./assistants/broll.js";
import { renderReel } from "./render.js";
import { publishReel } from "./assistants/publisher.js";
import { publishYouTube } from "./assistants/youtubePublisher.js";
import {
  loadHistory,
  recentAvoidList,
  isDuplicate,
  appendPost,
} from "./assistants/history.js";
import { pickStylePack } from "./lib/variety.js";
import { deriveGrade, gradeColors } from "./lib/grade.js";
import { totalDurationInFrames } from "./remotion/timing.js";
import { reelSrt } from "./lib/captions.js";
import type { ReelInputProps } from "./types.js";

/**
 * 전체 파이프라인 오케스트레이터.
 *
 *   스토리 구상 → 대본 → 캡션/해시태그 → 나레이션(TTS) → 영상 렌더 → 인스타 업로드
 *
 * 플래그:
 *   --only=ideate     스토리 아이디어만 생성하고 출력
 *   --no-publish      업로드 단계 생략 (영상 파일까지만 생성)
 *   --seed="소재"      스토리 구상 시 소재 힌트
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 중복 방지: 이미 게시한 사건 목록을 불러와 LLM 에 '겹치지 마라'로 전달
  const history = await loadHistory();
  const avoid = recentAvoidList(history);
  console.log(`🗂️  게시 이력 ${history.posts.length}건 (중복 회피)`);

  // 버라이어티 팩: 영상마다 목소리·비주얼·훅 구성을 랜덤 조합 (동일 템플릿 반복 방지)
  const pack = pickStylePack();
  console.log(
    `🎲 버라이어티: 보이스=${pack.voice.label} | 자막=${pack.theme.boxStyle} | 줌=${pack.theme.kenburns} | 긴장색=${pack.theme.colors.tension}`,
  );
  console.log(`   🧭 ${pack.topicAngle.split(" — ")[0]} | ${pack.regionAngle.split(" — ")[0]}`);
  console.log(
    `   🎬 ${pack.hookStyle.split(" — ")[0]} | ${pack.signoffStyle.split(" — ")[0]}`,
  );

  const planOpts = {
    hookStyle: pack.hookStyle,
    titleStyle: pack.titleStyle,
    signoffStyle: pack.signoffStyle,
    topicAngle: pack.topicAngle,
    regionAngle: pack.regionAngle,
  };

  // ① 사건 선정 — 중복이거나 원문을 못 찾으면 다른 사건으로 다시 고른다.
  //    중복 검사를 '대본 생성 전'으로 당겨서, 겹친 소재에 대본 생성 비용을
  //    쓰지 않게 했다(예전엔 풀 대본을 만든 뒤에야 중복을 알았다).
  console.log("① 사건 선정 + 원문 수집...");
  let probe = await proposeCase(args.seed, avoid, planOpts);
  let sources: SourceDoc[] = [];
  for (let tries = 0; tries < 4; tries++) {
    if (isDuplicate(history, probe.caseKey)) {
      console.log(`   ♻️  중복 소재(${probe.caseKey}) — 다른 사건으로`);
    } else {
      console.log(`   🔎 후보: ${probe.title} (${probe.caseKey})`);
      sources = await gatherSources(probe.searchTerms);
      if (sources.length) {
        console.log(`   📚 원문 ${sources.length}건 확보: ${sources.map((d) => d.title).join(", ")}`);
        break;
      }
      console.log(`   ↩︎ 원문을 못 찾음(${probe.searchTerms.join(", ")}) — 다른 사건으로`);
    }
    avoid.caseKeys.push(probe.caseKey);
    avoid.titles.push(probe.title);
    if (tries === 3) break;
    probe = await proposeCase(args.seed, avoid, planOpts);
  }
  if (!sources.length) {
    console.warn("   ⚠️ 원문 없이 진행 — 안전 모드(구체적 수치·인용 자제)로 대본을 만듭니다.");
  }

  // ② 확정된 사건 + 원문에 근거해 대본·캡션 생성
  console.log("②~③ 대본·캡션 생성...");
  const { idea, script, metadata } = await writeReelPlan(args.seed, avoid, {
    ...planOpts,
    forcedCase: probe,
    sources,
  });

  // 수집한 원문을 설명란 참고자료로 (유튜브에만 노출)
  if (sources.length) metadata.sourcesCitation = sourcesCitation(sources);

  console.log(`   💡 ${idea.title} — ${idea.hook}`);
  console.log(`   🔑 caseKey: ${idea.caseKey}`);
  console.log(`   📝 세그먼트 ${script.segments.length}개`);

  // 장르 고정 색보정 — 소재가 확정된 지금 시점에 장르를 판별해 테마에 채운다.
  // 자막 강조색도 랜덤 팔레트 대신 장르 색으로 교체(채널 룩 고정).
  const grade = deriveGrade(idea.caseKey, idea.thumbBadge, pack.topicAngle);
  pack.theme.grade = grade;
  pack.theme.colors = gradeColors(grade.genre);
  console.log(`   🎨 장르 그레이드: ${grade.genre} (마커=${grade.thumbMarker})`);

  if (args.only === "ideate") {
    console.log(JSON.stringify(idea, null, 2));
    return;
  }

  console.log("④ 나레이션(TTS) 합성...");
  const segments = await narrate(script, pack.voice);
  {
    // 최종 러닝타임 예측 로그 — 목표 구간(95~108초) 검증용
    const chars = script.segments.reduce((n, s) => n + s.text.length, 0);
    const secs = totalDurationInFrames(segments, 30, true) / 30;
    console.log(`   ⏱️ 대본 ${chars}자 → 예상 러닝타임 ${secs.toFixed(1)}초`);
    if (secs > 115) {
      console.warn(
        `   ⚠️ 115초 초과(${secs.toFixed(1)}초) — 인스타 릴스 도달률이 120초부터 3.5%대로 떨어지는 구간. 분량 기준 조정 필요.`,
      );
    } else if (secs < 85) {
      console.warn(`   ⚠️ 85초 미만(${secs.toFixed(1)}초) — 목표(95~108초)보다 짧음. 분량 기준 확인 필요.`);
    }
  }

  console.log("④-b 배경 자료화면(Pexels)...");
  await attachBroll(segments);

  const inputProps: ReelInputProps = {
    title: idea.title,
    segments,
    moodKeywords: idea.moodKeywords,
    bgmSrc: await findBgm(),
    theme: pack.theme,
    thumbTitle: idea.thumbTitle || idea.title,
    thumbBadge: idea.thumbBadge,
  };

  // 산출물을 out/ 에 함께 저장 (재현/디버깅용)
  await fs.mkdir(config.paths.out, { recursive: true });
  await fs.writeFile(
    path.join(config.paths.out, "project.json"),
    JSON.stringify({ idea, script, metadata, inputProps }, null, 2),
  );

  console.log("⑤ 영상 렌더...");
  const videoPath = await renderReel(inputProps);
  console.log(`   🎬 ${videoPath}`);

  // 첫 프레임(썸네일 카드)을 이미지로 추출 — 유튜브 커스텀 썸네일용
  // (유튜브는 첫 프레임을 자동 채택하지 않으므로 thumbnails.set 으로 직접 지정)
  const thumbPath = await extractThumb(videoPath);

  if (args.publish) {
    // 인스타·유튜브를 각각 독립 게시 (한쪽이 실패해도 다른 쪽은 진행)
    let anyFail = false;
    let anyPublished = false;

    console.log("⑥ 인스타그램 업로드...");
    try {
      const { mediaId } = await publishReel(videoPath, metadata);
      console.log(`   ✅ 인스타 게시 완료 (media id: ${mediaId})`);
      anyPublished = true;
    } catch (e) {
      anyFail = true;
      console.error(`   ❌ 인스타 게시 실패: ${e instanceof Error ? e.message : String(e)}`);
    }

    let ytVideoId: string | undefined;
    if (config.youtube.enabled) {
      console.log("⑦ 유튜브 업로드...");
      try {
        const { videoId } = await publishYouTube(
          videoPath,
          idea,
          metadata,
          thumbPath,
          // 썸네일 카드가 맨 앞 1프레임을 차지하므로 컴포지션과 같은 조건을 써야 싱크가 맞는다
          reelSrt(segments, Boolean(inputProps.thumbTitle), 30),
          reelSrt(segments, Boolean(inputProps.thumbTitle), 30, "en"),
        );
        ytVideoId = videoId;
        console.log(`   ✅ 유튜브 게시 완료: https://youtu.be/${videoId}`);
        anyPublished = true;
      } catch (e) {
        anyFail = true;
        console.error(`   ❌ 유튜브 게시 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      console.log("   ⏭️  유튜브 미설정(YT_CLIENT_ID/SECRET/REFRESH_TOKEN) — 유튜브 게시 건너뜀");
    }

    // 한 곳이라도 실제 게시됐으면 이력에 기록 (소재·해시태그 회피용)
    if (anyPublished) await appendPost(idea, metadata.hashtags);

    // 썸네일 카드를 저장소 thumbnails/ 폴더에 보관 — 유튜브가 쇼츠 썸네일
    // API 를 열기 전까지 수동 지정용 원본으로 사용 (워크플로가 커밋)
    if (anyPublished && thumbPath) await archiveThumb(thumbPath, idea.caseKey, ytVideoId);

    if (anyFail) process.exitCode = 1; // 하나라도 실패하면 워크플로가 알 수 있게
  } else {
    console.log("   ⏭️  업로드 생략 (--no-publish). 영상 파일만 생성했습니다.");
  }
}

const execFileAsync = promisify(execFile);

/**
 * 게시된 영상의 썸네일 카드를 thumbnails/날짜-사건키-영상ID.jpg 로 보관.
 * 실패해도 게시 결과에는 영향 없음.
 */
async function archiveThumb(
  thumbPath: string,
  caseKey: string,
  videoId?: string,
): Promise<void> {
  try {
    const dir = "thumbnails";
    await fs.mkdir(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const name = `${date}-${caseKey}${videoId ? `-${videoId}` : ""}.jpg`;
    await fs.copyFile(thumbPath, path.join(dir, name));
    console.log(`   🗂️  썸네일 보관: thumbnails/${name}`);
  } catch (e) {
    console.warn(`   ⚠️ 썸네일 보관 실패(게시는 완료됨): ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * 렌더된 영상의 첫 프레임(썸네일 카드)을 jpg 로 추출.
 * ffmpeg 미설치/실패 시 undefined (썸네일 지정만 생략, 게시는 계속).
 */
async function extractThumb(videoPath: string): Promise<string | undefined> {
  const thumbPath = path.join(config.paths.out, "thumb.jpg");
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      videoPath,
      "-vf",
      "select=eq(n\\,0)",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      thumbPath,
    ]);
    const st = await fs.stat(thumbPath);
    if (st.size < 1024 || st.size > 2 * 1024 * 1024) throw new Error(`비정상 크기 ${st.size}B`);
    console.log(`   🖼️  썸네일 추출: ${thumbPath} (${Math.round(st.size / 1024)}KB)`);
    return thumbPath;
  } catch (e) {
    console.warn(`   ⚠️ 썸네일 추출 실패(게시는 계속): ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/** public/bgm/ 에 mp3 가 있으면 그 상대경로 반환 (없으면 undefined) */
async function findBgm(): Promise<string | undefined> {
  try {
    const files = (await fs.readdir(config.paths.bgm)).filter((f) =>
      f.toLowerCase().endsWith(".mp3"),
    );
    // BGM_URL 오버라이드(aaa- 접두사)가 있으면 그것을 우선, 없으면 랜덤(영상마다 다른 분위기)
    const override = files.find((f) => f.startsWith("aaa-"));
    const mp3 = override ?? files[Math.floor(Math.random() * files.length)];
    if (mp3) {
      console.log(`   🎵 BGM: bgm/${mp3}${override ? " (override)" : " (랜덤)"}`);
      return `bgm/${mp3}`;
    }
  } catch {
    /* bgm 폴더 없음 */
  }
  console.log("   🎵 BGM 없음 (public/bgm/ 에 mp3 를 넣으면 자동 적용)");
  return undefined;
}

function parseArgs(argv: string[]) {
  const args = { only: "", seed: "" as string | undefined, publish: true };
  for (const a of argv) {
    if (a.startsWith("--only=")) args.only = a.slice("--only=".length);
    else if (a.startsWith("--seed=")) args.seed = a.slice("--seed=".length);
    else if (a === "--no-publish") args.publish = false;
  }
  if (!args.seed) args.seed = undefined;
  return args;
}

main().catch((err) => {
  console.error("파이프라인 실패:", err);
  process.exit(1);
});

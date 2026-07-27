import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import { writeReelPlan } from "./assistants/producer.js";
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

  // 스토리·대본·캡션을 한 번의 LLM 호출로 (Gemini 무료 할당량 절약: 3콜→1콜)
  console.log("①~③ 스토리·대본·캡션 통합 생성...");
  let { idea, script, metadata } = await writeReelPlan(args.seed, avoid, {
    hookStyle: pack.hookStyle,
  });

  // 그래도 겹치면 재생성 (최대 3회). 겹친 caseKey 는 회피 목록에 누적.
  for (let tries = 0; tries < 3 && isDuplicate(history, idea.caseKey); tries++) {
    console.log(`   ♻️  중복 소재(${idea.caseKey}) — 다른 소재로 재생성`);
    avoid.caseKeys.push(idea.caseKey);
    avoid.titles.push(idea.title);
    ({ idea, script, metadata } = await writeReelPlan(args.seed, avoid, {
      hookStyle: pack.hookStyle,
    }));
  }
  if (isDuplicate(history, idea.caseKey)) {
    console.warn(`   ⚠️ 재생성에도 중복(${idea.caseKey}) — 그대로 진행(다음엔 회피됨)`);
  }

  console.log(`   💡 ${idea.title} — ${idea.hook}`);
  console.log(`   🔑 caseKey: ${idea.caseKey}`);
  console.log(`   📝 세그먼트 ${script.segments.length}개`);
  if (args.only === "ideate") {
    console.log(JSON.stringify(idea, null, 2));
    return;
  }

  console.log("④ 나레이션(TTS) 합성...");
  const segments = await narrate(script, pack.voice);

  console.log("④-b 배경 자료화면(Pexels)...");
  await attachBroll(segments);

  const inputProps: ReelInputProps = {
    title: idea.title,
    segments,
    moodKeywords: idea.moodKeywords,
    bgmSrc: await findBgm(),
    theme: pack.theme,
    thumbTitle: idea.thumbTitle || idea.title,
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

    if (config.youtube.enabled) {
      console.log("⑦ 유튜브 업로드...");
      try {
        const { videoId } = await publishYouTube(videoPath, idea, metadata, thumbPath);
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

    if (anyFail) process.exitCode = 1; // 하나라도 실패하면 워크플로가 알 수 있게
  } else {
    console.log("   ⏭️  업로드 생략 (--no-publish). 영상 파일만 생성했습니다.");
  }
}

const execFileAsync = promisify(execFile);

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

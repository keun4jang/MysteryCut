import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { writeReelPlan } from "./assistants/producer.js";
import { narrate } from "./assistants/narrator.js";
import { attachBroll } from "./assistants/broll.js";
import { renderReel } from "./render.js";
import { publishReel } from "./assistants/publisher.js";
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

  // 스토리·대본·캡션을 한 번의 LLM 호출로 (Gemini 무료 할당량 절약: 3콜→1콜)
  console.log("①~③ 스토리·대본·캡션 통합 생성...");
  const { idea, script, metadata } = await writeReelPlan(args.seed);
  console.log(`   💡 ${idea.title} — ${idea.hook}`);
  console.log(`   📝 세그먼트 ${script.segments.length}개`);
  if (args.only === "ideate") {
    console.log(JSON.stringify(idea, null, 2));
    return;
  }

  console.log("④ 나레이션(TTS) 합성...");
  const segments = await narrate(script);

  console.log("④-b 배경 자료화면(Pexels)...");
  await attachBroll(segments);

  const inputProps: ReelInputProps = {
    title: idea.title,
    segments,
    moodKeywords: idea.moodKeywords,
    bgmSrc: await findBgm(),
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

  if (args.publish) {
    console.log("⑥ 인스타그램 업로드...");
    const { mediaId } = await publishReel(videoPath, metadata);
    console.log(`   ✅ 게시 완료 (media id: ${mediaId})`);
  } else {
    console.log("   ⏭️  업로드 생략 (--no-publish). 영상 파일만 생성했습니다.");
  }
}

/** public/bgm/ 에 mp3 가 있으면 그 상대경로 반환 (없으면 undefined) */
async function findBgm(): Promise<string | undefined> {
  try {
    const files = await fs.readdir(config.paths.bgm);
    const mp3 = files.find((f) => f.toLowerCase().endsWith(".mp3"));
    if (mp3) {
      console.log(`   🎵 BGM: bgm/${mp3}`);
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

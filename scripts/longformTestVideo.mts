/**
 * 롱폼 디자인 확인용 테스트 영상.
 *
 * 스틸로는 전환·챕터 오프너·자막 등장 같은 '움직임'을 못 본다. 그렇다고
 * 매번 워크플로 드라이런(약 26분 + Gemini 호출)을 돌리기도 아깝다.
 * 표본 데이터로 1분짜리 영상만 뽑아 눈으로 확인한다.
 *
 *   npx tsx scripts/longformTestVideo.mts scratchpad/test.mp4
 *
 * 나레이션은 넣지 않는다(muted) — 표본에는 실제 음성이 없고, 확인하려는 건
 * 화면이다. 실제 나레이션이 붙은 영상은 워크플로 드라이런으로 본다.
 */
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { config } from "../src/config.js";
import { inputProps } from "./longformFixture.js";

const out = path.resolve(process.argv[2] ?? "scratchpad/longform-test.mp4");

const serveUrl = await bundle({
  entryPoint: config.paths.remotionEntry,
  publicDir: config.paths.public,
  webpackOverride: (c) => ({
    ...c,
    resolve: { ...c.resolve, extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".jsx": [".tsx", ".jsx"] } },
  }),
});

const composition = await selectComposition({ serveUrl, id: "LongformDoc", inputProps });
console.log(`길이 ${composition.durationInFrames}프레임 (${(composition.durationInFrames / 30).toFixed(1)}초)`);

await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  outputLocation: out,
  inputProps,
  muted: true,
  onProgress: ({ progress }) => {
    if (Math.round(progress * 100) % 20 === 0) process.stdout.write(`\r  ${Math.round(progress * 100)}%`);
  },
});
console.log(`\n✅ ${out}`);

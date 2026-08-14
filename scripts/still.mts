import path from "node:path";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill } from "@remotion/renderer";
import { config } from "../src/config.js";
import type { ReelInputProps } from "../src/types.js";

const serveUrl = await bundle({
  entryPoint: config.paths.remotionEntry,
  publicDir: config.paths.public,
  webpackOverride: (c) => ({
    ...c,
    resolve: {
      ...c.resolve,
      extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".jsx": [".tsx", ".jsx"] },
    },
  }),
});

// 사용법: tsx scripts/still.mts <출력경로> [boxStyle] [tensionColor]
const boxStyle = (process.argv[3] ?? "box") as "box" | "minimal" | "bar";
const tension = process.argv[4] ?? "#ffd76b";

const inputProps: ReelInputProps = {
  title: "미스터리 예시",
  thumbTitle: "피가 전부\n사라졌다",
  // 6번째 인자로 배지 문구 지정 (미지정 시 컴포넌트 기본값 확인용으로 undefined)
  thumbBadge: process.argv[6],
  moodKeywords: ["긴장", "밤"],
  theme: {
    colors: { normal: "#ffffff", tension, reveal: "#ff5a5a" },
    boxStyle,
    kenburns: "in",
  },
  segments: [
    {
      // 자막 문구를 env 로 바꿔가며 가독성 비교용 스틸을 뽑을 수 있게 함
      text: process.env.CAPTION_TEXT ?? "근데 그 시신들의 행색이 너무 이상했어요.",
      textEn:
        process.env.CAPTION_EN ?? "But the way the bodies were dressed was really strange.",
      emphasis: "tension",
      audioSrc: "audio/seg-0.mp3",
      durationInSeconds: 4,
      visualQuery: "",
    },
  ],
};

const composition = await selectComposition({ serveUrl, id: "MysteryReel", inputProps });
const output = path.resolve(process.argv[2] ?? "scratchpad/still.png");
// frame 0 = 썸네일 카드, 그 외 = 자막 화면
const frame = Number(process.argv[5] ?? 20);
await renderStill({ composition, serveUrl, output, inputProps, frame });
console.log("STILL:", output);

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

const inputProps: ReelInputProps = {
  title: "미스터리 예시",
  moodKeywords: ["긴장", "밤"],
  segments: [
    {
      text: "근데 그 시신들의 행색이 너무 이상했어요.",
      textEn: "But the way the bodies were dressed was really strange.",
      emphasis: "tension",
      audioSrc: "audio/seg-0.mp3",
      durationInSeconds: 4,
      visualQuery: "",
    },
  ],
};

const composition = await selectComposition({ serveUrl, id: "MysteryReel", inputProps });
const output = path.resolve(process.argv[2] ?? "scratchpad/still.png");
await renderStill({ composition, serveUrl, output, inputProps, frame: 20 });
console.log("STILL:", output);

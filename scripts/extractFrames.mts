/**
 * 테스트 영상에서 검토용 프레임을 뽑는다.
 *
 * 스틸은 내가 고른 순간만 본다 — 겹침 사고는 내가 안 고른 순간에서 났다
 * (챕터 오프너 위에 첫 컷이 겹친 건 스틸 프레임을 옮겨서 가려졌었다).
 * 컷 경계·오프너 창·컷 한가운데를 빠짐없이 훑어 놓친 데가 없게 한다.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill } from "@remotion/renderer";
import { config } from "../src/config.js";
import { inputProps, chapters } from "./longformFixture.js";
import { LONGFORM_OPENER_LEAD, longformBreathSeconds } from "../src/remotion/timing.js";

const outDir = process.argv[2] ?? "scratchpad/frames";
await fs.mkdir(outDir, { recursive: true });
const fps = 30;

// 챕터·컷 경계를 그대로 재현해 검토할 프레임을 고른다
const picks: Array<[number, string]> = [];
let abs = 0;
chapters.forEach((c, ci) => {
  picks.push([abs + 10, `ch${ci}-opener`]); // 오프너가 떠 있는 동안
  let f = abs + LONGFORM_OPENER_LEAD;
  c.segments.forEach((s, si) => {
    const len =
      Math.max(1, Math.round(s.durationInSeconds * fps)) +
      Math.round(longformBreathSeconds(s.emphasis, si === c.segments.length - 1) * fps);
    picks.push([f + 14, `ch${ci}-seg${si}-in`]); // 등장 직후
    picks.push([f + Math.floor(len / 2), `ch${ci}-seg${si}-mid`]); // 한가운데
    f += len;
  });
  abs = f;
});

const serveUrl = await bundle({
  entryPoint: config.paths.remotionEntry,
  publicDir: config.paths.public,
  webpackOverride: (c) => ({
    ...c,
    resolve: { ...c.resolve, extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".jsx": [".tsx", ".jsx"] } },
  }),
});
const composition = await selectComposition({ serveUrl, id: "LongformDoc", inputProps });

for (const [frame, name] of picks) {
  const f = Math.min(frame, composition.durationInFrames - 1);
  await renderStill({
    composition, serveUrl, inputProps, frame: f,
    output: path.resolve(outDir, `${String(f).padStart(4, "0")}-${name}.png`),
  });
}
console.log(`프레임 ${picks.length}장 → ${outDir}`);

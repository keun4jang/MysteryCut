/**
 * 롱폼 화면 검증용 스틸 렌더.
 * 두 모드(내레이션 자막 / 단일 자료 프레임)와 자료 종류별 화면을 눈으로 확인한다.
 * public/audio/lf-test.mp3 와 public/broll/lf-ch-0..3.jpg 가 있어야 한다.
 */
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill } from "@remotion/renderer";
import { config } from "../src/config.js";
import { inputProps, frameAt } from "./longformFixture.js";

const outDir = process.argv[2] ?? "scratchpad";

const serveUrl = await bundle({
  entryPoint: config.paths.remotionEntry,
  publicDir: config.paths.public,
  webpackOverride: (c) => ({
    ...c,
    resolve: { ...c.resolve, extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".jsx": [".tsx", ".jsx"] } },
  }),
});

// [컴포지션, 파일명, 프레임]. 프레임은 (챕터, 컷)에서 계산한다 — 하드코딩하면
// 타이밍을 바꿀 때마다 엉뚱한 화면을 찍는다.
const jobs: Array<[string, string, number]> = [
  ["LongformDoc", "lf-opener.png", frameAt(0, -1, 20)],
  ["LongformDoc", "lf-narration.png", frameAt(0, 0)],
  ["LongformDoc", "lf-question.png", frameAt(1, 1)],
  ["LongformDoc", "lf-timeline.png", frameAt(2, 0, 60)], // 60 = support 등장 애니메이션이 끝난 뒤
  ["LongformDoc", "lf-timeline2.png", frameAt(2, 1)],
  ["LongformDoc", "lf-opener-frame.png", frameAt(3, -1, 20)],
  ["LongformDoc", "lf-evidence.png", frameAt(3, 0)],
  ["LongformDoc", "lf-problem.png", frameAt(3, 1)],
  ["LongformDoc", "lf-person.png", frameAt(3, 2)],
  ["LongformDoc", "lf-theory.png", frameAt(3, 3)],
  ["LongformDoc", "lf-verdict.png", frameAt(3, 4)],
  ["LongformDoc", "lf-qty-pair.png", frameAt(4, 0, 40)],
  ["LongformDoc", "lf-qty-single.png", frameAt(4, 1, 40)],
  ["LongformDoc", "lf-qty-nobar.png", frameAt(4, 2, 40)],
  ["LongformDoc", "lf-stress-person.png", frameAt(5, 0)],
  ["LongformDoc", "lf-stress-timeline.png", frameAt(5, 1)],
  ["LongformDoc", "lf-stress-narration.png", frameAt(5, 2)],
  ["LongformThumb", "lf-thumb.png", 0],
  ["LongformThumb", "lf-thumb-long.png", 0],
  ["LongformThumb", "lf-thumb-one.png", 0],
];
// 썸네일은 제목 길이에 따라 레이아웃이 달라진다(빨간 박스 가드) — 경우별로 찍어 본다
const thumbVariants: Record<string, { thumbTitle: string; thumbBadge: string }> = {
  "lf-thumb-long.png": { thumbTitle: "5백 년 전\n멈추지 않은 춤", thumbBadge: "역사 미스터리" },
  "lf-thumb-one.png": { thumbTitle: "사라진 목격자", thumbBadge: "미제 실화" },
};

for (const [id, out, frame] of jobs) {
  // selectComposition 이 props 를 미리 확정하므로 변형도 여기서 같이 넘겨야 한다.
  // renderStill 에만 넘기면 컴포지션이 들고 있는 기본 props 가 이긴다.
  const props = { ...inputProps, ...(thumbVariants[out] ?? {}) };
  const composition = await selectComposition({ serveUrl, id, inputProps: props });
  const f = Math.min(frame, composition.durationInFrames - 1);
  await renderStill({
    composition,
    serveUrl,
    output: path.resolve(outDir, out),
    inputProps: props,
    frame: f,
  });
  console.log("STILL:", out, "frame", f, "/", composition.durationInFrames);
}

/**
 * 썸네일 문구 미리보기.
 *
 * 롱폼은 썸네일에서 조회수가 갈리는데, 문구가 실제로 화면에 어떻게 앉는지는
 * 렌더해 봐야만 안다(줄 길이에 따라 글자 크기와 빨간 박스 강조가 달라진다).
 * 새 문구 후보를 넣고 돌려 눈으로 고르는 용도.
 *
 *   npx tsx scripts/thumbPreview.mts scratchpad/thumbs
 *
 * thumbTitleIssues 검사도 같이 돌려서, 규칙에 걸리는 문구는 표시해 준다.
 */
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill } from "@remotion/renderer";
import { config } from "../src/config.js";
import { deriveGrade } from "../src/lib/grade.js";
import { thumbTitleIssues } from "../src/assistants/longformProducer.js";
import type { LongformInputProps, NarratedChapter } from "../src/types.js";

const outDir = process.argv[2] ?? "scratchpad/thumbs";

// [파일명, thumbTitle, thumbBadge, 배경사진, 규칙 유형]
const CASES: Array<[string, string, string, string, string]> = [
  ["p-num.png", "열두 명이\n마신 것", "실화 미제사건", "broll/lf-ch-1.jpg", "① 숫자"],
  ["p-contra.png", "범인 없는\n살인", "판결 기록", "broll/lf-ch-2.jpg", "② 모순"],
  ["p-neg.png", "끝내 안 열린\n금고", "실화 미제사건", "broll/lf-ch-0.jpg", "③ 부정"],
  ["p-obj.png", "명함\n한 장", "미제 실화", "broll/lf-ch-3.jpg", "④ 사물"],
  ["p-year.png", "37년 만에\n나온 이름", "판결 기록", "broll/lf-ch-2.jpg", "① 숫자(햇수)"],
  ["p-hist.png", "5백 년 동안\n멈춘 춤", "역사 미스터리", "broll/lf-ch-0.jpg", "① 숫자 + 마지막 5자"],
  ["p-long.png", "아무도 보지 못한\n세 번째 그림자", "전설 기록", "broll/lf-ch-1.jpg", "마지막 줄 7자 → 박스 해제"],
];

const serveUrl = await bundle({
  entryPoint: config.paths.remotionEntry,
  publicDir: config.paths.public,
  webpackOverride: (c) => ({
    ...c,
    resolve: { ...c.resolve, extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".jsx": [".tsx", ".jsx"] } },
  }),
});

const chapters: NarratedChapter[] = [
  { heading: "", visualQuery: "", bgSrc: "broll/lf-ch-0.jpg", segments: [] },
];

for (const [file, thumbTitle, thumbBadge, bg, kind] of CASES) {
  const issues = thumbTitleIssues(thumbTitle);
  const props: LongformInputProps = {
    title: "",
    thumbTitle,
    thumbBadge,
    centralQuestion: "",
    thumbQuery: "",
    thumbBgSrc: bg,
    chapters,
    grade: deriveGrade(file, thumbBadge),
  };
  const composition = await selectComposition({ serveUrl, id: "LongformThumb", inputProps: props });
  await renderStill({
    composition,
    serveUrl,
    output: path.resolve(outDir, file),
    inputProps: props,
    imageFormat: "png",
    frame: 0,
  });
  const flag = issues.length ? `⚠️ ${issues.join(" / ")}` : "OK";
  console.log(`${file}  ${kind}  "${thumbTitle.replace(/\n/g, " / ")}"  ${flag}`);
}

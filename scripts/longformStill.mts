/**
 * 롱폼 화면 검증용 스틸 렌더.
 * 두 모드(내레이션 자막 / 단일 자료 프레임)와 자료 종류별 화면을 눈으로 확인한다.
 * public/audio/lf-test.mp3 와 public/broll/lf-ch-0..3.jpg 가 있어야 한다.
 */
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill } from "@remotion/renderer";
import { config } from "../src/config.js";
import { deriveGrade } from "../src/lib/grade.js";
import type { LongformInputProps, NarratedChapter } from "../src/types.js";

const outDir = process.argv[2] ?? "scratchpad";

const serveUrl = await bundle({
  entryPoint: config.paths.remotionEntry,
  publicDir: config.paths.public,
  webpackOverride: (c) => ({
    ...c,
    resolve: { ...c.resolve, extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".jsx": [".tsx", ".jsx"] } },
  }),
});

type Seg = NarratedChapter["segments"][0];
const seg = (
  text: string,
  emphasis: Seg["emphasis"] = "normal",
  frame?: Seg["frame"],
): Seg => ({ text, emphasis, audioSrc: "audio/lf-test.mp3", durationInSeconds: 3.6, frame });

const chapters: NarratedChapter[] = [
  {
    heading: "독약의 속임수", visualQuery: "", bgSrc: "broll/lf-ch-0.jpg", bgBrightness: 0.78,
    segments: [
      seg("한 남자가 은행 문을 열고 들어왔습니다."),
      seg("그리고 열두 명이 그 자리에서 쓰러졌습니다.", "reveal"),
    ],
  },
  {
    heading: "오늘의 질문", visualQuery: "", bgSrc: "broll/lf-ch-1.jpg", bgBrightness: 0.68,
    segments: [
      seg("이 영상에서 확인할 것은 세 가지입니다."),
      seg("그는 어떻게 모두를 속였을까요.", "normal", { kind: "question", label: "오늘 확인할 것" }),
    ],
  },
  {
    heading: "죽음의 일 분", visualQuery: "", bgSrc: "broll/lf-ch-2.jpg", bgBrightness: 0.86,
    segments: [
      seg("남자는 보건 당국 직원이라고 말했습니다.", "normal",
          { kind: "timeline", label: "1948년 1월 26일", support: "폐점 직전, 은행 안에는 열여섯 명이 있었습니다" }),
      seg("그는 예방약이라며 액체를 나눠 주었습니다.", "normal",
          { kind: "timeline", label: "오후 3시 30분" }),
      seg("직원 열두 명이 끝내 돌아오지 못했습니다.", "reveal",
          { kind: "timeline", label: "1948년 1월 26일 저녁" }),
    ],
  },
  {
    heading: "드러난 모순들", visualQuery: "", bgSrc: "broll/lf-ch-3.jpg", bgBrightness: 0.78,
    segments: [
      seg("찻잔에서 독성 물질이 검출됐습니다.", "normal",
          { kind: "evidence", label: "증거 02" }),
      seg("하지만 지문은 하나도 나오지 않았습니다.", "tension",
          { kind: "problem", label: "남은 문제" }),
      seg("경찰이 지목한 사람은 화가였습니다.", "normal",
          { kind: "person", label: "핵심 인물", support: "체포 당시 예순 살, 사건과의 접점은 명함 한 장" }),
      seg("그는 끝까지 억울함을 주장했습니다.", "normal",
          { kind: "theory", label: "가설 1" }),
      seg("법원은 사형을 확정했습니다.", "reveal",
          { kind: "verdict", label: "공식 결론" }),
    ],
  },
  // 스트레스 케이스 — 모델이 분량 규칙(본문 30~38자, 보조 30자)을 넘겼을 때도
  // 자막 안전선(y=812)을 못 넘는지 확인한다. line-clamp 가 실제로 먹는지가 핵심.
  {
    heading: "분량 초과 검증", visualQuery: "", bgSrc: "broll/lf-ch-0.jpg", bgBrightness: 0.78,
    segments: [
      seg("경찰은 사건 당일 은행 안에 있었던 사람들의 진술을 하나하나 대조했지만 서로 맞아떨어지는 대목이 거의 없었습니다.", "normal",
          { kind: "person", label: "핵심 인물",
            support: "체포 당시 예순 살, 사건과의 접점은 명함 한 장뿐이었고 알리바이를 증명해 줄 사람은 아무도 없었습니다" }),
      seg("법원은 물증이 아니라 자백에 기대어 사형을 확정했고 재심 청구는 서른 번 넘게 기각되었습니다.", "reveal",
          { kind: "timeline", label: "1955년 4월 6일",
            support: "변호인단이 제출한 감정서는 끝내 증거로 채택되지 않았고 판결문에는 언급조차 없었습니다" }),
      seg("그가 정말 범인이었는지는 지금도 아무도 자신 있게 말하지 못하고 기록만 남아 있습니다.", "tension"),
    ],
  },
];

const grade = deriveGrade("teigin-1948", "역사 속 미스터리");
const inputProps: LongformInputProps = {
  title: "가짜 명함 한 장이 부른 대량 살인",
  thumbTitle: "존재하지 않은\n예방약",
  thumbBadge: "실화 미제사건",
  centralQuestion: "그는 어떻게 모두를 속였을까",
  chapters, grade, bgmSrc: undefined,
};

const jobs: Array<[string, string, number]> = [
  ["LongformDoc", "lf-opener.png", 16],
  ["LongformDoc", "lf-narration.png", 70],
  ["LongformDoc", "lf-question.png", 370],
  ["LongformDoc", "lf-timeline.png", 550],
  ["LongformDoc", "lf-timeline2.png", 670],
  ["LongformDoc", "lf-evidence.png", 920],
  ["LongformDoc", "lf-problem.png", 1020],
  ["LongformDoc", "lf-person.png", 1140],
  ["LongformDoc", "lf-theory.png", 1270],
  ["LongformDoc", "lf-verdict.png", 1390],
  ["LongformDoc", "lf-stress-person.png", 1530],
  ["LongformDoc", "lf-stress-timeline.png", 1650],
  ["LongformDoc", "lf-stress-narration.png", 1780],
  ["LongformThumb", "lf-thumb.png", 0],
];
for (const [id, out, frame] of jobs) {
  const composition = await selectComposition({ serveUrl, id, inputProps });
  const f = Math.min(frame, composition.durationInFrames - 1);
  await renderStill({ composition, serveUrl, output: path.resolve(outDir, out), inputProps, frame: f });
  console.log("STILL:", out, "frame", f, "/", composition.durationInFrames);
}

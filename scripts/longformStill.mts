/**
 * 롱폼 화면 검증용 스틸 렌더 — 자료 카드(타임라인·증거) 레이아웃과
 * 밝은 배경 사진에서의 자막 가독성을 눈으로 확인하는 용도.
 */
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill } from "@remotion/renderer";
import { config } from "../src/config.js";
import { deriveGrade } from "../src/lib/grade.js";
import type { LongformInputProps, NarratedChapter } from "../src/types.js";

const serveUrl = await bundle({
  entryPoint: config.paths.remotionEntry,
  publicDir: config.paths.public,
  webpackOverride: (c) => ({
    ...c,
    resolve: { ...c.resolve, extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".jsx": [".tsx", ".jsx"] } },
  }),
});

// 사용법: tsx scripts/longformStill.mts [출력폴더=scratchpad]
// public/audio/lf-test.mp3 와 public/broll/lf-ch-0..3.jpg 가 있어야 한다.
const outDir = process.argv[2] ?? "scratchpad";

const seg = (text: string, emphasis: NarratedChapter["segments"][0]["emphasis"] = "normal") => ({
  text, emphasis, audioSrc: "audio/lf-test.mp3", durationInSeconds: 3.2,
});

const chapters: NarratedChapter[] = [
  {
    heading: "사건의 시작", visualQuery: "", cardKind: "none", cardItems: [], bgSrc: "broll/lf-ch-0.jpg",
    segments: [seg("2007년, 독일 경찰은 40개 사건에서 같은 DNA 를 찾아냈습니다."), seg("그런데 그 사람은 존재하지 않았습니다.", "reveal")],
  },
  {
    heading: "오늘 확인할 것", visualQuery: "", cardKind: "none", cardItems: [], bgSrc: "broll/lf-ch-1.jpg",
    segments: [seg("이 영상에서 확인할 것은 세 가지입니다."), seg("DNA 는 어디에서 나왔는가.")],
  },
  {
    heading: "사건 일지", visualQuery: "", cardKind: "timeline", bgSrc: "broll/lf-ch-2.jpg",
    cardItems: [
      { label: "1993년", main: "첫 번째 현장에서 미확인 DNA 검출" },
      { label: "2001년", main: "다른 주 절도 현장에서 같은 DNA" },
      { label: "2007년 4월", main: "경찰관 피살 현장에서 재검출" },
      { label: "2009년 3월", main: "면봉 자체의 오염이 확인됨" },
    ],
    segments: [seg("수사는 16년에 걸쳐 이어졌습니다."), seg("사건은 여섯 개 나라로 번졌습니다.", "tension"), seg("그리고 마지막에 밝혀진 것은 전혀 달랐습니다.", "reveal")],
  },
  {
    heading: "증거 검토", visualQuery: "", cardKind: "evidence", bgSrc: "broll/lf-ch-3.jpg",
    cardItems: [
      { label: "면봉", main: "여러 현장에서 동일 DNA 검출", sub: "제조 공장에서 이미 오염돼 있었음" },
      { label: "목격자 진술", main: "여성 용의자를 봤다는 증언", sub: "다른 사건과 뒤섞인 기억으로 판명" },
      { label: "수사 기록", main: "40건이 하나로 묶임", sub: "묶은 근거가 오염된 DNA 하나뿐" },
    ],
    segments: [seg("결정적 증거는 면봉 한 개였습니다."), seg("그 면봉은 이미 오염돼 있었습니다.", "reveal")],
  },
];

const grade = deriveGrade("phantom-heilbronn-2007", "실화 미제사건");
const inputProps: LongformInputProps = {
  title: "DNA가 가리킨 범인은 존재하지 않았다",
  thumbTitle: "존재하지 않은\n범인",
  thumbBadge: "실화 미제사건",
  centralQuestion: "DNA 는 왜 없는 사람을 가리켰나",
  chapters, grade, bgmSrc: undefined,
};

const jobs: Array<[string, string, number]> = [
  ["LongformDoc", "lf-cold-open.png", 40],
  ["LongformDoc", "lf-question.png", 240],
  ["LongformDoc", "lf-timeline.png", 640],
  ["LongformDoc", "lf-evidence.png", 900],
  ["LongformThumb", "lf-thumb.png", 0],
];
for (const [id, out, frame] of jobs) {
  const composition = await selectComposition({ serveUrl, id, inputProps });
  const output = path.resolve(outDir, out);
  await renderStill({ composition, serveUrl, output, inputProps, frame });
  console.log("STILL:", out, "frame", frame, "/", composition.durationInFrames);
}

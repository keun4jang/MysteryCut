/**
 * 롱폼 화면 검증용 표본 데이터.
 *
 * 스틸(longformStill.mts)과 테스트 영상(longformTestVideo.mts)이 같은 데이터를
 * 써야 한다 — 따로 두면 한쪽만 고쳐 놓고 다른 쪽에서 다른 걸 보게 된다.
 * 자료 프레임 7종, 영어 자막, 그리고 프롬프트 상한을 넘긴 '분량 초과' 케이스를
 * 모두 담고 있다.
 */
import type { LongformInputProps, NarratedChapter } from "../src/types.js";
import { deriveGrade } from "../src/lib/grade.js";
import { LONGFORM_OPENER_LEAD, longformBreathSeconds } from "../src/remotion/timing.js";

type Seg = NarratedChapter["segments"][0];
const seg = (
  text: string,
  textEn: string,
  emphasis: Seg["emphasis"] = "normal",
  frame?: Seg["frame"],
): Seg => ({ text, textEn, emphasis, audioSrc: "audio/lf-test.mp3", durationInSeconds: 3.6, frame });

export const chapters: NarratedChapter[] = [
  {
    heading: "독약의 속임수", visualQuery: "", bgSrc: "broll/lf-ch-0.jpg", bgBrightness: 0.78,
    segments: [
      seg("한 남자가 은행 문을 열고 들어왔습니다.", "A man opened the bank door and walked inside."),
      seg("그리고 열두 명이 그 자리에서 쓰러졌습니다.", "Moments later, twelve people collapsed where they stood.", "reveal"),
    ],
  },
  {
    heading: "오늘의 질문", visualQuery: "", bgSrc: "broll/lf-ch-1.jpg", bgBrightness: 0.68,
    segments: [
      seg("이 영상에서 확인할 것은 세 가지입니다.", "There are three things this video sets out to check."),
      seg("그는 어떻게 모두를 속였을까요.", "How did he manage to deceive every one of them?", "normal", { kind: "question", label: "오늘 확인할 것" }),
    ],
  },
  {
    heading: "죽음의 일 분", visualQuery: "", bgSrc: "broll/lf-ch-2.jpg", bgBrightness: 0.86,
    segments: [
      seg("남자는 보건 당국 직원이라고 말했습니다.", "The man said he was an official from the health authority.", "normal",
          { kind: "timeline", label: "1948년 1월 26일", support: "폐점 직전, 은행 안에는 열여섯 명이 있었습니다" }),
      seg("그는 예방약이라며 액체를 나눠 주었습니다.", "He handed out a liquid, calling it a preventive medicine.", "normal",
          { kind: "timeline", label: "오후 3시 30분" }),
      seg("직원 열두 명이 끝내 돌아오지 못했습니다.", "Twelve of the staff never came back.", "reveal",
          { kind: "timeline", label: "1948년 1월 26일 저녁" }),
    ],
  },
  {
    heading: "드러난 모순들", visualQuery: "", bgSrc: "broll/lf-ch-3.jpg", bgBrightness: 0.78,
    segments: [
      seg("찻잔에서 독성 물질이 검출됐습니다.", "A toxic substance was detected in the teacups.", "normal",
          { kind: "evidence", label: "증거 02" }),
      seg("하지만 지문은 하나도 나오지 않았습니다.", "But not a single fingerprint was recovered.", "tension",
          { kind: "problem", label: "남은 문제" }),
      seg("경찰이 지목한 사람은 화가였습니다.", "The man the police named was a painter.", "normal",
          { kind: "person", label: "핵심 인물", support: "체포 당시 예순 살, 사건과의 접점은 명함 한 장" }),
      seg("그는 끝까지 억울함을 주장했습니다.", "He maintained his innocence to the very end.", "normal",
          { kind: "theory", label: "가설 1" }),
      seg("법원은 사형을 확정했습니다.", "The court finalized a death sentence.", "reveal",
          { kind: "verdict", label: "공식 결론" }),
    ],
  },
  // 스트레스 케이스 — 모델이 분량 규칙(본문 30~38자, 보조 30자)을 넘겼을 때도
  // 자막 안전선(y=812)을 못 넘는지 확인한다. line-clamp 가 실제로 먹는지가 핵심.
  {
    heading: "분량 초과 검증", visualQuery: "", bgSrc: "broll/lf-ch-0.jpg", bgBrightness: 0.78,
    segments: [
      seg("경찰은 사건 당일 은행 안에 있었던 사람들의 진술을 하나하나 대조했지만 서로 맞아떨어지는 대목이 거의 없었습니다.", "Police cross-checked the statements of everyone inside the bank that day, but almost nothing lined up between them.", "normal",
          { kind: "person", label: "핵심 인물",
            support: "체포 당시 예순 살, 사건과의 접점은 명함 한 장뿐이었고 알리바이를 증명해 줄 사람은 아무도 없었습니다" }),
      seg("법원은 물증이 아니라 자백에 기대어 사형을 확정했고 재심 청구는 서른 번 넘게 기각되었습니다.", "The court finalized the death sentence on a confession rather than physical evidence, and more than thirty retrial petitions were rejected.", "reveal",
          { kind: "timeline", label: "1955년 4월 6일",
            support: "변호인단이 제출한 감정서는 끝내 증거로 채택되지 않았고 판결문에는 언급조차 없었습니다" }),
      seg("그가 정말 범인이었는지는 지금도 아무도 자신 있게 말하지 못하고 기록만 남아 있습니다.", "No one can say with confidence whether he was truly the culprit; only the records remain.", "tension"),
    ],
  },
];

export const grade = deriveGrade("teigin-1948", "역사 속 미스터리");
export const inputProps: LongformInputProps = {
  title: "가짜 명함 한 장이 부른 대량 살인",
  thumbTitle: "존재하지 않은\n예방약",
  thumbBadge: "실화 미제사건",
  centralQuestion: "그는 어떻게 모두를 속였을까",
  thumbBgSrc: "broll/lf-ch-3.jpg",
  chapters, grade, bgmSrc: undefined,
};



/**
 * (챕터, 컷) → 절대 프레임.
 *
 * 스틸 스크립트가 프레임 번호를 하드코딩하면, 오프너 여백이나 호흡 길이를
 * 바꿀 때마다 엉뚱한 화면을 찍는다(실제로 겪었다 — 겹침 버그를 '스틸을
 * 잘못 골랐다'고 오판한 원인이 이것이었다). 컴포지션과 같은 식으로 계산한다.
 */
export function frameAt(chapter: number, segment: number, offset = 14, fps = 30): number {
  let abs = 0;
  for (let ci = 0; ci < chapters.length; ci++) {
    if (ci === chapter && segment < 0) return abs + offset; // 오프너 창
    let f = abs + LONGFORM_OPENER_LEAD;
    for (let si = 0; si < chapters[ci].segments.length; si++) {
      const seg = chapters[ci].segments[si];
      const len =
        Math.max(1, Math.round(seg.durationInSeconds * fps)) +
        Math.round(longformBreathSeconds(seg.emphasis, si === chapters[ci].segments.length - 1) * fps);
      if (ci === chapter && si === segment) return f + offset;
      f += len;
    }
    abs = f;
  }
  return 0;
}

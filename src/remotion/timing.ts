import type { NarratedSegment, ReelInputProps } from "../types.js";

/**
 * 세그먼트(문장) 사이에 넣는 "숨" 간격(초).
 * 나레이션 mp3 는 앞뒤 무음을 트리밍해서 딱 붙어 있으므로, 사람 호흡처럼
 * 문장 사이에 짧고 일정한 쉼을 준다. 긴장/반전 뒤에는 살짝 더 길게 둬서 리듬을 살린다.
 * (브라우저 번들에서도 쓰이므로 Node 전용 config 를 import 하지 않는다)
 */
export function breathSecondsAfter(emphasis: NarratedSegment["emphasis"]): number {
  if (emphasis === "reveal") return 0.38;
  if (emphasis === "tension") return 0.26;
  return 0.14;
}

export function breathFramesAfter(emphasis: NarratedSegment["emphasis"], fps: number): number {
  return Math.round(breathSecondsAfter(emphasis) * fps);
}

/**
 * 썸네일 카드 프레임 수 — 영상 맨 앞 1프레임(약 0.03초)에만 표시.
 * 재생 시엔 순간 스쳐 지나가지만, 인스타 커버와 유튜브 커스텀 썸네일
 * (thumbnails.set, 첫 프레임 추출)은 이 카드를 쓴다.
 * (유튜브 쇼츠 그리드 세로 썸네일은 유튜브가 자동 선택 — 카드 길이와 무관)
 */
export const THUMB_FRAMES = 1;

/** 세그먼트 재생 길이 + 호흡 + (있다면) 썸네일 카드를 더한 전체 프레임 수 */
export function totalDurationInFrames(
  segments: ReelInputProps["segments"],
  fps: number,
  hasThumb = false,
): number {
  let frames = hasThumb ? THUMB_FRAMES : 0;
  segments.forEach((seg, i) => {
    frames += Math.max(1, Math.round(seg.durationInSeconds * fps));
    if (i < segments.length - 1) frames += breathFramesAfter(seg.emphasis, fps);
  });
  return Math.max(1, frames);
}

/**
 * 롱폼 문장 사이 '숨' (초).
 *
 * 쇼츠보다 확실히 길게 준다. 45세 이상이 87%인 시청자층은 자막을 눈으로 읽고
 * 뜻을 붙잡을 시간이 필요한데, 쇼츠 간격(일반 0.26초)으로 8분을 이어 붙이면
 * 따라오지 못한다. 영상이 조금 길어지더라도 읽는 호흡을 확보하는 쪽이 낫다.
 */
export function longformBreathSeconds(
  emphasis: "normal" | "tension" | "reveal",
  isLastInChapter: boolean,
): number {
  if (isLastInChapter) return 0.75; // 챕터 사이는 한 박자 쉬어 간다
  if (emphasis === "reveal") return 0.62;
  if (emphasis === "tension") return 0.42;
  return 0.28;
}

/**
 * 챕터 맨 앞의 오프너 여백 (프레임).
 *
 * 챕터 번호·제목을 띄우는 동안은 컷 화면을 안 띄운다 — 겹치면 글자가 서로
 * 밟는다. 그런데 나레이션까지 그대로 흐르게 두면 첫 문장의 앞 1초를 자막
 * 없이 듣게 된다. 자막을 읽는 시청자층이라 그 손실이 작지 않다.
 * 그래서 오프너 길이만큼 챕터 앞에 무음 여백을 둔다.
 * 6~7챕터 × 1.67초 ≈ 10~12초 — 7분짜리에서 2.5% 남짓이다. 챕터 전환이 또렷해지는
 * 값으로 충분히 싸다.
 *
 * ★이 값은 LongformDoc 의 OPENER_END, captions.ts 의 자막 타이밍과 함께
 *  움직여야 한다. 한 곳만 고치면 자막이 어긋난다.
 */
export const LONGFORM_OPENER_LEAD = 50;

/**
 * support(보조 문구)는 나레이션이 읽어주지 않는다. 그런데 지금까지 그 문구가
 * 딸린 세그먼트는 main(나레이션 문장)의 **오디오 길이**만큼만 화면에 떠 있었다.
 * 오디오 길이는 main 이 몇 자인지로 정해질 뿐 support 글자 수와는 무관하다.
 * 그래서 main 이 짧은 문장인데 support 가 길면, 시청자가 다 읽기도 전에
 * 화면이 넘어갔다(실측: "폐점 직전, 은행 안에는 열여섯 명이 있었습니다"가
 * 화면에 1초 남짓만 떠 있던 사례).
 *
 * support 는 소리 내어 읽어주는 나레이션이 아니라 **묵독**이라 나레이션
 * 속도(7.08자/초)보다 빠르게 읽을 수 있지만, 등장하자마자 읽기 시작할 수는
 * 없으므로(등장 애니메이션 자체가 SUPPORT_ENTER_FRAME 만큼 걸린다) 그만큼을
 * 먼저 빼 줘야 한다.
 */
const SUPPORT_ENTER_FRAME = 14; // LongformDoc 의 supportEnter 시작 프레임과 맞춘다
/**
 * 실측(2026-08-22, 사용자 시청 확인): 순수 묵독 속도(약 9자/초)로 잡았더니
 * "폐점 직전, 은행 안에는 열여섯 명이 있었습니다"(26자)가 계산상 3.4초를
 * 확보했는데도 실제로는 빨리 지나가는 것처럼 느껴졌다. support 는 **나레이션과
 * 동시에** 읽어야 하는 문구라 청각 정보(스피치)와 시각 정보(묵독)를 동시에
 * 처리해야 하는 분할 주의 상황이고, 65세 이상이 30%인 시청자층에게는 그게
 * 순수 묵독보다 훨씬 느리다. 그래서 확실히 보수적으로 다시 잡는다.
 */
const SUPPORT_CHARS_PER_SEC = 6.5;
const SUPPORT_MIN_SECONDS = 2.4;

function supportHoldFrames(support: string | undefined, fps: number): number {
  if (!support) return 0;
  const readSeconds = Math.max(SUPPORT_MIN_SECONDS, support.length / SUPPORT_CHARS_PER_SEC);
  return SUPPORT_ENTER_FRAME + Math.round(readSeconds * fps);
}

interface LongformSegmentLike {
  durationInSeconds: number;
  emphasis: "normal" | "tension" | "reveal";
  frame?: { support?: string };
}

/**
 * 세그먼트 하나가 화면에 떠 있는 프레임 수 — 오디오 + 호흡, 단 support 를
 * 읽기에 모자라면 그만큼 늘린다.
 *
 * ★LongformDoc.tsx(렌더) / captions.ts(자막) / checkCaptionSync.mts(검증)가
 *  전부 이 함수 하나만 써야 한다. 각자 따로 계산하면 셋 중 하나만 고쳤을 때
 *  자막과 화면이 어긋나는데, 영상에서는 그 어긋남이 눈에 안 띄어서 놓치기 쉽다.
 */
export function longformSegmentFrames(
  seg: LongformSegmentLike,
  isLastInChapter: boolean,
  fps: number,
): number {
  const audioFrames = Math.max(1, Math.round(seg.durationInSeconds * fps));
  const breathFrames = Math.round(longformBreathSeconds(seg.emphasis, isLastInChapter) * fps);
  const base = audioFrames + breathFrames;
  return Math.max(base, supportHoldFrames(seg.frame?.support, fps));
}

/** 롱폼 챕터 하나의 프레임 수 — 오프너 여백 + 세그먼트들 */
export function longformChapterFrames(
  chapter: { segments: LongformSegmentLike[] },
  fps: number,
): number {
  let frames = LONGFORM_OPENER_LEAD;
  chapter.segments.forEach((seg, i) => {
    frames += longformSegmentFrames(seg, i === chapter.segments.length - 1, fps);
  });
  return Math.max(1, frames);
}

/** 롱폼 전체 길이 */
export function longformDurationInFrames(
  chapters: Array<{ segments: LongformSegmentLike[] }>,
  fps: number,
): number {
  return Math.max(1, chapters.reduce((n, c) => n + longformChapterFrames(c, fps), 0));
}

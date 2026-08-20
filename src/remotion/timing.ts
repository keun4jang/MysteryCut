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
 * 8챕터 × 0.93초 ≈ 7.4초 — 7분짜리에서 1.8%다. 챕터 전환이 또렷해지는
 * 값으로 충분히 싸다.
 *
 * ★이 값은 LongformDoc 의 OPENER_END, captions.ts 의 자막 타이밍과 함께
 *  움직여야 한다. 한 곳만 고치면 자막이 어긋난다.
 */
export const LONGFORM_OPENER_LEAD = 28;

/** 롱폼 챕터 하나의 프레임 수 — 오프너 여백 + 세그먼트 오디오 + 문장 사이 호흡 */
export function longformChapterFrames(
  chapter: { segments: Array<{ durationInSeconds: number; emphasis: "normal" | "tension" | "reveal" }> },
  fps: number,
): number {
  let frames = LONGFORM_OPENER_LEAD;
  chapter.segments.forEach((seg, i) => {
    frames += Math.max(1, Math.round(seg.durationInSeconds * fps));
    frames += Math.round(
      longformBreathSeconds(seg.emphasis, i === chapter.segments.length - 1) * fps,
    );
  });
  return Math.max(1, frames);
}

/** 롱폼 전체 길이 */
export function longformDurationInFrames(
  chapters: Array<{ segments: Array<{ durationInSeconds: number; emphasis: "normal" | "tension" | "reveal" }> }>,
  fps: number,
): number {
  return Math.max(1, chapters.reduce((n, c) => n + longformChapterFrames(c, fps), 0));
}

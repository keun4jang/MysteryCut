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
 * 롱폼 챕터 하나의 프레임 수 — 세그먼트 오디오 길이 + 문장 사이 호흡.
 * (롱폼은 귀로만 따라가는 시간이 길어서 쇼츠보다 호흡을 넉넉히 준다)
 */
export function longformChapterFrames(
  chapter: { segments: Array<{ durationInSeconds: number; emphasis: "normal" | "tension" | "reveal" }> },
  fps: number,
): number {
  let frames = 0;
  chapter.segments.forEach((seg, i) => {
    frames += Math.max(1, Math.round(seg.durationInSeconds * fps));
    // 마지막 문장 뒤에도 호흡을 준다 — 챕터 사이가 딱 붙으면 숨 쉴 틈이 없다
    const breath = breathSecondsAfter(seg.emphasis) + (i === chapter.segments.length - 1 ? 0.35 : 0.12);
    frames += Math.round(breath * fps);
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

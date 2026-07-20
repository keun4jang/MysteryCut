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

/** 세그먼트 재생 길이 + 문장 사이 호흡을 모두 더한 전체 프레임 수 (마지막 뒤 호흡은 제외) */
export function totalDurationInFrames(segments: ReelInputProps["segments"], fps: number): number {
  let frames = 0;
  segments.forEach((seg, i) => {
    frames += Math.max(1, Math.round(seg.durationInSeconds * fps));
    if (i < segments.length - 1) frames += breathFramesAfter(seg.emphasis, fps);
  });
  return Math.max(1, frames);
}

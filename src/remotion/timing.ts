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
 * 썸네일 카드 프레임 수 — 영상 맨 앞 1초(30fps 기준 30프레임) 동안 표시.
 * 인스타 커버·유튜브 일반 썸네일은 첫 프레임을 쓰고, 유튜브 쇼츠 그리드의
 * 세로 썸네일은 API 지정이 불가해 유튜브가 영상에서 프레임을 자동 선택한다 —
 * 카드를 1초간 보여주면 선택기가 카드를 집을 확률이 크게 올라가고,
 * 쇼츠 오프닝 타이틀 카드로서 후킹 역할도 한다. (나레이션은 카드 뒤에 시작)
 */
export const THUMB_FRAMES = 30;

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

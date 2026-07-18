import React from "react";
import { Composition } from "remotion";
import { config } from "../config.js";
import type { ReelInputProps } from "../types.js";
import { MysteryReel } from "./MysteryReel.js";

const FPS = config.video.fps;

/** 세그먼트 길이 합으로 전체 프레임 수를 계산 */
function totalDurationInFrames(segments: ReelInputProps["segments"]): number {
  const seconds = segments.reduce((acc, s) => acc + s.durationInSeconds, 0);
  return Math.max(1, Math.round(seconds * FPS));
}

const defaultProps: ReelInputProps = {
  title: "미스터리 예시",
  moodKeywords: ["긴장", "밤", "도시전설"],
  segments: [
    { text: "제보를 받았습니다.", emphasis: "normal", audioSrc: "audio/seg-0.mp3", durationInSeconds: 2.5 },
    { text: "그날 이후, 아무도 그 집에서 나오지 않았습니다.", emphasis: "reveal", audioSrc: "audio/seg-1.mp3", durationInSeconds: 3.5 },
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MysteryReel"
      component={MysteryReel}
      durationInFrames={totalDurationInFrames(defaultProps.segments)}
      fps={FPS}
      width={config.video.width}
      height={config.video.height}
      defaultProps={defaultProps}
      // 렌더 시 넘어온 실제 세그먼트로 길이를 다시 계산
      calculateMetadata={({ props }) => ({
        durationInFrames: totalDurationInFrames(props.segments),
      })}
    />
  );
};

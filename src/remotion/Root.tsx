import React from "react";
import { Composition } from "remotion";
import type { ReelInputProps } from "../types.js";
import { MysteryReel } from "./MysteryReel.js";
import { totalDurationInFrames } from "./timing.js";

// 브라우저에서 번들되므로 Node 전용 config 를 import 하지 않고 상수로 둔다.
const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

const defaultProps: ReelInputProps = {
  title: "미스터리 예시",
  moodKeywords: ["긴장", "밤", "도시전설"],
  segments: [
    {
      text: "제보를 받았습니다.",
      textEn: "We received a tip.",
      emphasis: "normal",
      audioSrc: "audio/seg-0.mp3",
      durationInSeconds: 2.5,
      visualQuery: "dark foggy night",
    },
    {
      text: "그날 이후, 아무도 그 집에서 나오지 않았습니다.",
      textEn: "After that day, no one ever came out of that house.",
      emphasis: "reveal",
      audioSrc: "audio/seg-1.mp3",
      durationInSeconds: 3.5,
      visualQuery: "abandoned house interior",
    },
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MysteryReel"
      component={MysteryReel}
      durationInFrames={totalDurationInFrames(defaultProps.segments, FPS)}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={defaultProps}
      // 렌더 시 넘어온 실제 세그먼트로 길이를 다시 계산
      calculateMetadata={({ props }) => ({
        durationInFrames: totalDurationInFrames(props.segments, FPS),
      })}
    />
  );
};

import React from "react";
import { Composition } from "remotion";
import type { ReelInputProps, LongformInputProps } from "../types.js";
import { MysteryReel } from "./MysteryReel.js";
import { LongformDoc, LongformThumb } from "./LongformDoc.js";
import { totalDurationInFrames, longformDurationInFrames } from "./timing.js";

// 브라우저에서 번들되므로 Node 전용 config 를 import 하지 않고 상수로 둔다.
const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

const defaultProps: ReelInputProps = {
  title: "미스터리 예시",
  thumbTitle: "피가 전부\n사라졌다",
  thumbBadge: "실화 미스터리",
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

// 롱폼 미리보기용 최소 기본값 (실제 렌더는 inputProps 로 덮어씀)
const longformDefaults: LongformInputProps = {
  title: "사건 분석 예시",
  thumbTitle: "존재하지 않은\n범인",
  thumbBadge: "실화 미제사건",
  centralQuestion: "DNA 는 왜 없는 사람을 가리켰나",
  chapters: [
    {
      heading: "사건의 시작",
      visualQuery: "dark archive room",
      cardKind: "none",
      cardItems: [],
      segments: [
        { text: "수사팀은 40개 사건에서 같은 DNA 를 찾아냈습니다.", emphasis: "normal", audioSrc: "audio/seg-0.mp3", durationInSeconds: 3.4 },
      ],
    },
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id="MysteryReel"
      component={MysteryReel}
      durationInFrames={totalDurationInFrames(
        defaultProps.segments,
        FPS,
        Boolean(defaultProps.thumbTitle),
      )}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={defaultProps}
      // 렌더 시 넘어온 실제 세그먼트로 길이를 다시 계산 (썸네일 카드 포함)
      calculateMetadata={({ props }) => ({
        durationInFrames: totalDurationInFrames(props.segments, FPS, Boolean(props.thumbTitle)),
      })}
    />

    {/* 롱폼 사건 분석 다큐 — 가로 1920x1080 */}
    <Composition
      id="LongformDoc"
      component={LongformDoc}
      durationInFrames={longformDurationInFrames(longformDefaults.chapters, FPS)}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={longformDefaults}
      calculateMetadata={({ props }) => ({
        durationInFrames: longformDurationInFrames(props.chapters, FPS),
      })}
    />

    {/* 롱폼 유튜브 커스텀 썸네일 (renderStill 전용) */}
    <Composition
      id="LongformThumb"
      component={LongformThumb}
      durationInFrames={1}
      fps={FPS}
      width={1280}
      height={720}
      defaultProps={longformDefaults}
    />
    </>
  );
};

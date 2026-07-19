import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { NarratedSegment, ReelInputProps } from "../types.js";

const EMPHASIS_COLOR: Record<NarratedSegment["emphasis"], string> = {
  normal: "#ffffff",
  tension: "#ffd7a8",
  reveal: "#ff6b6b",
};

/** 미스터리 릴스 컴포지션: 배경 + 세그먼트별 (오디오 + 자막) */
export const MysteryReel: React.FC<ReelInputProps> = ({ title, segments }) => {
  const { fps } = useVideoConfig();

  let from = 0;
  return (
    <AbsoluteFill>
      <Background />
      {segments.map((seg, i) => {
        const durationInFrames = Math.max(1, Math.round(seg.durationInSeconds * fps));
        const el = (
          <Sequence key={i} from={from} durationInFrames={durationInFrames}>
            <Audio src={staticFile(seg.audioSrc)} />
            <Caption text={seg.text} color={EMPHASIS_COLOR[seg.emphasis]} />
          </Sequence>
        );
        from += durationInFrames;
        return el;
      })}
      <Watermark title={title} />
    </AbsoluteFill>
  );
};

/** 어둡고 은은하게 움직이는 그라디언트 배경 */
const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const shift = interpolate(frame, [0, 300], [0, 40], { extrapolateRight: "extend" });
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% ${30 + shift}%, #1a1030 0%, #0a0a12 60%, #000 100%)`,
      }}
    />
  );
};

/** 중앙 자막 — 등장 시 페이드/업 애니메이션 */
const Caption: React.FC<{ text: string; color: string }> = ({ text, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 12 });
  const y = interpolate(enter, [0, 1], [40, 0]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "0 90px",
      }}
    >
      <div
        style={{
          transform: `translateY(${y}px)`,
          opacity: enter,
          color,
          fontFamily: '"Noto Sans CJK KR", "Noto Sans KR", system-ui, sans-serif',
          fontSize: 72,
          fontWeight: 800,
          lineHeight: 1.35,
          textAlign: "center",
          textShadow: "0 4px 24px rgba(0,0,0,0.9)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

/** 채널 워터마크 */
const Watermark: React.FC<{ title: string }> = ({ title }) => (
  <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: 80 }}>
    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 34, fontWeight: 600 }}>
      @mystery.cut
    </div>
  </AbsoluteFill>
);

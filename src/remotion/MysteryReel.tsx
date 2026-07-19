import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
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
const BGM_VOLUME = 0.14;

/** 미스터리 릴스: 배경 자료화면(켄번즈) + 어두운 오버레이 + 자막 + BGM */
export const MysteryReel: React.FC<ReelInputProps> = ({ segments, bgmSrc }) => {
  const { fps } = useVideoConfig();

  let from = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {segments.map((seg, i) => {
        const durationInFrames = Math.max(1, Math.round(seg.durationInSeconds * fps));
        const el = (
          <Sequence key={i} from={from} durationInFrames={durationInFrames}>
            <SegmentView seg={seg} durationInFrames={durationInFrames} />
          </Sequence>
        );
        from += durationInFrames;
        return el;
      })}

      {bgmSrc ? <Audio src={staticFile(bgmSrc)} volume={BGM_VOLUME} loop /> : null}
      <Watermark />
    </AbsoluteFill>
  );
};

const SegmentView: React.FC<{ seg: NarratedSegment; durationInFrames: number }> = ({
  seg,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 배경 페이드인
  const bgOpacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  // 켄번즈 줌
  const scale = interpolate(frame, [0, durationInFrames], [1.08, 1.2], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      {/* 배경: 스톡 사진(켄번즈) 또는 그라디언트 폴백 */}
      {seg.bgSrc ? (
        <AbsoluteFill style={{ opacity: bgOpacity }}>
          <Img
            src={staticFile(seg.bgSrc)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${scale})`,
            }}
          />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at 50% 40%, #1a1030 0%, #0a0a12 60%, #000 100%)",
          }}
        />
      )}

      {/* 가독성용 어두운 오버레이 (위/아래 진하게) */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 35%, rgba(0,0,0,0.35) 65%, rgba(0,0,0,0.8) 100%)",
        }}
      />

      <Caption text={seg.text} color={EMPHASIS_COLOR[seg.emphasis]} fps={fps} />
    </AbsoluteFill>
  );
};

/** 중앙 자막 — 등장 시 페이드/업 애니메이션 */
const Caption: React.FC<{ text: string; color: string; fps: number }> = ({
  text,
  color,
  fps,
}) => {
  const frame = useCurrentFrame();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 12 });
  const y = interpolate(enter, [0, 1], [40, 0]);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 90px" }}>
      <div
        style={{
          transform: `translateY(${y}px)`,
          opacity: enter,
          color,
          fontFamily: '"Noto Sans CJK KR", "Noto Sans KR", system-ui, sans-serif',
          fontSize: 74,
          fontWeight: 800,
          lineHeight: 1.35,
          textAlign: "center",
          textShadow: "0 3px 18px rgba(0,0,0,0.95), 0 0 40px rgba(0,0,0,0.7)",
          WebkitTextStroke: "1px rgba(0,0,0,0.35)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const Watermark: React.FC = () => (
  <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: 70 }}>
    <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 34, fontWeight: 600 }}>
      @mystery.cut
    </div>
  </AbsoluteFill>
);

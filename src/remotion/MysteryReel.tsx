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
  tension: "#ffd76b",
  reveal: "#ff5a5a",
};
const BGM_VOLUME = 0.14;

/** 미스터리 릴스: 배경 자료화면(켄번즈) + 어두운 오버레이 + 자막 + 나레이션 + BGM */
export const MysteryReel: React.FC<ReelInputProps> = ({ segments, bgmSrc }) => {
  const { fps } = useVideoConfig();

  let from = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {segments.map((seg, i) => {
        const durationInFrames = Math.max(1, Math.round(seg.durationInSeconds * fps));
        const el = (
          <Sequence key={i} from={from} durationInFrames={durationInFrames}>
            {/* 나레이션 (이게 빠져서 무음이었음) */}
            <Audio src={staticFile(seg.audioSrc)} />
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

  const bgOpacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
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

      {/* 가독성용 어두운 오버레이 (하단을 더 진하게) */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 30%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0.92) 100%)",
        }}
      />

      <Caption text={seg.text} color={EMPHASIS_COLOR[seg.emphasis]} fps={fps} />
    </AbsoluteFill>
  );
};

/** 하단 자막 — 반투명 박스 + 큰 굵은 글씨 + 등장 애니메이션 */
const Caption: React.FC<{ text: string; color: string; fps: number }> = ({
  text,
  color,
  fps,
}) => {
  const frame = useCurrentFrame();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 12 });
  const y = interpolate(enter, [0, 1], [50, 0]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        padding: "0 70px 300px",
      }}
    >
      <div
        style={{
          transform: `translateY(${y}px)`,
          opacity: enter,
          maxWidth: "94%",
          padding: "30px 40px",
          borderRadius: 28,
          background: "rgba(8,8,12,0.62)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            color,
            fontFamily: '"Noto Sans CJK KR", "Noto Sans KR", system-ui, sans-serif',
            fontSize: 80,
            fontWeight: 900,
            lineHeight: 1.3,
            letterSpacing: "-0.5px",
            textAlign: "center",
            textShadow: "0 3px 16px rgba(0,0,0,0.9)",
          }}
        >
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Watermark: React.FC = () => (
  <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", padding: 60 }}>
    <div
      style={{
        color: "rgba(255,255,255,0.55)",
        fontSize: 34,
        fontWeight: 700,
        letterSpacing: "1px",
        textShadow: "0 2px 10px rgba(0,0,0,0.8)",
      }}
    >
      @mystery.cut
    </div>
  </AbsoluteFill>
);

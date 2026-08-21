import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import type { ResolvedVisual } from "../types.js";
import { V, V_EASE } from "./visualTokens.js";

const FONT = "Pretendard, -apple-system, BlinkMacSystemFont, sans-serif";
const ease = Easing.bezier(...V_EASE);

/**
 * 수치 비교 화면.
 *
 * 같은 사실을 100px 문장으로 보여주는 것보다 나은 이유: 숫자의 크기 차이를
 * **면적**으로 보여주면 언어 처리를 거치지 않고 바로 읽힌다. '열여섯 명 중
 * 열두 명이 사망했다'를 문장으로 읽으면 비율을 머릿속에서 계산해야 하지만,
 * 막대 두 개는 눈으로 끝난다. 45세 이상 시청자에게 특히 유리하다.
 *
 * 세 가지 모양이 있다.
 *  single     — 수 하나. 크게 박고 아래에 설명 한 줄
 *  pair       — 수 둘 + 막대. **같은 인용에서 나온 두 수일 때만**
 *  pair-nobar — 수 둘, 막대 없음. 인용이 다르거나 단위가 다르면 이쪽.
 *               원문에 없는 비교를 막대로 만들어내지 않기 위한 것이다.
 */
export const VisualQuantity: React.FC<{ visual: ResolvedVisual; accent: string }> = ({
  visual,
  accent,
}) => {
  const frame = useCurrentFrame();
  const fade = (a: number, b: number) =>
    interpolate(frame, [a, b], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    });

  const { mode, claims, title } = visual;
  const vmax = Math.max(...claims.map((c) => c.value), 1);

  return (
    <>
      {title ? (
        <div
          style={{
            position: "absolute",
            left: 120,
            top: 104,
            color: accent,
            fontFamily: FONT,
            fontSize: 60,
            fontWeight: 700,
            letterSpacing: "2px",
            opacity: fade(2, 12),
            textShadow: V.SHADOW,
          }}
        >
          {title}
        </div>
      ) : null}

      {mode === "single" ? (
        <SingleValue claim={claims[0]} accent={accent} fade={fade} />
      ) : (
        claims.map((c, i) => (
          <Row
            key={i}
            claim={c}
            index={i}
            withBar={mode === "pair"}
            ratio={c.value / vmax}
            biggest={c.value === vmax}
            fade={fade}
            accent={accent}
          />
        ))
      )}
    </>
  );
};

/** 수 하나 — 340px 로 크게 박고 아래에 설명 한 줄 */
const SingleValue: React.FC<{
  claim: ResolvedVisual["claims"][0];
  accent: string;
  fade: (a: number, b: number) => number;
}> = ({ claim, accent, fade }) => {
  const frame = useCurrentFrame();
  const color = claim.confidence === "hedged" ? V.HEDGE : V.TEXT;
  const ruleW = interpolate(frame, [14, 26], [0, 240], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 236,
          display: "flex",
          alignItems: "baseline",
          gap: 18,
          opacity: fade(2, 18),
          fontFamily: FONT,
          textShadow: V.SHADOW,
        }}
      >
        {claim.approx ? (
          <span style={{ fontSize: 160, fontWeight: 700, color: V.SUB }}>약</span>
        ) : null}
        <span style={{ fontSize: 340, fontWeight: 800, lineHeight: 1, color }}>{claim.value}</span>
        {claim.unit ? (
          <span style={{ fontSize: 132, fontWeight: 700, color: V.SUB }}>{claim.unit}</span>
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 596,
          width: ruleW,
          height: 8,
          borderRadius: 4,
          background: accent,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 626,
          right: 216,
          color: V.TEXT,
          fontFamily: FONT,
          fontSize: 88,
          fontWeight: 700,
          lineHeight: 1.15,
          whiteSpace: "nowrap",
          opacity: fade(20, 32),
          textShadow: V.SHADOW,
        }}
      >
        {claim.text}
      </div>
    </>
  );
};

/** 수 둘 — 위아래로 나란히. 막대는 같은 인용일 때만 */
const Row: React.FC<{
  claim: ResolvedVisual["claims"][0];
  index: number;
  withBar: boolean;
  ratio: number;
  biggest: boolean;
  accent: string;
  fade: (a: number, b: number) => number;
}> = ({ claim, index, withBar, ratio, biggest, fade }) => {
  const frame = useCurrentFrame();
  const numTop = index === 0 ? 226 : 520;
  const barTop = index === 0 ? 434 : 728;
  const numColor = claim.confidence === "hedged" ? V.HEDGE : biggest ? V.TEXT : V.TEXT_WARN;
  const barW = interpolate(frame, [12, 32], [0, Math.max(24, 1400 * ratio)], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 120,
          top: numTop,
          display: "flex",
          alignItems: "baseline",
          gap: 20,
          opacity: fade(index === 0 ? 2 : 16, index === 0 ? 12 : 26),
          fontFamily: FONT,
          textShadow: V.SHADOW,
        }}
      >
        {claim.approx ? (
          <span style={{ fontSize: 96, fontWeight: 700, color: V.SUB }}>약</span>
        ) : null}
        <span style={{ fontSize: 188, fontWeight: 800, lineHeight: 1, color: numColor }}>
          {claim.value}
        </span>
        {claim.unit ? (
          <span style={{ fontSize: 76, fontWeight: 700, color: V.SUB }}>{claim.unit}</span>
        ) : null}
        <span style={{ fontSize: 72, fontWeight: 600, color: V.SUB, marginLeft: 32 }}>
          {claim.role}
        </span>
      </div>
      {withBar ? (
        <>
          <div
            style={{
              position: "absolute",
              left: 120,
              top: barTop,
              width: 1400,
              height: 30,
              borderRadius: 15,
              background: V.TRACK,
              opacity: fade(8, 16),
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 120,
              top: barTop,
              width: barW,
              height: 30,
              borderRadius: 15,
              background: biggest ? "rgba(244,245,246,0.34)" : V.WARN,
            }}
          />
        </>
      ) : null}
    </>
  );
};

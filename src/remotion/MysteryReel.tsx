import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { NarratedSegment, ReelInputProps, ReelTheme } from "../types.js";
import { breathFramesAfter } from "./timing.js";
import { ensureFonts, FONT_FAMILY } from "./fonts.js";

// 기본 테마 (theme 미지정 시)
const DEFAULT_THEME: ReelTheme = {
  colors: { normal: "#ffffff", tension: "#ffd76b", reveal: "#ff5a5a" },
  boxStyle: "box",
  kenburns: "in",
};
// 어두운 미스터리 배경음(항상 깔리도록) — 폰 스피커에서도 들리는 중음역 포함
const BGM_VOLUME = 0.26;

/** 미스터리 릴스: 배경 자료화면(켄번즈) + 어두운 오버레이 + 자막 + 나레이션 + BGM */
export const MysteryReel: React.FC<ReelInputProps> = ({ segments, bgmSrc, theme }) => {
  const { fps } = useVideoConfig();
  ensureFonts(); // Pretendard 폰트 로드 (렌더 전 대기)
  const t = theme ?? DEFAULT_THEME;

  let from = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {segments.map((seg, i) => {
        const audioFrames = Math.max(1, Math.round(seg.durationInSeconds * fps));
        // '숨' 간격을 세그먼트 길이에 포함시켜 화면을 끊김 없이 이어 붙인다.
        // (예전엔 세그먼트 사이가 비어 매 문장마다 검은 화면이 깜빡였음)
        const breath = i < segments.length - 1 ? breathFramesAfter(seg.emphasis, fps) : 0;
        const segFrames = audioFrames + breath;
        const el = (
          // 페이드 없이 하드컷으로 전환 (배경 페이드인 제거)
          <Sequence key={i} from={from} durationInFrames={segFrames}>
            {/* 나레이션: 오디오는 audioFrames 동안 재생되고, 남는 breath 동안은 자연 무음(호흡) */}
            <Audio src={staticFile(seg.audioSrc)} />
            <SegmentView seg={seg} index={i} durationInFrames={segFrames} theme={t} />
          </Sequence>
        );
        from += segFrames;
        return el;
      })}

      {bgmSrc ? <Audio src={staticFile(bgmSrc)} volume={BGM_VOLUME} loop /> : null}
      <Watermark />
    </AbsoluteFill>
  );
};

const SegmentView: React.FC<{
  seg: NarratedSegment;
  index: number;
  durationInFrames: number;
  theme: ReelTheme;
}> = ({ seg, index, durationInFrames, theme }) => {
  const frame = useCurrentFrame();

  // 켄번즈 방향: 테마에 따라 확대/축소/교차 (페이드 없이 하드컷, 움직임만)
  const zoomIn =
    theme.kenburns === "in" || (theme.kenburns === "mixed" && index % 2 === 0);
  const [s0, s1] = zoomIn ? [1.04, 1.12] : [1.12, 1.04];
  const scale = interpolate(frame, [0, durationInFrames], [s0, s1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      {/* 배경: 스톡 사진(켄번즈) 또는 그라디언트 폴백 */}
      {seg.bgSrc ? (
        <AbsoluteFill>
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

      <Caption
        text={seg.text}
        textEn={seg.textEn}
        color={theme.colors[seg.emphasis]}
        boxStyle={theme.boxStyle}
      />
    </AbsoluteFill>
  );
};

/**
 * 자막 — 화면 중앙 안전 밴드에 배치. 한글(위) + 영어 번역(아래) 이중 자막.
 * 인스타 릴스 UI(하단 캡션/오디오/진행바, 우측 액션 버튼)를 피하려고
 * 하단이 아니라 세로 중앙(약간 아래)로 올리고, 폭을 좁혀 우측 버튼 열도 비운다.
 */
const Caption: React.FC<{
  text: string;
  textEn?: string;
  color: string;
  boxStyle: ReelTheme["boxStyle"];
}> = ({ text, textEn, color, boxStyle }) => {
  // 자막 배경 스타일 3종 (버라이어티 팩이 영상마다 선택)
  const boxCss: React.CSSProperties =
    boxStyle === "minimal"
      ? {
          // 배경 없음 — 강한 그림자만으로 가독성 확보
          maxWidth: "88%",
          padding: "10px 8px",
          filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.95))",
        }
      : boxStyle === "bar"
        ? {
            // 화면 가로를 꽉 채우는 띠
            width: "100%",
            padding: "26px 48px",
            borderRadius: 0,
            background:
              "linear-gradient(90deg, rgba(8,8,12,0) 0%, rgba(8,8,12,0.72) 12%, rgba(8,8,12,0.72) 88%, rgba(8,8,12,0) 100%)",
          }
        : {
            // 기본: 반투명 라운드 박스
            maxWidth: "88%",
            padding: "26px 40px",
            borderRadius: 24,
            background: "rgba(8,8,12,0.6)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 12px 38px rgba(0,0,0,0.55)",
          };

  // 페이드/슬라이드 없이 컷과 동시에 즉시 표시 (등장 애니메이션 제거)
  return (
    <AbsoluteFill
      style={{
        // 세로 중앙(약간 아래로 바이어스)에 배치 → 릴스 상/하단 UI 모두 회피
        justifyContent: "center",
        alignItems: "center",
        padding: boxStyle === "bar" ? 0 : "0 70px",
        transform: "translateY(70px)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          ...boxCss,
        }}
      >
        {/* 한글 자막 (강조색, ExtraBold) */}
        <div
          style={{
            color,
            fontFamily: FONT_FAMILY,
            fontSize: 44,
            fontWeight: 800,
            lineHeight: 1.34,
            letterSpacing: "-1px",
            textAlign: "center",
            textWrap: "balance", // 여러 줄일 때 줄 길이를 고르게(디자인 균형)
            wordBreak: "keep-all", // 한국어를 구절 단위로 줄바꿈
            textShadow: "0 3px 14px rgba(0,0,0,0.92)",
          }}
        >
          {text}
        </div>

        {/* 영어 번역 자막 (아래, 한글과 같은 크기, SemiBold, 은은한 흰색) */}
        {textEn ? (
          <div
            style={{
              width: "100%",
              paddingTop: 16,
              borderTop: "1px solid rgba(255,255,255,0.16)",
              color: "rgba(255,255,255,0.9)",
              fontFamily: FONT_FAMILY,
              fontSize: 44,
              fontWeight: 500,
              lineHeight: 1.34,
              letterSpacing: "-0.5px",
              textAlign: "center",
              textWrap: "balance",
              textShadow: "0 3px 14px rgba(0,0,0,0.92)",
            }}
          >
            {textEn}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** 워터마크 — 좌측 상단 안쪽(인스타 상단 계정바/우상단 아이콘과 겹치지 않게) */
const Watermark: React.FC = () => (
  <AbsoluteFill
    style={{ justifyContent: "flex-start", alignItems: "flex-start", padding: "230px 0 0 52px" }}
  >
    <div
      style={{
        color: "rgba(255,255,255,0.5)",
        fontSize: 30,
        fontWeight: 700,
        letterSpacing: "1px",
        textShadow: "0 2px 10px rgba(0,0,0,0.85)",
      }}
    >
      @mystery.cut
    </div>
  </AbsoluteFill>
);

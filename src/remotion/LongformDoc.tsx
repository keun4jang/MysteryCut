import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { LongformInputProps, NarratedChapter, ReelGrade } from "../types.js";
import { breathFramesAfter, longformChapterFrames } from "./timing.js";
import { ensureFonts, FONT_FAMILY } from "./fonts.js";

/**
 * 롱폼 사건 분석 다큐 (1920x1080).
 *
 * 스톡 사진만 넘기면 10분짜리 슬라이드쇼가 된다. 그래서 화면의 주인공을
 * 사진이 아니라 '자료'로 바꾼다 — 타임라인·인물·증거·가설 카드가 챕터마다
 * 뜨고, 항목이 나레이션에 맞춰 하나씩 나타난다. 사진은 그 뒤의 배경일 뿐이다.
 */

const BGM_VOLUME = 0.2;
const BGM_DIP = 0.1;
const CAPTION_IN = 8;
const easeOut = Easing.bezier(0.22, 1, 0.36, 1);

const CARD_TITLES: Record<string, string> = {
  timeline: "사건 일지",
  persons: "관련 인물",
  evidence: "증거 검토",
  theories: "가설 비교",
};

const DEFAULT_ACCENT = "#7fa8c9";

/** 공백을 무시하고 같은 말인지 — 챕터 라벨과 카드 제목 중복 표시 방지 */
const sameLabel = (a: string, b: string): boolean =>
  a.replace(/\s+/g, "") === b.replace(/\s+/g, "");

export const LongformDoc: React.FC<LongformInputProps> = ({
  chapters,
  bgmSrc,
  grade,
  centralQuestion,
}) => {
  const { fps } = useVideoConfig();
  ensureFonts();

  const lens = chapters.map((c) => longformChapterFrames(c, fps));
  const starts: number[] = [];
  {
    let f = 0;
    for (const l of lens) {
      starts.push(f);
      f += l;
    }
  }

  // 반전 구간에서 BGM 을 낮춘다 (챕터 단위로 계산 — 롱폼은 반전이 여러 번 나온다)
  const dips: Array<[number, number]> = [];
  chapters.forEach((c, ci) => {
    let f = starts[ci];
    c.segments.forEach((s) => {
      const segFrames =
        Math.max(1, Math.round(s.durationInSeconds * fps)) + breathFramesAfter(s.emphasis, fps);
      if (s.emphasis === "reveal") dips.push([f - Math.round(fps * 0.3), f + segFrames + Math.round(fps * 0.8)]);
      f += segFrames;
    });
  });
  const bgmVolume = (f: number): number =>
    dips.some(([a, b]) => f >= a && f < b) ? BGM_DIP : BGM_VOLUME;

  return (
    <AbsoluteFill style={{ backgroundColor: "#07080b" }}>
      {chapters.map((c, i) => (
        <Sequence key={i} from={starts[i]} durationInFrames={lens[i]}>
          <ChapterView
            chapter={c}
            chapterIndex={i}
            totalChapters={chapters.length}
            frames={lens[i]}
            grade={grade}
            centralQuestion={i === 1 ? centralQuestion : undefined}
          />
        </Sequence>
      ))}
      {bgmSrc ? <Audio src={staticFile(bgmSrc)} volume={bgmVolume} loop /> : null}
      <Watermark />
    </AbsoluteFill>
  );
};

const ChapterView: React.FC<{
  chapter: NarratedChapter;
  chapterIndex: number;
  totalChapters: number;
  frames: number;
  grade?: ReelGrade;
  /** 2번째 챕터(오늘의 질문)에서만 화면에 크게 띄운다 */
  centralQuestion?: string;
}> = ({ chapter, chapterIndex, frames, grade, centralQuestion }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accent = grade?.accent ?? DEFAULT_ACCENT;

  // 배경 켄번즈 — 챕터가 길어서 아주 천천히
  const scale = interpolate(frame, [0, frames], chapterIndex % 2 === 0 ? [1.06, 1.14] : [1.14, 1.06], {
    extrapolateRight: "clamp",
  });

  // 세그먼트 타임라인 (자막·오디오)
  const segStarts: number[] = [];
  const segLens: number[] = [];
  {
    let f = 0;
    chapter.segments.forEach((s, i) => {
      const len =
        Math.max(1, Math.round(s.durationInSeconds * fps)) +
        Math.round(
          (breathFramesAfter(s.emphasis, fps) / fps + (i === chapter.segments.length - 1 ? 0.35 : 0.12)) * fps,
        );
      segStarts.push(f);
      segLens.push(len);
      f += len;
    });
  }

  const hasCard = chapter.cardKind !== "none" && chapter.cardItems.length > 0;

  return (
    <AbsoluteFill>
      {/* 배경 사진 */}
      {chapter.bgSrc ? (
        <Img
          src={staticFile(chapter.bgSrc)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale})`,
            // 스톡 사진은 밝은 것이 섞여 나온다(실측: 흰 배경 사진에서 흰 자막이
            // 사실상 안 읽혔다). 다큐 톤과도 맞으므로 배경을 항상 확실히 누른다.
            filter: `${grade?.bgFilter ?? ""} brightness(0.58) saturate(0.85)`.trim(),
          }}
        />
      ) : (
        <AbsoluteFill
          style={{
            background: "radial-gradient(circle at 40% 40%, #1a1f2e 0%, #0b0d14 60%, #06070a 100%)",
          }}
        />
      )}
      {grade ? <AbsoluteFill style={{ background: grade.tintCss }} /> : null}

      {/* 자료 카드가 있을 땐 화면을 더 눌러 카드가 읽히게 한다 */}
      <AbsoluteFill
        style={{
          background: hasCard
            ? "linear-gradient(90deg, rgba(5,6,9,0.72) 0%, rgba(5,6,9,0.52) 45%, rgba(5,6,9,0.86) 100%)"
            : "linear-gradient(180deg, rgba(5,6,9,0.62) 0%, rgba(5,6,9,0.40) 32%, rgba(5,6,9,0.50) 62%, rgba(5,6,9,0.90) 100%)",
        }}
      />

      {grade && grade.grainOpacity > 0 ? (
        <AbsoluteFill
          style={{
            backgroundImage: `url("${grainUri(grade.grainSeed)}")`,
            backgroundRepeat: "repeat",
            mixBlendMode: "soft-light",
            opacity: grade.grainOpacity,
          }}
        />
      ) : null}

      {/* 좌상단 챕터 라벨 */}
      <ChapterLabel heading={chapter.heading} accent={accent} />

      {/* 오늘의 질문 (도입 챕터) */}
      {centralQuestion ? <CentralQuestion text={centralQuestion} accent={accent} /> : null}

      {/* 자료 카드 */}
      {hasCard ? (
        <DataCard
          kind={chapter.cardKind}
          items={chapter.cardItems}
          frames={frames}
          accent={accent}
          heading={chapter.heading}
        />
      ) : null}

      {/* 나레이션 + 자막 */}
      {chapter.segments.map((s, i) => (
        <Sequence key={i} from={segStarts[i]} durationInFrames={segLens[i]}>
          <Audio src={staticFile(s.audioSrc)} />
          <Subtitle text={s.text} emphasis={s.emphasis} accent={accent} shifted={hasCard} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const ChapterLabel: React.FC<{ heading: string; accent: string }> = ({ heading, accent }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 86,
        top: 74,
        display: "flex",
        alignItems: "center",
        gap: 18,
        opacity: enter,
        transform: `translateX(${(1 - enter) * -14}px)`,
      }}
    >
      <div style={{ width: 5, height: 42, background: accent, borderRadius: 3 }} />
      <div
        style={{
          color: "#ffffff",
          fontFamily: FONT_FAMILY,
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: "1px",
          textShadow: "0 2px 12px rgba(0,0,0,0.85)",
        }}
      >
        {heading}
      </div>
    </div>
  );
};

const CentralQuestion: React.FC<{ text: string; accent: string }> = ({ text, accent }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [6, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 140,
        right: 140,
        top: 250,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 16}px)`,
      }}
    >
      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ width: 6, background: accent, borderRadius: 3, flexShrink: 0 }} />
        <div
          style={{
            color: "#ffffff",
            fontFamily: FONT_FAMILY,
            fontSize: 62,
            fontWeight: 800,
            lineHeight: 1.3,
            wordBreak: "keep-all",
            textWrap: "balance",
            textShadow: "0 4px 24px rgba(0,0,0,0.98), 0 2px 8px rgba(0,0,0,0.95)",
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
};

/** 자료 카드 — 항목이 챕터 진행에 맞춰 하나씩 나타난다 */
const DataCard: React.FC<{
  kind: NarratedChapter["cardKind"];
  items: NarratedChapter["cardItems"];
  frames: number;
  accent: string;
  /** 챕터 라벨 — 카드 제목과 같으면 카드 쪽 제목을 숨긴다 */
  heading: string;
}> = ({ kind, items, frames, accent, heading }) => {
  const frame = useCurrentFrame();
  // 마지막 항목까지 챕터의 85% 안에 다 나오게 (끝에서 전체를 훑어볼 시간을 준다)
  const span = frames * 0.85;
  const step = span / Math.max(1, items.length);

  const panelEnter = interpolate(frame, [4, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });

  return (
    <div
      style={{
        position: "absolute",
        right: 84,
        top: 150,
        width: 880,
        maxHeight: 700,
        padding: "30px 34px 34px 38px",
        background: "rgba(10,12,17,0.74)",
        border: "1px solid rgba(255,255,255,0.13)",
        borderLeft: `4px solid ${accent}`,
        borderRadius: 12,
        boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
        opacity: panelEnter,
        transform: `translateX(${(1 - panelEnter) * 20}px)`,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {sameLabel(CARD_TITLES[kind] ?? "", heading) ? null : (
        <div
          style={{
            color: accent,
            fontFamily: FONT_FAMILY,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "5px",
          }}
        >
          {CARD_TITLES[kind] ?? ""}
        </div>
      )}

      {items.map((item, i) => {
        const at = i * step;
        const on = interpolate(frame, [at, at + 12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: easeOut,
        });
        return (
          <div
            key={i}
            style={{
              opacity: on,
              transform: `translateY(${(1 - on) * 10}px)`,
              display: "flex",
              gap: 18,
              alignItems: "flex-start",
            }}
          >
            {/* 좌측 라벨 — 타임라인은 점+선, 나머지는 칩 */}
            {kind === "timeline" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 190 }}>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    background: accent,
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    color: accent,
                    fontFamily: FONT_FAMILY,
                    fontSize: 30,
                    fontWeight: 700,
                  }}
                >
                  {item.label}
                </div>
              </div>
            ) : (
              <div
                style={{
                  minWidth: 176,
                  padding: "6px 14px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.09)",
                  color: accent,
                  fontFamily: FONT_FAMILY,
                  fontSize: 28,
                  fontWeight: 700,
                  textAlign: "center",
                  flexShrink: 0,
                }}
              >
                {item.label}
              </div>
            )}

            <div style={{ flex: 1 }}>
              <div
                style={{
                  color: "rgba(255,255,255,0.96)",
                  fontFamily: FONT_FAMILY,
                  fontSize: 32,
                  fontWeight: 600,
                  lineHeight: 1.34,
                  wordBreak: "keep-all",
                }}
              >
                {item.main}
              </div>
              {item.sub ? (
                <div
                  style={{
                    marginTop: 6,
                    color: "#ff8a7a",
                    fontFamily: FONT_FAMILY,
                    fontSize: 28,
                    fontWeight: 500,
                    lineHeight: 1.32,
                    wordBreak: "keep-all",
                  }}
                >
                  {kind === "theories" ? "설명 안 됨 · " : "그러나 · "}
                  {item.sub}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** 하단 자막 — 한국어만 (65%가 한국 시청자, 가로 화면에서 이중 자막은 산만하다) */
const Subtitle: React.FC<{
  text: string;
  emphasis: "normal" | "tension" | "reveal";
  accent: string;
  /** 자료 카드가 있으면 좌측으로 붙여 카드와 겹치지 않게 */
  shifted: boolean;
}> = ({ text, emphasis, accent, shifted }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [2, 2 + CAPTION_IN], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const color =
    emphasis === "reveal" ? "#ff6b5a" : emphasis === "tension" ? accent : "#ffffff";

  return (
    <div
      style={{
        position: "absolute",
        left: shifted ? 86 : 200,
        right: shifted ? 1030 : 200,
        bottom: shifted ? 120 : 96,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 10}px)`,
      }}
    >
      <div
        style={{
          color,
          fontFamily: FONT_FAMILY,
          fontSize: shifted ? 46 : 54,
          fontWeight: 700,
          lineHeight: 1.36,
          textAlign: shifted ? "left" : "center",
          wordBreak: "keep-all",
          textWrap: "balance",
          textShadow: "0 3px 16px rgba(0,0,0,0.95), 0 1px 4px rgba(0,0,0,0.9)",
        }}
      >
        {text}
      </div>
    </div>
  );
};

const grainUri = (seed: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed}" stitchTiles="stitch"/></filter><rect width="240" height="240" filter="url(#n)"/></svg>`,
  )}`;

const Watermark: React.FC = () => (
  <div
    style={{
      position: "absolute",
      right: 60,
      top: 62,
      color: "rgba(255,255,255,0.42)",
      fontFamily: FONT_FAMILY,
      fontSize: 26,
      fontWeight: 700,
      letterSpacing: "1px",
      textShadow: "0 2px 10px rgba(0,0,0,0.85)",
    }}
  >
    @mystery.cut
  </div>
);

/** 유튜브 커스텀 썸네일용 카드 (1280x720 컴포지션에서 렌더) */
export const LongformThumb: React.FC<LongformInputProps> = ({
  thumbTitle,
  thumbBadge,
  chapters,
  grade,
}) => {
  ensureFonts();
  const accent = grade?.accent ?? DEFAULT_ACCENT;
  const bgSrc = chapters[0]?.bgSrc;
  const lines = (thumbTitle ?? "")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const fontSize = longest <= 6 ? 132 : longest <= 9 ? 108 : longest <= 13 ? 88 : 72;

  return (
    <AbsoluteFill style={{ backgroundColor: "#07080b" }}>
      {bgSrc ? (
        <Img
          src={staticFile(bgSrc)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scale(1.06)",
            filter: `${grade?.bgFilter ?? ""} brightness(0.5) saturate(0.85)`.trim(),
          }}
        />
      ) : (
        <AbsoluteFill
          style={{
            background: "radial-gradient(circle at 40% 40%, #1a1f2e 0%, #0b0d14 60%, #06070a 100%)",
          }}
        />
      )}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(4,5,8,0.90) 0%, rgba(4,5,8,0.66) 52%, rgba(4,5,8,0.30) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 68,
          top: 0,
          bottom: 0,
          width: 760,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 26,
        }}
      >
        <div
          style={{
            alignSelf: "flex-start",
            background: "#c1121f",
            color: "#fff",
            fontFamily: FONT_FAMILY,
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: "2px",
            padding: "9px 24px",
            borderRadius: 8,
          }}
        >
          {thumbBadge?.trim() || "실화 사건 기록"}
        </div>
        <div style={{ display: "flex", gap: 22 }}>
          <div style={{ width: 8, background: accent, borderRadius: 4 }} />
          <div
            style={{
              color: "#fff",
              fontFamily: FONT_FAMILY,
              fontSize,
              fontWeight: 800,
              lineHeight: 1.14,
              letterSpacing: "-1px",
              wordBreak: "keep-all",
              textWrap: "balance",
              textShadow: "0 6px 28px rgba(0,0,0,0.95)",
            }}
          >
            {lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

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
import type {
  LongformFrameKind,
  LongformInputProps,
  NarratedChapter,
  ReelGrade,
} from "../types.js";
import { longformBreathSeconds, longformChapterFrames } from "./timing.js";
import { ensureFonts, FONT_FAMILY } from "./fonts.js";

/**
 * 롱폼 사건 분석 다큐 (1920x1080).
 *
 * ── 설계의 출발점 ──
 * 가로 16:9 영상을 휴대폰 **세로로 들고 인라인 재생**하면 영상 높이가 221pt 로
 * 줄어든다. 배율이 393/1920 = 0.205 이므로 42px 글자는 8.6pt 로 보인다.
 * iOS 기본 본문이 17pt 인데 그 절반이다. 시청자의 87%가 45세 이상인 채널에서
 * 이건 '작다'가 아니라 '못 읽는다'에 가깝다.
 *
 * 그런데 글자만 키우면 한 화면에 항목이 하나도 안 들어간다. 그래서 크기가
 * 아니라 **정보 구조**를 바꿨다.
 *
 *  · 한 화면에 자료 항목은 **하나만**.
 *  · 자막과 자료 본문을 따로 띄우지 않는다 — 자료 화면에서는 지금 말하는
 *    문장 자체가 96px 로 크게 뜨고, 하단 자막은 없다. 시선 중심이 하나다.
 *  · 반박·모순은 같은 화면의 작은 글씨가 아니라 **다음 화면**으로 분리한다.
 *  · 상시 챕터 라벨과 워터마크는 없앴다. 읽을 정보가 아닌데 시선만 끈다.
 *
 * 화면은 두 가지 모드뿐이다.
 *   모드 A(내레이션): 배경 + 하단 자막 84px
 *   모드 B(자료): 분류 56px + 본문 96px + (선택) 보조 72px, 하단 자막 없음
 */

const BGM_VOLUME = 0.2;
const BGM_DIP = 0.1;
const easeOut = Easing.bezier(0.22, 1, 0.36, 1);

const TEXT = "#F4F5F6";
const SUB_TEXT = "rgba(255,255,255,0.84)";
const WARN = "#FF8A7A";
const DEFAULT_ACCENT = "#7fa8c9";

/** 챕터 오프너: 번호+제목을 잠깐 크게 띄우고 사라진다 (상시 라벨 없음) */
/**
 * 유튜브 자막(CC) 안전선 — 화면 아래에서 이만큼은 '의미 있는 글자'를 두지 않는다.
 *
 * 유튜브는 올린 영상마다 자동자막을 만들고, 시청자가 CC 를 켜면 플레이어가
 * 화면 하단 중앙에 검은 상자(#080808, 불투명도 0.7~0.75)를 깔고 그 위에 글자를
 * 그린다. 구워 넣은 자막이 그 자리에 있으면 '지저분해지는' 정도가 아니라 아예
 * 가려진다. 자동자막 생성을 끄는 설정은 유튜브 스튜디오에도 API 에도 없고,
 * 같은 언어의 자막을 우리가 올려도 자동 트랙은 그대로 남는다(실측 확인).
 * 결국 겹침은 화면 배치로만 풀 수 있다.
 *
 * 자막 창의 세로 위치는 컨트롤바 표시 여부에 따라 움직인다. 1080 기준 자막
 * 블록 윗변은 컨트롤이 숨으면 y≈946, 전체화면에서 컨트롤이 뜨면 y≈836 까지
 * 올라온다. 그래서 812 를 경계로 잡는다(= 하단 268px 을 비운다).
 * 시청자가 자막 글자 크기를 400% 로 키운 극단은 대응하지 않는다 — 그 경우까지
 * 피하려면 화면 상단 38% 만 써야 해서 영상이 성립하지 않는다.
 */
const SAFE_BOTTOM = 268;

const OPENER_IN = 8;
const OPENER_HOLD = 26;
const OPENER_OUT = 10;

const grainUri = (seed: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed}" stitchTiles="stitch"/></filter><rect width="240" height="240" filter="url(#n)"/></svg>`,
  )}`;

/** "1948년 1월 26일" → "1948. 01. 26." (방송 자막식) */
function normalizeDateLabel(s: string): string {
  const m = /^(\d{3,4})년\s*(?:(\d{1,2})월)?\s*(?:(\d{1,2})일)?\s*$/.exec(s.trim());
  if (!m) return s;
  const [, y, mo, d] = m;
  const p = (v: string) => v.padStart(2, "0");
  if (mo && d) return `${y}. ${p(mo)}. ${p(d)}.`;
  if (mo) return `${y}. ${p(mo)}.`;
  return y;
}

/** 반박·문제 계열은 라벨을 경고색으로 (빨강을 '상태'에만 쓴다) */
const labelColor = (kind: LongformFrameKind, accent: string) =>
  kind === "problem" ? WARN : accent;

export const LongformDoc: React.FC<LongformInputProps> = ({ chapters, bgmSrc, grade }) => {
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

  const dips: Array<[number, number]> = [];
  chapters.forEach((c, ci) => {
    let f = starts[ci];
    c.segments.forEach((s, i) => {
      const segFrames =
        Math.max(1, Math.round(s.durationInSeconds * fps)) +
        Math.round(longformBreathSeconds(s.emphasis, i === c.segments.length - 1) * fps);
      if (s.emphasis === "reveal") {
        dips.push([f - Math.round(fps * 0.3), f + segFrames + Math.round(fps * 0.8)]);
      }
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
            chapterNumber={i + 1}
            frames={lens[i]}
            grade={grade}
            showWatermark={i === 0}
          />
        </Sequence>
      ))}
      {bgmSrc ? <Audio src={staticFile(bgmSrc)} volume={bgmVolume} loop /> : null}
    </AbsoluteFill>
  );
};

const ChapterView: React.FC<{
  chapter: NarratedChapter;
  chapterNumber: number;
  frames: number;
  grade?: ReelGrade;
  showWatermark: boolean;
}> = ({ chapter, chapterNumber, frames, grade, showWatermark }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accent = grade?.accent ?? DEFAULT_ACCENT;

  // ── 세그먼트 타임라인 ──
  const segStarts: number[] = [];
  const segLens: number[] = [];
  {
    let f = 0;
    chapter.segments.forEach((s, i) => {
      const len =
        Math.max(1, Math.round(s.durationInSeconds * fps)) +
        Math.round(longformBreathSeconds(s.emphasis, i === chapter.segments.length - 1) * fps);
      segStarts.push(f);
      segLens.push(len);
      f += len;
    });
  }

  // 타임라인 진행 점 — 이 챕터의 timeline 프레임이 몇 번째인지
  const timelineIdx = new Map<number, number>();
  let tCount = 0;
  chapter.segments.forEach((s, i) => {
    if (s.frame?.kind === "timeline") timelineIdx.set(i, tCount++);
  });

  const bright = chapter.bgBrightness ?? 0.78;
  const kenburns = interpolate(
    frame,
    [0, frames],
    chapterNumber % 2 === 0 ? [1.11, 1.04] : [1.04, 1.11],
    { extrapolateRight: "clamp" },
  );
  const settle = interpolate(frame, [0, 12], [1.016, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });

  return (
    <AbsoluteFill>
      {chapter.bgSrc ? (
        <Img
          src={staticFile(chapter.bgSrc)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${kenburns * settle})`,
            filter: `${grade?.bgFilter ?? ""} brightness(${bright}) saturate(0.88)`.trim(),
          }}
        />
      ) : (
        <AbsoluteFill
          style={{
            background: "radial-gradient(circle at 42% 42%, #1a1f2e 0%, #0b0d14 62%, #06070a 100%)",
          }}
        />
      )}
      {grade ? <AbsoluteFill style={{ background: grade.tintCss }} /> : null}

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

      <ChapterOpener number={chapterNumber} heading={chapter.heading} accent={accent} />
      {showWatermark ? <Watermark /> : null}

      {chapter.segments.map((s, i) => (
        <Sequence key={i} from={segStarts[i]} durationInFrames={segLens[i]}>
          <Audio src={staticFile(s.audioSrc)} />
          {s.frame ? (
            <DataFrame
              kind={s.frame.kind}
              label={s.frame.label}
              main={s.text}
              support={s.frame.support}
              accent={accent}
              emphasis={s.emphasis}
              timelinePos={timelineIdx.get(i)}
              timelineTotal={tCount}
            />
          ) : (
            <NarrationSubtitle text={s.text} emphasis={s.emphasis} accent={accent} />
          )}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

/**
 * 챕터 오프너 — 번호와 제목을 0.8초쯤 크게 띄우고 사라진다.
 * 상시 라벨로 계속 띄우면 시청자가 "핵심 증거와 모순"이라는 말을 8분 내내
 * 봐야 하고, 시선 중심만 하나 더 늘어난다.
 */
const ChapterOpener: React.FC<{ number: number; heading: string; accent: string }> = ({
  number,
  heading,
  accent,
}) => {
  const frame = useCurrentFrame();
  const inAmt = interpolate(frame, [2, 2 + OPENER_IN], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const outAmt = interpolate(
    frame,
    [2 + OPENER_IN + OPENER_HOLD, 2 + OPENER_IN + OPENER_HOLD + OPENER_OUT],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const vis = inAmt * outAmt;
  if (vis <= 0.002) return null;
  const lineW = interpolate(frame, [4, 18], [0, 300], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });

  return (
    <>
      <AbsoluteFill style={{ background: "rgba(5,7,10,0.52)", opacity: vis }} />
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 360,
          opacity: vis,
          transform: `translateX(${(1 - inAmt) * -14}px)`,
        }}
      >
        <div style={{ height: 6, width: lineW, background: accent, borderRadius: 3, marginBottom: 30 }} />
        <div
          style={{
            color: accent,
            fontFamily: FONT_FAMILY,
            fontSize: 112,
            fontWeight: 800,
            lineHeight: 1,
          }}
        >
          {String(number).padStart(2, "0")}
        </div>
        <div
          style={{
            marginTop: 18,
            color: TEXT,
            fontFamily: FONT_FAMILY,
            fontSize: 88,
            fontWeight: 800,
            lineHeight: 1.18,
            wordBreak: "keep-all",
            textShadow: "0 4px 20px rgba(0,0,0,0.92)",
          }}
        >
          {heading}
        </div>
      </div>
    </>
  );
};

/**
 * 자료 프레임 — 화면 전체를 쓰는 한 장짜리 기록판.
 * 여기서는 **하단 자막을 띄우지 않는다.** main 이 곧 지금 말하는 문장이다.
 */
const DataFrame: React.FC<{
  kind: LongformFrameKind;
  label: string;
  main: string;
  support?: string;
  accent: string;
  emphasis: "normal" | "tension" | "reveal";
  timelinePos?: number;
  timelineTotal: number;
}> = ({ kind, label, main, support, accent, emphasis, timelinePos, timelineTotal }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [2, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const supportEnter = interpolate(frame, [14, 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const isTimeline = kind === "timeline";
  const isQuestion = kind === "question";
  const lc = labelColor(kind, accent);
  const shown = isTimeline ? normalizeDateLabel(label) : label;
  const textLeft = isTimeline ? 232 : 120;

  return (
    <>
      {/* 글자가 놓인 자리만 눌러 배경 사진은 형태를 남긴다 */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(5,7,10,0.52) 0%, rgba(5,7,10,0.74) 22%, rgba(5,7,10,0.74) 74%, rgba(5,7,10,0.58) 100%)",
        }}
      />

      {/* 증거는 큰 번호를 배경 장식으로 (읽지 못해도 되는 요소).
          본문(top 262~)과 겹치면 96px 문장이 읽히지 않으므로 아래쪽 빈 영역에 둔다. */}
      {kind === "evidence" ? (
        <div
          style={{
            position: "absolute",
            right: 110,
            bottom: 20,
            color: "#ffffff",
            opacity: 0.11 * enter,
            fontFamily: FONT_FAMILY,
            fontSize: 300,
            fontWeight: 800,
            lineHeight: 1,
          }}
        >
          {(label.match(/\d+/)?.[0] ?? "").padStart(2, "0")}
        </div>
      ) : null}

      {/* 타임라인은 날짜를 크게 세우고 세로선으로 흐름을 만든다 */}
      {isTimeline ? (
        <>
          <div
            style={{
              position: "absolute",
              left: 120,
              top: 140,
              color: lc,
              fontFamily: FONT_FAMILY,
              fontSize: 84,
              fontWeight: 800,
              lineHeight: 1.1,
              opacity: enter,
              transform: `translateY(${(1 - enter) * 10}px)`,
              textShadow: "0 3px 16px rgba(0,0,0,0.9)",
            }}
          >
            {shown}
          </div>
          <div
            style={{
              position: "absolute",
              left: 128,
              top: 268,
              width: 5,
              height: interpolate(frame, [6, 20], [0, 440], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: easeOut,
              }),
              background: `linear-gradient(180deg, ${lc} 0%, rgba(255,255,255,0.12) 100%)`,
              borderRadius: 3,
            }}
          />
        </>
      ) : (
        <div
          style={{
            position: "absolute",
            left: 120,
            top: 140,
            color: lc,
            fontFamily: FONT_FAMILY,
            fontSize: 56,
            fontWeight: 700,
            letterSpacing: "2px",
            opacity: enter,
            transform: `translateY(${(1 - enter) * 10}px)`,
            textShadow: "0 3px 14px rgba(0,0,0,0.9)",
          }}
        >
          {shown}
        </div>
      )}

      {/* 본문 = 지금 말하는 문장 */}
      <div
        style={{
          position: "absolute",
          left: textLeft,
          right: 120,
          top: isTimeline ? 268 : 240,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 12}px)`,
        }}
      >
        <div
          style={{
            color: emphasis === "reveal" ? "#FFD9D2" : TEXT,
            fontFamily: FONT_FAMILY,
            fontSize: isQuestion ? 104 : 96,
            fontWeight: 800,
            lineHeight: 1.16,
            wordBreak: "keep-all",
            textWrap: "balance",
            textShadow: "0 4px 20px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.9)",
            // 문장이 길어져 줄이 늘면 아래 보조 문구를 덮는다 — 3줄에서 끊는다
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 3,
            overflow: "hidden",
          }}
        >
          {main}
        </div>
      </div>

      {support ? (
        <div
          style={{
            position: "absolute",
            left: textLeft,
            right: 160,
            top: isTimeline ? 628 : 600,
            opacity: supportEnter,
            transform: `translateY(${(1 - supportEnter) * 10}px)`,
            color: SUB_TEXT,
            fontFamily: FONT_FAMILY,
            fontSize: 72,
            fontWeight: 600,
            lineHeight: 1.22,
            wordBreak: "keep-all",
            textWrap: "balance",
            textShadow: "0 3px 16px rgba(0,0,0,0.92)",
            // 2줄을 넘기면 유튜브 자막 안전선(y=812)을 침범한다
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
          }}
        >
          {support}
        </div>
      ) : null}

      {/* 타임라인 진행 점 — 읽는 정보가 아니라 위치 감각만 준다 */}
      {isTimeline && timelineTotal > 1 ? (
        <div style={{ position: "absolute", left: 120, bottom: 96, display: "flex", gap: 22 }}>
          {Array.from({ length: timelineTotal }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background:
                  i === timelinePos
                    ? accent
                    : i < (timelinePos ?? 0)
                      ? "rgba(255,255,255,0.35)"
                      : "rgba(255,255,255,0.12)",
              }}
            />
          ))}
        </div>
      ) : null}
    </>
  );
};

/**
 * 내레이션 화면 — 배경 위에 하단 자막만.
 * 화면에서 의미를 갖는 텍스트 블록은 이것 하나뿐이다.
 */
const NarrationSubtitle: React.FC<{
  text: string;
  emphasis: "normal" | "tension" | "reveal";
  accent: string;
}> = ({ text, emphasis, accent }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [1, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const bar = emphasis === "reveal" ? "#FF6B5A" : accent;

  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        right: 120,
        bottom: SAFE_BOTTOM,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 8}px)`,
        padding: "22px 36px 26px 40px",
        borderLeft: `10px solid ${bar}`, // 폰 인라인(852px)에서도 강조바가 보이도록
        borderRadius: 6,
        background:
          "linear-gradient(90deg, rgba(5,7,10,0.92) 0%, rgba(5,7,10,0.86) 62%, rgba(5,7,10,0.78) 100%)",
      }}
    >
      <div
        style={{
          color: TEXT,
          fontFamily: FONT_FAMILY,
          fontSize: 84,
          fontWeight: 800,
          lineHeight: 1.22,
          textAlign: "left",
          wordBreak: "keep-all",
          textWrap: "balance",
          textShadow: "0 3px 14px rgba(0,0,0,0.9)",
        }}
      >
        {text}
      </div>
    </div>
  );
};

/** 워터마크는 첫 챕터에서 잠깐만 — 상시 표시는 시선만 뺏는다 */
const Watermark: React.FC = () => {
  const frame = useCurrentFrame();
  const vis = interpolate(frame, [60, 75, 165, 180], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (vis <= 0.002) return null;
  return (
    <div
      style={{
        position: "absolute",
        right: 120,
        // 유튜브 상단 정보바(제목·채널)가 컨트롤 표시 때 여기까지 내려온다
        top: 150,
        opacity: 0.34 * vis,
        color: "#ffffff",
        fontFamily: FONT_FAMILY,
        fontSize: 28,
        fontWeight: 700,
        letterSpacing: "1px",
        textShadow: "0 2px 10px rgba(0,0,0,0.85)",
      }}
    >
      @mystery.cut
    </div>
  );
};

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

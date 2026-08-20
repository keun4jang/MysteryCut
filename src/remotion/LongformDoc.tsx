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
import { LONGFORM_OPENER_LEAD, longformBreathSeconds, longformChapterFrames } from "./timing.js";
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
// 영어 자막 — 한국어보다 확실히 뒤로 물러나게. 읽고 싶은 사람만 읽으면 된다.
const EN_TEXT = "rgba(255,255,255,0.60)";
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

const OPENER_IN = 6;
const OPENER_HOLD = 14;
const OPENER_OUT = 6;
/**
 * 오프너가 사라지고 첫 컷 화면이 들어오는 프레임.
 *
 * 오프너를 첫 컷 위에 겹쳐 그리면 글자가 서로 밟는다(실측: 챕터 번호·제목이
 * 자막 패널을 뚫고 나옴). 자료 프레임 모드에서는 화면 위아래가 이미 다 차 있어
 * 오프너가 비집고 들어갈 빈 자리가 없다.
 * 그래서 오프너가 떠 있는 0.93초 동안은 컷 화면을 아예 띄우지 않는다.
 * 나레이션 오디오는 그대로 흐르므로 영상이 길어지지도 않는다.
 */
const OPENER_END = 2 + OPENER_IN + OPENER_HOLD + OPENER_OUT; // = LONGFORM_OPENER_LEAD

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
    let f = starts[ci] + LONGFORM_OPENER_LEAD;
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
    // 오프너 여백만큼 뒤로 밀어 시작 — 오디오도 같이 밀려 자막과 어긋나지 않는다
    let f = LONGFORM_OPENER_LEAD;
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

  const contentIn = interpolate(frame, [OPENER_END - 6, OPENER_END + 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
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

      {/* 오프너가 걷힌 뒤에 컷 화면이 들어온다 (오디오는 opacity 와 무관하게 계속 흐른다) */}
      <AbsoluteFill style={{ opacity: contentIn }}>
        {chapter.segments.map((s, i) => (
          <Sequence key={i} from={segStarts[i]} durationInFrames={segLens[i]}>
            <Audio src={staticFile(s.audioSrc)} />
            {s.frame ? (
              <DataFrame
                kind={s.frame.kind}
                label={s.frame.label}
                main={s.text}
                mainEn={s.textEn}
                support={s.frame.support}
                accent={accent}
                emphasis={s.emphasis}
                timelinePos={timelineIdx.get(i)}
                timelineTotal={tCount}
              />
            ) : (
              <NarrationSubtitle text={s.text} textEn={s.textEn} emphasis={s.emphasis} accent={accent} />
            )}
          </Sequence>
        ))}
      </AbsoluteFill>
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
  mainEn?: string;
  support?: string;
  accent: string;
  emphasis: "normal" | "tension" | "reveal";
  timelinePos?: number;
  timelineTotal: number;
}> = ({ kind, label, main, mainEn, support, accent, emphasis, timelinePos, timelineTotal }) => {
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
              top: 96,
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
              top: 204,
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
            top: 100,
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

      {/*
        본문 + 보조 문구는 한 흐름에 쌓는다.

        보조 문구를 고정 위치(top: 600)에 두면 본문이 2줄일 땐 사이가 138px 로
        벌어지고 3줄일 땐 25px 로 붙어 다섯 줄이 한 덩어리로 읽힌다. 문장 길이는
        회차마다 다르니 고정값으로는 두 경우를 다 만족시킬 수 없다.
        흐름으로 쌓으면 간격이 항상 GAP 으로 일정하고, 가장 긴 경우(본문 3줄 +
        보조 2줄 = y 200~753)에도 자막 안전선(812) 안에 들어온다.
      */}
      <div
        style={{
          position: "absolute",
          left: textLeft,
          right: 120,
          top: isTimeline ? 204 : 190,
        }}
      >
        <div
          style={{
            color: emphasis === "reveal" ? "#FFD9D2" : TEXT,
            fontFamily: FONT_FAMILY,
            fontSize: isQuestion ? 104 : 96,
            fontWeight: 800,
            lineHeight: 1.14,
            wordBreak: "keep-all",
            textWrap: "balance",
            textShadow: "0 4px 20px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.9)",
            opacity: enter,
            transform: `translateY(${(1 - enter) * 12}px)`,
            // 안전장치 — 프롬프트 상한(40자)을 크게 넘긴 문장이 와도 안전선을 못 넘게
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 3,
            overflow: "hidden",
          }}
        >
          {main}
        </div>

        {mainEn ? (
          <div
            style={{
              marginTop: 10,
              marginRight: 40,
              opacity: enter,
              transform: `translateY(${(1 - enter) * 8}px)`,
              color: EN_TEXT,
              fontFamily: FONT_FAMILY,
              fontSize: 40,
              fontWeight: 500,
              lineHeight: 1.3,
              textShadow: "0 2px 12px rgba(0,0,0,0.9)",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
            }}
          >
            {mainEn}
          </div>
        ) : null}

        {support ? (
          <div
            style={{
              marginTop: 24,
              marginRight: 40,
              opacity: supportEnter,
              transform: `translateY(${(1 - supportEnter) * 10}px)`,
              color: SUB_TEXT,
              fontFamily: FONT_FAMILY,
              fontSize: 58,
              fontWeight: 600,
              lineHeight: 1.2,
              wordBreak: "keep-all",
              textWrap: "balance",
              textShadow: "0 3px 16px rgba(0,0,0,0.92)",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
            }}
          >
            {support}
          </div>
        ) : null}
      </div>

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
  textEn?: string;
  emphasis: "normal" | "tension" | "reveal";
  accent: string;
}> = ({ text, textEn, emphasis, accent }) => {
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
      {textEn ? (
        <div
          style={{
            marginTop: 10,
            color: EN_TEXT,
            fontFamily: FONT_FAMILY,
            fontSize: 38,
            fontWeight: 500,
            lineHeight: 1.3,
            textAlign: "left",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
          }}
        >
          {textEn}
        </div>
      ) : null}
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

/**
 * 유튜브 커스텀 썸네일 (1280x720).
 *
 * 설계 기준은 1280px 이 아니라 **360px** 이다 — 시청자가 실제로 보는 크기가
 * 피드의 360×202 라서, 크게 놓고 예쁜 것보다 작게 줄였을 때 한눈에 읽히는
 * 쪽이 이긴다. 4개 안을 360px 로 놓고 비교해 정했다.
 *
 * 45세 이상이 87%인 시청자층에 맞춘 선택:
 * - 노랑(#FFE14D) 본문 + 두꺼운 검정 외곽선 — 어두운 배경에서 대비가 가장 크고,
 *   사진 밝기가 어떻든 글자가 항상 이긴다(스톡 사진은 밝기를 고를 수 없다).
 * - 마지막 줄은 빨간 박스에 흰 글자 — 시선이 꽂히는 지점을 하나만 만든다.
 * - 사진은 오른쪽에 흐리게 남겨 분위기만 담당한다. 주인공은 글자다.
 *
 * 자극적이되 낚시는 아니다 — 문구는 대본이 실제로 다루는 내용이어야 한다.
 * 유튜브는 '오해를 부르는 메타데이터'를 수익창출 감점 사유로 든다.
 */
/** 문자열의 대략적인 폭(em) — 한글 전각 1.0, 라틴·숫자 0.55, 공백 0.3 */
function textEm(line: string): number {
  return [...line].reduce(
    (w, ch) => w + (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/.test(ch) ? 1 : ch === " " ? 0.3 : 0.55),
    0,
  );
}

const THUMB_YELLOW = "#FFE14D";
const THUMB_RED = "#E01020";
/** 빨간 박스로 강조할 수 있는 마지막 줄 길이 상한 — 넘으면 박스가 화면을 덮는다 */
const THUMB_BOX_MAX = 6;

export const LongformThumb: React.FC<LongformInputProps> = ({
  thumbTitle,
  thumbBadge,
  chapters,
  thumbBgSrc,
  grade,
}) => {
  ensureFonts();
  // 썸네일 전용 사진이 있으면 그것, 없으면 1챕터 배경으로 폴백
  const bgSrc = thumbBgSrc ?? chapters[0]?.bgSrc;
  const lines = (thumbTitle ?? "")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // 글자 수만 세면 크기가 안 맞는다 — 한글은 전각(1em)이고 숫자·라틴은 그 절반쯤,
  // 공백은 더 좁다. '37년 만에'와 '존재하지만'은 둘 다 5자지만 폭이 다르다.
  // 실제 폭을 em 으로 어림해 상자에 맞춰야 넘치지도 비지도 않는다.
  const widest = Math.max(...lines.map(textEm), 0.1);
  // 좌우 여백 64 + 빨간 박스 안쪽 여백까지 빼고 남는 폭
  const boxWidth = 1280 - 64 * 2 - 56;
  const fontSize = Math.round(Math.min(196, Math.max(104, boxWidth / widest)));
  const stroke = Math.round(fontSize * 0.085);
  const last = lines.length - 1;
  // 마지막 줄이 짧을 때만 빨간 박스 — 길면 박스가 화면을 덮어 오히려 안 읽힌다
  const boxed = lines.length > 1 && lines[last].length <= THUMB_BOX_MAX;

  const strokeCss = { WebkitTextStroke: `${stroke}px #000`, paintOrder: "stroke fill" } as const;

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
            filter: `${grade?.bgFilter ?? ""} brightness(0.6) saturate(0.82)`.trim(),
          }}
        />
      ) : (
        <AbsoluteFill
          style={{
            background: "radial-gradient(circle at 40% 40%, #1a1f2e 0%, #0b0d14 60%, #06070a 100%)",
          }}
        />
      )}
      {/* 글자가 놓이는 왼쪽을 눌러 노란 글자가 항상 이기게 한다 */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(4,5,8,0.88) 0%, rgba(4,5,8,0.72) 60%, rgba(4,5,8,0.30) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          top: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          gap: 22,
        }}
      >
        <div
          style={{
            background: THUMB_RED,
            color: "#fff",
            fontFamily: FONT_FAMILY,
            fontSize: 44,
            fontWeight: 800,
            letterSpacing: "3px",
            padding: "11px 28px",
          }}
        >
          {thumbBadge?.trim() || "실화 사건 기록"}
        </div>

        {lines.map((l, i) =>
          boxed && i === last ? (
            <div key={i} style={{ background: THUMB_RED, padding: `6px 28px ${Math.round(fontSize * 0.09)}px` }}>
              <span
                style={{
                  ...strokeCss,
                  color: "#fff",
                  fontFamily: FONT_FAMILY,
                  fontSize,
                  fontWeight: 800,
                  lineHeight: 1,
                  letterSpacing: "-5px",
                }}
              >
                {l}
              </span>
            </div>
          ) : (
            <div
              key={i}
              style={{
                ...strokeCss,
                color: i === last && lines.length > 1 ? "#fff" : THUMB_YELLOW,
                fontFamily: FONT_FAMILY,
                fontSize,
                fontWeight: 800,
                lineHeight: 1.0,
                letterSpacing: "-5px",
                wordBreak: "keep-all",
              }}
            >
              {l}
            </div>
          ),
        )}
      </div>
    </AbsoluteFill>
  );
};

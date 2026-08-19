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
import { longformBreathSeconds, longformChapterFrames } from "./timing.js";
import { ensureFonts, FONT_FAMILY } from "./fonts.js";

/**
 * 롱폼 사건 분석 다큐 (1920x1080).
 *
 * 설계 원칙: **한 화면에 적게, 크게, 지금 말하는 정보만 선명하게.**
 *
 * 시청자의 87%가 45세 이상이고, 롱폼은 상당수가 휴대폰으로 소비된다. 가로
 * 16:9 를 세로로 든 폰에서 보면 화면이 작게 표시되므로, 자료 카드에 항목을
 * 6~9개씩 쌓아두면 아무도 못 읽는다. 그래서
 *  - 자료는 한 페이지 2~4개로 끊어 페이지를 교체하고(스크롤 금지)
 *  - 지금 나레이션이 말하는 항목만 선명하게, 지난 항목은 흐리게, 아직 안 나온
 *    항목은 아주 흐리게 둬서 레이아웃이 흔들리지 않게 하고
 *  - 자막은 카드 유무와 무관하게 화면 하단 같은 자리에 고정한다(자막 시작점이
 *    챕터마다 좌우로 움직이면 매번 눈으로 다시 찾아야 한다).
 *
 * 자료 종류에 따라 화면 구조 자체를 바꾼다(좌우 분할 / 전체 폭 보드 / 2열 비교).
 * 모든 챕터를 같은 카드 하나로 처리하면 결국 템플릿 반복으로 보이기 때문이다.
 */

const BGM_VOLUME = 0.2;
const BGM_DIP = 0.1;
const easeOut = Easing.bezier(0.22, 1, 0.36, 1);

const DEFAULT_ACCENT = "#7fa8c9";
const TEXT = "#F4F5F6"; // 본문은 항상 이 색 — 문장 전체를 색칠하지 않는다
const SUB_TEXT = "rgba(255,255,255,0.82)";
const WARN = "#FF8A7A";

/** 챕터 시작 범퍼 길이(프레임). 0.7초 — 전체 화면 챕터 카드는 흐름을 끊는다 */
const BUMP = 21;

const CARD_TITLES: Record<string, string> = {
  timeline: "사건 일지",
  persons: "관련 인물",
  evidence: "증거 검토",
  theories: "가설 비교",
};

/** 한 페이지에 올릴 항목 수 — 글자를 키운 만큼 적게 */
const PER_PAGE: Record<string, number> = {
  timeline: 4,
  persons: 3,
  evidence: 3,
  theories: 2,
  none: 1,
};

/** 공백 무시 비교 — 챕터 라벨과 카드 제목 중복 표시 방지 */
const sameLabel = (a: string, b: string): boolean =>
  a.replace(/\s+/g, "") === b.replace(/\s+/g, "");

/** "2007년 4월 17일" → "2007. 04. 17." (방송 자막식 표기) */
function normalizeDateLabel(s: string): string {
  const m = /^(\d{3,4})년\s*(?:(\d{1,2})월)?\s*(?:(\d{1,2})일)?\s*$/.exec(s.trim());
  if (!m) return s;
  const [, y, mo, d] = m;
  const p = (v: string) => v.padStart(2, "0");
  if (mo && d) return `${y}. ${p(mo)}. ${p(d)}.`;
  if (mo) return `${y}. ${p(mo)}.`;
  return y;
}

const grainUri = (seed: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed}" stitchTiles="stitch"/></filter><rect width="240" height="240" filter="url(#n)"/></svg>`,
  )}`;

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

  // 반전 구간 BGM 딥
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
  chapterNumber: number;
  frames: number;
  grade?: ReelGrade;
  centralQuestion?: string;
}> = ({ chapter, chapterNumber, frames, grade, centralQuestion }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accent = grade?.accent ?? DEFAULT_ACCENT;
  const kind = chapter.cardKind;
  const items = chapter.cardItems ?? [];
  const hasCard = kind !== "none" && items.length > 0;

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

  // ── 항목을 나레이션에 동기화 ──
  // 챕터 길이에 균등 배분하면 "지금 말하는 내용"과 화면이 어긋난다.
  // 항목 i 는 (i × 세그먼트수 / 항목수) 번째 문장이 시작될 때 켜진다.
  const segCount = Math.max(1, chapter.segments.length);
  const itemStartFrame = items.map((_, i) =>
    segStarts[Math.min(segCount - 1, Math.floor((i * segCount) / Math.max(1, items.length)))] ?? 0,
  );
  let activeIndex = 0;
  for (let i = 0; i < itemStartFrame.length; i++) if (frame >= itemStartFrame[i]) activeIndex = i;

  const perPage = PER_PAGE[kind] ?? 3;
  const page = Math.floor(activeIndex / perPage);
  const pageStart = itemStartFrame[page * perPage] ?? 0;
  // 페이지 교체: 새 페이지가 8프레임에 걸쳐 자리를 잡는다 (스크롤 금지)
  const pageEnter = interpolate(frame, [pageStart, pageStart + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const pageCount = Math.ceil(items.length / perPage) || 1;

  // ── 배경 ──
  // 밝기는 사진마다 다르게(Pexels avg_color 기반). 전체를 똑같이 눌러버리면
  // 원래 어두운 사진은 형태까지 사라져 화면이 죽는다.
  const bright = chapter.bgBrightness ?? 0.78;
  const kenburns = interpolate(frame, [0, frames], chapterNumber % 2 === 0 ? [1.12, 1.05] : [1.05, 1.12], {
    extrapolateRight: "clamp",
  });
  // 범퍼: 검은 화면 없이 새 배경 위에서 아주 살짝 정착시킨다
  const settle = interpolate(frame, [0, 11], [1.018, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });

  const view: LayoutProps = {
    kind,
    items,
    activeIndex,
    page,
    perPage,
    pageCount,
    pageEnter,
    accent,
    heading: chapter.heading,
  };

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
            background: "radial-gradient(circle at 40% 40%, #1a1f2e 0%, #0b0d14 60%, #06070a 100%)",
          }}
        />
      )}
      {grade ? <AbsoluteFill style={{ background: grade.tintCss }} /> : null}

      {/* 로컬 스크림 — 사진 전체를 죽이지 않고 '글자가 놓인 자리'만 어둡게 */}
      <AbsoluteFill style={{ background: scrimFor(kind, hasCard) }} />

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

      <ChapterBumper number={chapterNumber} heading={chapter.heading} accent={accent} />
      <ChapterLabel heading={chapter.heading} accent={accent} />

      {centralQuestion ? <CentralQuestion text={centralQuestion} accent={accent} /> : null}

      {hasCard && kind === "timeline" ? <TimelineBoard {...view} /> : null}
      {hasCard && kind === "theories" ? <TheoryCompare {...view} /> : null}
      {hasCard && (kind === "persons" || kind === "evidence") ? (
        <>
          <LeftAnchor {...view} />
          <SideCard {...view} />
        </>
      ) : null}

      {chapter.segments.map((s, i) => (
        <Sequence key={i} from={segStarts[i]} durationInFrames={segLens[i]}>
          <Audio src={staticFile(s.audioSrc)} />
          <Subtitle text={s.text} emphasis={s.emphasis} accent={accent} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

/** 자료 배치에 맞춘 국소 스크림 (사진 전체를 어둡게 하지 않는다) */
function scrimFor(kind: string, hasCard: boolean): string {
  if (!hasCard) {
    return "linear-gradient(180deg, rgba(5,7,10,0.42) 0%, rgba(5,7,10,0.16) 30%, rgba(5,7,10,0.34) 62%, rgba(5,7,10,0.88) 100%)";
  }
  if (kind === "timeline" || kind === "theories") {
    // 전체 폭 자료 — 가운데 띠를 눌러준다
    return "linear-gradient(180deg, rgba(5,7,10,0.46) 0%, rgba(5,7,10,0.60) 14%, rgba(5,7,10,0.60) 70%, rgba(5,7,10,0.90) 100%)";
  }
  // 좌우 분할 — 우측(카드)만 진하게, 좌측 사진은 살려둔다
  return "linear-gradient(90deg, rgba(5,7,10,0.30) 0%, rgba(5,7,10,0.34) 38%, rgba(5,7,10,0.74) 60%, rgba(5,7,10,0.84) 100%)";
}

/**
 * 챕터 시작 범퍼 (0.7초).
 * 전체 화면 챕터 카드를 매 챕터마다 넣으면 8챕터 × 1.5초 = 12초가 순수
 * 전환 화면이 된다. 대신 새 배경 위에 번호와 제목을 잠깐 크게 얹고 뺀다.
 */
const ChapterBumper: React.FC<{ number: number; heading: string; accent: string }> = ({
  number,
  heading,
  accent,
}) => {
  const frame = useCurrentFrame();
  const inAmt = interpolate(frame, [7, 19], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const outAmt = interpolate(frame, [30, 40], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lineW = interpolate(frame, [5, 16], [0, 320], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const vis = inAmt * outAmt;
  if (vis <= 0.001) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        top: 300,
        opacity: vis,
        transform: `translateX(${(1 - inAmt) * -12}px)`,
      }}
    >
      <div style={{ height: 5, width: lineW, background: accent, borderRadius: 3, marginBottom: 26 }} />
      <div
        style={{
          color: accent,
          fontFamily: FONT_FAMILY,
          fontSize: 92,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: "2px",
        }}
      >
        {String(number).padStart(2, "0")}
      </div>
      <div
        style={{
          marginTop: 14,
          color: TEXT,
          fontFamily: FONT_FAMILY,
          fontSize: 48,
          fontWeight: 700,
          textShadow: "0 3px 16px rgba(0,0,0,0.9)",
        }}
      >
        {heading}
      </div>
    </div>
  );
};

/** 좌상단 상시 라벨 — 범퍼가 끝난 뒤 자리를 잡는다 */
const ChapterLabel: React.FC<{ heading: string; accent: string }> = ({ heading, accent }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [BUMP + 13, BUMP + 25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        top: 62,
        display: "flex",
        alignItems: "center",
        gap: 18,
        opacity: enter,
        transform: `translateX(${(1 - enter) * -12}px)`,
      }}
    >
      <div style={{ width: 5, height: 46, background: accent, borderRadius: 3 }} />
      <div
        style={{
          color: TEXT,
          fontFamily: FONT_FAMILY,
          fontSize: 38,
          fontWeight: 700,
          letterSpacing: "0.5px",
          textShadow: "0 2px 12px rgba(0,0,0,0.9)",
        }}
      >
        {heading}
      </div>
    </div>
  );
};

const CentralQuestion: React.FC<{ text: string; accent: string }> = ({ text, accent }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [BUMP + 16, BUMP + 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        right: 200,
        top: 250,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 16}px)`,
        display: "flex",
        gap: 26,
      }}
    >
      <div style={{ width: 6, background: accent, borderRadius: 3, flexShrink: 0 }} />
      <div
        style={{
          color: TEXT,
          fontFamily: FONT_FAMILY,
          fontSize: 80,
          fontWeight: 800,
          lineHeight: 1.24,
          wordBreak: "keep-all",
          textWrap: "balance",
          textShadow: "0 4px 24px rgba(0,0,0,0.98), 0 2px 8px rgba(0,0,0,0.95)",
        }}
      >
        {text}
      </div>
    </div>
  );
};

// ── 자료 카드 공통 ──

interface LayoutProps {
  kind: string;
  items: NarratedChapter["cardItems"];
  activeIndex: number;
  page: number;
  perPage: number;
  pageCount: number;
  pageEnter: number;
  accent: string;
  heading: string;
}

/** 지금 말하는 항목만 선명하게, 지난 항목은 흐리게, 안 나온 항목은 아주 흐리게 */
function itemState(idx: number, activeIndex: number): { opacity: number; current: boolean } {
  if (idx === activeIndex) return { opacity: 1, current: true };
  if (idx < activeIndex) return { opacity: 0.46, current: false };
  return { opacity: 0.18, current: false }; // 자리는 잡아둬서 레이아웃이 흔들리지 않게
}

const CardHead: React.FC<{
  kind: string;
  heading: string;
  accent: string;
  page: number;
  pageCount: number;
  /** "spread" = 제목 좌·페이지 우 / "left" = 둘 다 좌측에 붙임 */
  align?: "spread" | "left";
}> = ({ kind, heading, accent, page, pageCount, align = "spread" }) => {
  const title = CARD_TITLES[kind] ?? "";
  const showTitle = title && !sameLabel(title, heading);
  if (!showTitle && pageCount <= 1) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: align === "left" ? 22 : 0,
        justifyContent: align === "left" ? "flex-start" : "space-between",
      }}
    >
      <div
        style={{
          color: accent,
          fontFamily: FONT_FAMILY,
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: "2px",
        }}
      >
        {showTitle ? title : ""}
      </div>
      {pageCount > 1 ? (
        <div
          style={{
            color: "rgba(255,255,255,0.55)",
            fontFamily: FONT_FAMILY,
            fontSize: 27,
            fontWeight: 600,
          }}
        >
          {page + 1} / {pageCount}
        </div>
      ) : null}
    </div>
  );
};

const panelStyle = (accent: string): React.CSSProperties => ({
  // 0.80 → 0.86: 본문 대비를 7:1 이상으로 올린다. 45세 이상이 87%라
  // WCAG 최소선(4.5:1)이 아니라 넉넉한 쪽을 기준으로 잡는다.
  background: "rgba(9,11,16,0.86)",
  border: "1px solid rgba(255,255,255,0.13)",
  borderLeft: `5px solid ${accent}`,
  borderRadius: 8,
  boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
});

/** 좌측 시각 앵커 — 지금 말하는 항목 하나를 큰 글자로 (인물·증거 챕터) */
const LeftAnchor: React.FC<LayoutProps> = ({ kind, items, activeIndex, accent }) => {
  const item = items[activeIndex];
  if (!item) return null;
  const isEvidence = kind === "evidence";
  return (
    <div style={{ position: "absolute", left: 96, top: 200, width: 690 }}>
      <div
        style={{
          color: accent,
          fontFamily: FONT_FAMILY,
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "4px",
          marginBottom: 16,
        }}
      >
        {isEvidence ? "EVIDENCE" : "인물"}
      </div>
      <div
        style={{
          color: "rgba(255,255,255,0.94)",
          fontFamily: FONT_FAMILY,
          fontSize: isEvidence ? 112 : 64,
          fontWeight: 800,
          lineHeight: 1.05,
          wordBreak: "keep-all",
          textShadow: "0 4px 22px rgba(0,0,0,0.9)",
        }}
      >
        {isEvidence ? String(activeIndex + 1).padStart(2, "0") : item.label}
      </div>
      {isEvidence ? (
        <div
          style={{
            marginTop: 18,
            color: TEXT,
            fontFamily: FONT_FAMILY,
            fontSize: 38,
            fontWeight: 700,
            wordBreak: "keep-all",
            textShadow: "0 3px 16px rgba(0,0,0,0.9)",
          }}
        >
          {item.label}
        </div>
      ) : null}
    </div>
  );
};

/** 우측 카드 (인물·증거) */
const SideCard: React.FC<LayoutProps> = (p) => {
  const { items, activeIndex, page, perPage, pageEnter, accent } = p;
  const slice = items.slice(page * perPage, page * perPage + perPage);
  return (
    <div
      style={{
        position: "absolute",
        left: 830,
        top: 132,
        width: 994,
        maxHeight: 628,
        padding: "34px 40px 38px 42px",
        display: "flex",
        flexDirection: "column",
        gap: 22,
        opacity: pageEnter,
        transform: `translateX(${(1 - pageEnter) * 12}px)`,
        ...panelStyle(accent),
      }}
    >
      <CardHead {...p} />
      {slice.map((item, k) => {
        const idx = page * perPage + k;
        const st = itemState(idx, activeIndex);
        return (
          <div
            key={idx}
            style={{
              opacity: st.opacity,
              padding: "10px 14px 12px 16px",
              borderRadius: 6,
              background: st.current ? "rgba(255,255,255,0.065)" : "transparent",
              borderLeft: st.current ? `4px solid ${accent}` : "4px solid transparent",
            }}
          >
            <div
              style={{
                color: accent,
                fontFamily: FONT_FAMILY,
                fontSize: 36,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                color: TEXT,
                fontFamily: FONT_FAMILY,
                fontSize: 42,
                fontWeight: 700,
                lineHeight: 1.27,
                wordBreak: "keep-all",
              }}
            >
              {item.main}
            </div>
            {item.sub ? (
              <div
                style={{
                  marginTop: 8,
                  color: SUB_TEXT,
                  fontFamily: FONT_FAMILY,
                  fontSize: 35,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  wordBreak: "keep-all",
                }}
              >
                <span style={{ color: WARN, fontWeight: 700 }}>그러나 · </span>
                {item.sub}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

/** 타임라인 — 전체 폭 보드 (좁은 우측 카드에 날짜+사건을 넣으면 둘 다 줄어든다) */
const TimelineBoard: React.FC<LayoutProps> = (p) => {
  const { items, activeIndex, page, perPage, pageEnter, accent } = p;
  const slice = items.slice(page * perPage, page * perPage + perPage);
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        top: 145,
        width: 1680,
        maxHeight: 610,
        padding: "32px 40px 36px 44px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        opacity: pageEnter,
        transform: `translateX(${(1 - pageEnter) * 12}px)`,
        ...panelStyle(accent),
      }}
    >
      <CardHead {...p} />
      {slice.map((item, k) => {
        const idx = page * perPage + k;
        const st = itemState(idx, activeIndex);
        return (
          <div
            key={idx}
            style={{
              opacity: st.opacity,
              display: "flex",
              alignItems: "flex-start",
              gap: 26,
              padding: "12px 16px",
              borderRadius: 6,
              background: st.current ? "rgba(255,255,255,0.065)" : "transparent",
              borderLeft: st.current ? `4px solid ${accent}` : "4px solid transparent",
            }}
          >
            <div style={{ width: 270, flexShrink: 0, display: "flex", gap: 14 }}>
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  background: accent,
                  marginTop: 14,
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  color: accent,
                  fontFamily: FONT_FAMILY,
                  fontSize: 36,
                  fontWeight: 700,
                  lineHeight: 1.16,
                  wordBreak: "keep-all",
                }}
              >
                {normalizeDateLabel(item.label)}
              </div>
            </div>
            <div
              style={{
                flex: 1,
                color: TEXT,
                fontFamily: FONT_FAMILY,
                fontSize: 42,
                fontWeight: 700,
                lineHeight: 1.27,
                wordBreak: "keep-all",
              }}
            >
              {item.main}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** 가설 비교 — 2열 (한 카드에 세로로 쌓으면 '비교'로 안 읽힌다) */
const TheoryCompare: React.FC<LayoutProps> = (p) => {
  const { items, activeIndex, page, perPage, pageEnter, accent } = p;
  const slice = items.slice(page * perPage, page * perPage + perPage);
  // 가설이 홀수개면 마지막 페이지에 하나만 남는다. 2열 자리에 그대로 두면
  // 오른쪽 절반이 비어 '비교'가 아니라 고장난 화면처럼 보인다 → 가운데 넓게.
  const solo = slice.length === 1;
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 112,
          right: 120,
          opacity: pageEnter,
        }}
      >
        <CardHead {...p} align="left" />
      </div>
      {slice.map((item, k) => {
        const idx = page * perPage + k;
        // 비교 화면에서는 대조군도 읽혀야 한다 — 다른 레이아웃보다 덜 흐리게
        const raw = itemState(idx, activeIndex);
        const st = { ...raw, opacity: raw.current ? 1 : Math.max(raw.opacity, 0.5) };
        return (
          <div
            key={idx}
            style={{
              position: "absolute",
              left: solo ? 400 : k === 0 ? 120 : 990,
              top: 168,
              width: solo ? 1120 : 810,
              maxHeight: 570,
              padding: "30px 34px 34px 36px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              opacity: st.opacity * pageEnter,
              transform: `translateY(${(1 - pageEnter) * 10}px)`,
              ...panelStyle(st.current ? accent : "rgba(255,255,255,0.22)"),
              background: st.current ? "rgba(12,15,21,0.86)" : "rgba(9,11,16,0.74)",
            }}
          >
            <div
              style={{
                color: st.current ? accent : "rgba(255,255,255,0.6)",
                fontFamily: FONT_FAMILY,
                fontSize: 42,
                fontWeight: 800,
                wordBreak: "keep-all",
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                color: TEXT,
                fontFamily: FONT_FAMILY,
                fontSize: 37,
                fontWeight: 700,
                lineHeight: 1.28,
                wordBreak: "keep-all",
              }}
            >
              {item.main}
            </div>
            {item.sub ? (
              <div
                style={{
                  color: SUB_TEXT,
                  fontFamily: FONT_FAMILY,
                  fontSize: 35,
                  fontWeight: 600,
                  lineHeight: 1.3,
                  wordBreak: "keep-all",
                }}
              >
                <span style={{ color: WARN, fontWeight: 700 }}>설명 안 됨 · </span>
                {item.sub}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
};

/**
 * 하단 자막 — 카드 유무와 무관하게 항상 같은 자리.
 * 자막 시작점이 챕터마다 좌우로 움직이면 시청자가 매번 눈으로 다시 찾아야 한다.
 * 본문은 항상 흰색이고, 감정은 좌측 강조바 색으로만 표시한다 — 문장 전체를
 * 빨갛게 칠하면 고연령층에게는 가독성이 떨어지고 경고문처럼 보인다.
 */
const Subtitle: React.FC<{
  text: string;
  emphasis: "normal" | "tension" | "reveal";
  accent: string;
}> = ({ text, emphasis, accent }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [1, 9], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  });
  const bar = emphasis === "reveal" ? "#FF6B5A" : accent;

  return (
    <div
      style={{
        position: "absolute",
        left: 110,
        right: 110,
        bottom: 92,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 8}px)`,
        padding: "22px 34px 24px 40px",
        borderLeft: `5px solid ${bar}`,
        borderRadius: 6,
        background:
          "linear-gradient(90deg, rgba(5,7,10,0.91) 0%, rgba(5,7,10,0.84) 62%, rgba(5,7,10,0.76) 100%)",
      }}
    >
      <div
        style={{
          color: TEXT,
          fontFamily: FONT_FAMILY,
          fontSize: 68,
          fontWeight: 700,
          lineHeight: 1.28,
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

const Watermark: React.FC = () => (
  <div
    style={{
      position: "absolute",
      right: 60,
      top: 66,
      color: "rgba(255,255,255,0.38)",
      fontFamily: FONT_FAMILY,
      fontSize: 24,
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

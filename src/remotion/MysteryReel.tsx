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
import type { NarratedSegment, ReelInputProps, ReelTheme } from "../types.js";
import { breathFramesAfter, THUMB_FRAMES } from "./timing.js";
import { ensureFonts, FONT_FAMILY } from "./fonts.js";

// 기본 테마 (theme 미지정 시)
const DEFAULT_THEME: ReelTheme = {
  colors: { normal: "#ffffff", tension: "#ffd76b", reveal: "#ff5a5a" },
  boxStyle: "box",
  kenburns: "in",
};
// 어두운 미스터리 배경음(항상 깔리도록) — 폰 스피커에서도 들리는 중음역 포함
const BGM_VOLUME = 0.26;
// 반전 순간 BGM 을 여기까지 낮춰 나레이션만 남긴다 (무음에 가까운 '숨 죽임')
const BGM_DIP_VOLUME = 0.13;

// ── 전환·모션 상수 (프레임, 30fps 기준) ──
const DISSOLVE_FRAMES = 6; // 같은 장면 안 컷 연결: 6f 소프트 디졸브
const CAPTION_DELAY = 2; //   자막은 배경보다 2f 늦게 —
const CAPTION_IN = 9; //      9f 에 걸쳐 떠오르듯 등장 (컷마다 '치는' 느낌 제거)
const CAPTION_OUT = 4; //     디졸브로 이어질 때 자막 먼저 4f 퇴장
const easeOutSoft = Easing.bezier(0.22, 1, 0.36, 1);

// 자막 패널 소형 라벨 — 세그먼트 톤에 맞는 방송 다큐식 분류표
const PANEL_LABELS: Record<NarratedSegment["emphasis"], string> = {
  normal: "사건 기록",
  tension: "핵심 정황",
  reveal: "사건의 반전",
};

/** 미스터리 릴스: 장면(챕터) 단위 배경 + 장르 그레이드 + 자막 + 나레이션 + BGM */
export const MysteryReel: React.FC<ReelInputProps> = ({
  segments,
  bgmSrc,
  theme,
  thumbTitle,
  thumbBadge,
}) => {
  const { fps } = useVideoConfig();
  ensureFonts(); // Pretendard 폰트 로드 (렌더 전 대기)
  const t = theme ?? DEFAULT_THEME;

  // ── 타임라인 사전 계산 (렌더 결정적: 입력 props 만의 순수 함수) ──
  const slots = segments.map((seg, i) => {
    const audioFrames = Math.max(1, Math.round(seg.durationInSeconds * fps));
    // '숨' 간격을 세그먼트 길이에 포함시켜 화면을 끊김 없이 이어 붙인다.
    const breath = i < segments.length - 1 ? breathFramesAfter(seg.emphasis, fps) : 0;
    return audioFrames + breath;
  });
  const startFrames: number[] = [];
  {
    let f = thumbTitle ? THUMB_FRAMES : 0;
    slots.forEach((len) => {
      startFrames.push(f);
      f += len;
    });
  }

  // 장면(비주얼 챕터) 판별 — sceneIndex 가 없는 구버전 데이터는 컷=장면(디졸브 없음)
  const sceneOf = (i: number) => segments[i].sceneIndex ?? i;
  // 같은 장면 안의 다음 컷으로는 6f 디졸브, 장면 경계·반전 시작은 하드컷
  const dissolvesIn = (i: number) =>
    i > 0 &&
    sceneOf(i) === sceneOf(i - 1) &&
    !(segments[i].emphasis === "reveal" && segments[i - 1].emphasis !== "reveal");

  // 반전 임팩트 지점: 연속 reveal 은 첫 컷만, 영상당 최대 2회 (남발하면 무뎌진다)
  const impactSet = new Set<number>(
    segments
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => s.emphasis === "reveal" && segments[i - 1]?.emphasis !== "reveal")
      .map(({ i }) => i)
      .slice(0, 2),
  );

  // BGM 딥: 반전 0.4초 전부터 잦아들어 하드컷 순간 최저 → 1.2초 유지 → 1.6초 복귀
  const impactStarts = [...impactSet].map((i) => startFrames[i]);
  const bgmVolume = (f: number): number => {
    let v = BGM_VOLUME;
    for (const s of impactStarts) {
      const pre = s - Math.round(fps * 0.4);
      const hold = s + Math.round(fps * 1.2);
      const back = hold + Math.round(fps * 1.6);
      if (f >= pre && f < s) {
        v = Math.min(v, interpolate(f, [pre, s], [BGM_VOLUME, BGM_DIP_VOLUME]));
      } else if (f >= s && f < hold) {
        v = Math.min(v, BGM_DIP_VOLUME);
      } else if (f >= hold && f < back) {
        v = Math.min(v, interpolate(f, [hold, back], [BGM_DIP_VOLUME, BGM_VOLUME]));
      }
    }
    return v;
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {thumbTitle ? (
        <Sequence from={0} durationInFrames={THUMB_FRAMES}>
          <ThumbnailCard title={thumbTitle} badge={thumbBadge} bgSrc={segments[0]?.bgSrc} theme={t} />
        </Sequence>
      ) : null}
      {segments.map((seg, i) => {
        // 다음 컷이 디졸브로 들어오면 이 컷의 배경을 6f 더 남겨 겹침 구간을 만든다
        // (뒤 시퀀스가 위에 쌓이므로 from 계산·오디오 타이밍은 그대로다)
        const tail = i < segments.length - 1 && dissolvesIn(i + 1) ? DISSOLVE_FRAMES : 0;
        return (
          <Sequence key={i} from={startFrames[i]} durationInFrames={slots[i] + tail}>
            {/* 나레이션: 오디오는 파일 길이만큼 재생, 남는 시간은 자연 무음(호흡) */}
            <Audio src={staticFile(seg.audioSrc)} />
            <SegmentView
              seg={seg}
              index={i}
              slotFrames={slots[i]}
              theme={t}
              dissolveIn={dissolvesIn(i)}
              dissolveOut={tail > 0}
              impact={impactSet.has(i)}
              preImpact={impactSet.has(i + 1)}
            />
          </Sequence>
        );
      })}

      {bgmSrc ? <Audio src={staticFile(bgmSrc)} volume={bgmVolume} loop /> : null}
      <Watermark />
    </AbsoluteFill>
  );
};

// 같은 사진을 나눠 쓰는 컷들의 크롭·줌 변주 — 사진 1장이라도 다른 프레이밍으로
const SHOT_VARIANTS = [
  { z0: 1.04, z1: 1.12, pos: "50% 42%" }, // 기본 프레이밍
  { z0: 1.14, z1: 1.22, pos: "44% 30%" }, // 더 당긴 컷, 초점 위쪽
  { z0: 1.1, z1: 1.18, pos: "58% 60%" }, // 반대편 아래 초점
];

/** 정적 필름 그레인 — 시드 고정 SVG 노이즈(프레임마다 동일 → 렌더 결정적) */
const grainUri = (seed: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed}" stitchTiles="stitch"/></filter><rect width="240" height="240" filter="url(#n)"/></svg>`,
  )}`;

const SegmentView: React.FC<{
  seg: NarratedSegment;
  index: number;
  slotFrames: number;
  theme: ReelTheme;
  /** 이 컷이 앞 컷에서 디졸브로 이어져 들어오는가 (같은 장면) */
  dissolveIn: boolean;
  /** 다음 컷이 디졸브로 들어오는가 (자막을 먼저 4f 퇴장시킨다) */
  dissolveOut: boolean;
  /** 반전 임팩트 컷 — 하드컷 + 펀치 줌 (BGM 딥은 상위에서) */
  impact: boolean;
  /** 다음 컷이 반전 — 마지막 0.6초 화면을 조여 '숨을 죽인다' */
  preImpact: boolean;
}> = ({ seg, index, slotFrames, theme, dissolveIn, dissolveOut, impact, preImpact }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const grade = theme.grade;

  // 켄번즈 방향: 테마에 따라 확대/축소/교차 + 장면 내 샷별 크롭 변주
  const v = SHOT_VARIANTS[(seg.shot ?? 0) % SHOT_VARIANTS.length];
  const zoomIn = theme.kenburns === "in" || (theme.kenburns === "mixed" && index % 2 === 0);
  const [s0, s1] = zoomIn ? [v.z0, v.z1] : [v.z1, v.z0];
  let scale = interpolate(frame, [0, slotFrames], [s0, s1], {
    extrapolateRight: "clamp",
  });

  // 반전 3단계 중 '충격': 하드컷 직후 펀치 줌 1.0→1.035→1.02
  if (impact) {
    scale *= interpolate(frame, [0, 4, 12], [1.0, 1.035, 1.02], {
      extrapolateRight: "clamp",
    });
  }

  // 반전 3단계 중 '압축': 반전 직전 0.6초 동안 채도·밝기를 조인다
  const squeeze = preImpact
    ? interpolate(frame, [slotFrames - Math.round(fps * 0.6), slotFrames], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;
  const bgFilter = [
    grade?.bgFilter ?? "",
    squeeze > 0
      ? `saturate(${(1 - 0.35 * squeeze).toFixed(3)}) brightness(${(1 - 0.18 * squeeze).toFixed(3)})`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  // 장면 내 컷 연결: 앞 컷의 남긴 배경 위로 6f 페이드 인 (장면 경계는 하드컷)
  const viewOpacity = dissolveIn
    ? interpolate(frame, [0, DISSOLVE_FRAMES], [0, 1], { extrapolateRight: "clamp" })
    : 1;

  // 자막 모션 — 반전은 즉시 펀치(축소 팝), 평상시는 2f 지연 + 9f 상승 등장
  const enter = impact
    ? interpolate(frame, [0, 5], [0, 1], {
        extrapolateRight: "clamp",
        easing: easeOutSoft,
      })
    : interpolate(frame, [CAPTION_DELAY, CAPTION_DELAY + CAPTION_IN], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: easeOutSoft,
      });
  const exit = dissolveOut
    ? interpolate(frame, [slotFrames - CAPTION_OUT, slotFrames], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  const captionMotion = {
    opacity: enter * exit,
    transform: impact
      ? `scale(${(1.04 - 0.04 * enter).toFixed(4)})`
      : `translateY(${((1 - enter) * 12).toFixed(2)}px) scale(${(0.992 + 0.008 * enter).toFixed(4)})`,
  };

  return (
    <AbsoluteFill style={{ opacity: viewOpacity }}>
      {/* 배경: 스톡 사진(켄번즈 + 장르 그레이드) 또는 그라디언트 폴백 */}
      {seg.bgSrc ? (
        <AbsoluteFill>
          <Img
            src={staticFile(seg.bgSrc)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: v.pos,
              transform: `scale(${scale})`,
              filter: bgFilter || undefined,
            }}
          />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(circle at 50% 40%, #1a1030 0%, #0a0a12 60%, #000 100%)",
            filter: bgFilter || undefined,
          }}
        />
      )}

      {/* 장르 틴트 — 사진이 제각각이어도 한 벌의 색으로 묶는다 */}
      {grade ? <AbsoluteFill style={{ background: grade.tintCss }} /> : null}

      {/* 가독성 오버레이 — 전체는 옅게(사진 살림), 하단만 릴스 UI 대비로 진하게 */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.10) 30%, rgba(0,0,0,0.16) 55%, rgba(0,0,0,0.82) 100%)",
        }}
      />
      {/* 자막 중심 로컬 스크림 — 화면 전체 대신 자막 뒤만 정밀하게 어둡힌다 */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 62% 30% at 50% 58%, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 72%)",
        }}
      />

      {/* 정적 필름 그레인 (soft-light) — 스톡 사진의 '깨끗한 광고 느낌'을 눌러준다 */}
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

      <Caption
        text={seg.text}
        textEn={seg.textEn}
        color={theme.colors[seg.emphasis]}
        boxStyle={theme.boxStyle}
        accent={grade?.accent ?? theme.colors.tension}
        label={PANEL_LABELS[seg.emphasis]}
        motion={captionMotion}
      />
    </AbsoluteFill>
  );
};

/**
 * 자막 — 화면 중앙 안전 밴드에 배치. 한글(위) + 영어 번역(아래) 이중 자막.
 * 기본(box)은 방송 다큐형 매트 패널: 낮은 radius, 좌측 강조바, 소형 분류 라벨.
 * 인스타 릴스 UI(하단 캡션/오디오/진행바, 우측 액션 버튼)를 피하려고
 * 하단이 아니라 세로 중앙(약간 아래)로 올리고, 폭을 좁혀 우측 버튼 열도 비운다.
 */
const Caption: React.FC<{
  text: string;
  textEn?: string;
  color: string;
  boxStyle: ReelTheme["boxStyle"];
  /** 장르 강조색 — 매트 패널 좌측 바·라벨 */
  accent: string;
  /** 패널 소형 라벨 (매트 패널에서만 표시) */
  label: string;
  /** 등장/퇴장 모션 (상위에서 프레임 계산 완료) */
  motion: { opacity: number; transform: string };
}> = ({ text, textEn, color, boxStyle, accent, label, motion }) => {
  const isPanel = boxStyle === "box";
  // 자막 배경 스타일 3종 (버라이어티 팩이 영상마다 선택 — 매트 패널이 기본 룩)
  const boxCss: React.CSSProperties =
    boxStyle === "minimal"
      ? {
          // 배경 없음 — 강한 그림자만으로 가독성 확보
          // 폭을 우측 릴스 버튼 열(하트/댓글) 앞에서 끊는다 — 길면 균형 2줄로 줄바꿈
          maxWidth: "82%",
          padding: "10px 8px",
          filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.95))",
        }
      : boxStyle === "bar"
        ? {
            // 화면 가로를 꽉 채우는 띠 (글자는 우측 버튼 열을 피해 안쪽에만)
            width: "100%",
            padding: "26px 130px",
            borderRadius: 0,
            background:
              "linear-gradient(90deg, rgba(8,8,12,0) 0%, rgba(8,8,12,0.72) 12%, rgba(8,8,12,0.72) 88%, rgba(8,8,12,0) 100%)",
          }
        : {
            // 기본: 방송형 매트 패널 — 각진 radius + 좌측 강조바 + 옅은 테두리
            maxWidth: "84%",
            padding: "22px 42px 26px 46px",
            borderRadius: 10,
            background: "rgba(10,11,15,0.68)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderLeft: `4px solid ${accent}`,
            boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
          };

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
          alignItems: isPanel ? "flex-start" : "center",
          gap: 14,
          opacity: motion.opacity,
          transform: motion.transform,
          ...boxCss,
        }}
      >
        {/* 소형 분류 라벨 — 매트 패널에서만 (방송 다큐의 자료 화면 표기 느낌) */}
        {isPanel ? (
          <div
            style={{
              color: accent,
              fontFamily: FONT_FAMILY,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: "4px",
              lineHeight: 1,
            }}
          >
            {label}
          </div>
        ) : null}

        {/* 한글 자막 (강조색, ExtraBold)
            — 시청자 87%가 45세 이상(스튜디오 실측)이라 크게. 실제 대본 최장
            문장(43자)이 4줄로 박스 안에 안전하게 들어가는 것을 렌더로 확인함 */}
        <div
          style={{
            color,
            fontFamily: FONT_FAMILY,
            fontSize: 64,
            fontWeight: 800,
            lineHeight: 1.3,
            letterSpacing: "0px",
            textAlign: isPanel ? "left" : "center",
            textWrap: "balance", // 여러 줄일 때 줄 길이를 고르게(디자인 균형)
            wordBreak: "keep-all", // 한국어를 구절 단위로 줄바꿈
            // 패널이 대비를 만들어 주므로 그림자는 옅게 (패널 밖 스타일은 강하게)
            textShadow: isPanel ? "0 2px 8px rgba(0,0,0,0.6)" : "0 3px 14px rgba(0,0,0,0.92)",
          }}
        >
          {text}
        </div>

        {/* 영어 번역 자막 (아래, 한글보다 작게 — 시청자 65%가 한국인이라
            영어는 보조 정보지만 고연령 해외 시청자를 위해 40px 유지) */}
        {textEn ? (
          <div
            style={{
              width: "100%",
              paddingTop: 14,
              borderTop: "1px solid rgba(255,255,255,0.16)",
              color: "rgba(255,255,255,0.92)",
              fontFamily: FONT_FAMILY,
              fontSize: 40,
              fontWeight: 500,
              lineHeight: 1.32,
              letterSpacing: "0px",
              textAlign: isPanel ? "left" : "center",
              textWrap: "balance",
              textShadow: isPanel ? "0 2px 8px rgba(0,0,0,0.6)" : "0 3px 14px rgba(0,0,0,0.92)",
            }}
          >
            {textEn}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/**
 * 썸네일(커버) 카드 — 영상 맨 앞 1프레임.
 * 인스타 커버·유튜브 썸네일이 첫 프레임을 쓰므로 피드에서 이 카드가 보인다.
 * '사건 파일 포스터' 방향: 글로우 언더라인 대신 코너 브래킷/세로바 마커.
 * 데드존 회피: 텍스트를 세로 중앙 밴드(상단 UI·하단 캡션바 사이)에, 좌우 90px 안쪽.
 * 인스타 그리드는 커버를 3:4 중앙 크롭하므로 중앙 배치가 그리드에서도 안전.
 */
const ThumbnailCard: React.FC<{
  title: string;
  badge?: string;
  bgSrc?: string;
  theme: ReelTheme;
}> = ({ title, badge, bgSrc, theme }) => {
  // LLM 이 줄바꿈을 실제 개행 대신 '\n' 두 글자(백슬래시+n)로 출력하는 경우가 있어
  // 정규화 후 분리. 빈 줄/양끝 공백도 정리.
  const lines = title
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const longest = Math.max(...lines.map((l) => l.length), 1);
  // 글자수에 따라 크기 자동 조절 (짧을수록 큼직하게)
  const fontSize = longest <= 7 ? 160 : longest <= 10 ? 136 : longest <= 14 ? 112 : 94;

  const accent = theme.grade?.accent ?? theme.colors.reveal;
  const marker = theme.grade?.thumbMarker ?? "brackets";
  // 코너 브래킷 4개 — 사건 파일 포스터의 '프레임' 마커
  const bracket = (side: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    width: 58,
    height: 58,
    ...side,
  });
  const bw = `6px solid ${accent}`;

  return (
    <AbsoluteFill>
      {/* 배경: 첫 장면 자료화면(어둡게 + 장르 그레이드) 또는 그라디언트 */}
      {bgSrc ? (
        <Img
          src={staticFile(bgSrc)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scale(1.08)",
            filter: `${theme.grade?.bgFilter ?? ""} brightness(0.55) saturate(0.9)`.trim(),
          }}
        />
      ) : (
        <AbsoluteFill
          style={{
            background: "radial-gradient(circle at 50% 40%, #1a1030 0%, #0a0a12 60%, #000 100%)",
          }}
        />
      )}
      {/* 어두운 비네트 + 핏빛 기운 */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 52%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.72) 100%), linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.12) 35%, rgba(80,0,10,0.28) 100%)",
        }}
      />

      {/* 텍스트 블록 — 세로 중앙 밴드(데드존·그리드 크롭 모두 안전) */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "0 90px",
          transform: "translateY(-20px)",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: marker === "brackets" ? "54px 64px" : "42px 56px 42px 72px",
          }}
        >
          {marker === "brackets" ? (
            <>
              <div style={bracket({ top: 0, left: 0, borderTop: bw, borderLeft: bw })} />
              <div style={bracket({ top: 0, right: 0, borderTop: bw, borderRight: bw })} />
              <div style={bracket({ bottom: 0, left: 0, borderBottom: bw, borderLeft: bw })} />
              <div style={bracket({ bottom: 0, right: 0, borderBottom: bw, borderRight: bw })} />
            </>
          ) : (
            // 좌측 세로바 — 보도 자료 표지의 인덱스 바
            <div
              style={{
                position: "absolute",
                left: 0,
                top: "10%",
                bottom: "10%",
                width: 10,
                borderRadius: 5,
                background: accent,
              }}
            />
          )}

          {/* 실화 배지 — 소재 종류에 맞춰 LLM 이 정한다(미제사건/법정사건/괴담 등).
              그리드 축소판에서도 읽히도록 60px 이상 유지(고연령 시청자·3열 그리드) */}
          <div
            style={{
              background: "#c1121f",
              color: "#ffffff",
              fontFamily: FONT_FAMILY,
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: "2px",
              padding: "14px 40px",
              borderRadius: 10,
              marginBottom: 38,
              boxShadow: "0 6px 24px rgba(0,0,0,0.55)",
            }}
          >
            {badge?.trim() || "실화 미스터리"}
          </div>

          {/* 초대형 타이틀 */}
          <div
            style={{
              color: "#ffffff",
              fontFamily: FONT_FAMILY,
              fontSize,
              fontWeight: 800,
              lineHeight: 1.16,
              letterSpacing: "-1px",
              textAlign: "center",
              wordBreak: "keep-all",
              textWrap: "balance",
              textShadow: "0 6px 30px rgba(0,0,0,0.95), 0 2px 8px rgba(0,0,0,0.9)",
            }}
          >
            {lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      </AbsoluteFill>
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

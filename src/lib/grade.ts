import type { ReelGenre, ReelGrade } from "../types.js";

/**
 * 장르 고정 색보정(그레이드).
 *
 * 매 영상 랜덤 팔레트는 '자동 생성' 신호다. 방송 다큐(그알·PD수첩·BBC Panorama)
 * 처럼 소재 장르마다 색을 고정하면 채널 정체성이 생기고, 사진이 제각각이어도
 * 한 벌의 룩으로 묶인다. 사건마다 caseKey 해시로 ±4% 지터만 줘서
 * '같은 룩, 다른 회차' 느낌을 유지한다.
 *
 * 모든 값은 Node 쪽에서 확정해 props 로 내려보낸다 — 렌더 코드에 랜덤 금지.
 */

interface GenreLook {
  /** 배경 사진 필터의 기준값 */
  saturate: number;
  brightness: number;
  contrast: number;
  hueRotate: number; // deg
  sepia: number;
  /** 화면 틴트 (위→아래로 옅어지는 장르색) */
  tintRgb: string; // "r,g,b"
  tintAlpha: number;
  /** 강조색: 자막 라벨·강조바·썸네일 마커 */
  accent: string;
  /** 자막 강조색 (tension/reveal) */
  tension: string;
  reveal: string;
}

const LOOKS: Record<ReelGenre, GenreLook> = {
  // 미제·콜드케이스 — 차가운 청회색 (수사 다큐)
  coldCase: {
    saturate: 0.72, brightness: 0.94, contrast: 1.06, hueRotate: -6, sepia: 0,
    tintRgb: "44,66,96", tintAlpha: 0.16,
    accent: "#7fa8c9", tension: "#8fc3e8", reveal: "#ff5a5a",
  },
  // 법정·판결·유산 분쟁 — 서류·백열등의 앰버 (법정 스릴러)
  court: {
    saturate: 0.82, brightness: 0.95, contrast: 1.05, hueRotate: 0, sepia: 0.14,
    tintRgb: "118,86,32", tintAlpha: 0.12,
    accent: "#d9a441", tension: "#e8b04b", reveal: "#ff6b4d",
  },
  // 역사·기록물 — 먹색에 가까운 저채도 (사료 화면)
  history: {
    saturate: 0.55, brightness: 0.9, contrast: 1.1, hueRotate: 0, sepia: 0.08,
    tintRgb: "24,24,28", tintAlpha: 0.18,
    accent: "#b9a88a", tension: "#d9c9a3", reveal: "#e85454",
  },
  // 전설·민담·괴담 — 녹청 (설화·심야 괴담)
  folklore: {
    saturate: 0.7, brightness: 0.9, contrast: 1.07, hueRotate: 10, sepia: 0,
    tintRgb: "22,66,58", tintAlpha: 0.14,
    accent: "#58b898", tension: "#7fd0b8", reveal: "#ff5f87",
  },
};

/** thumbBadge(소재 분류 문구)와 소재 각도에서 장르를 정한다 */
export function detectGenre(thumbBadge?: string, topicAngle?: string): ReelGenre {
  const badge = thumbBadge ?? "";
  const angle = topicAngle ?? "";
  if (/법정|판결|재판|소송|유산|상속|분쟁/.test(badge)) return "court";
  if (/괴담|전설|민담|설화|귀신/.test(badge)) return "folklore";
  if (/역사|조선|고려|왕실|실록/.test(badge)) return "history";
  if (/불륜|치정|유산|재산|법원|판결/.test(angle)) return "court";
  if (/전설|민담|괴담/.test(angle)) return "folklore";
  return "coldCase"; // 미제·실화 미스터리 기본값
}

/** 문자열 → 0..1 해시 (사건별 지터·마커 로테이션 시드) */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** 소재가 확정된 뒤(대본 생성 후) 호출 — 장르 룩 + 사건별 지터를 담은 그레이드 */
export function deriveGrade(
  caseKey: string,
  thumbBadge?: string,
  topicAngle?: string,
): ReelGrade {
  const genre = detectGenre(thumbBadge, topicAngle);
  const look = LOOKS[genre];
  const r = hash01(caseKey);
  const jitter = (r - 0.5) * 2; // -1..1
  const j = (base: number, pct: number) => +(base * (1 + jitter * pct)).toFixed(3);

  const filter = [
    `saturate(${j(look.saturate, 0.04)})`,
    `brightness(${j(look.brightness, 0.03)})`,
    `contrast(${j(look.contrast, 0.02)})`,
    look.hueRotate ? `hue-rotate(${look.hueRotate}deg)` : "",
    look.sepia ? `sepia(${look.sepia})` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    genre,
    bgFilter: filter,
    tintCss: `linear-gradient(180deg, rgba(${look.tintRgb},${look.tintAlpha}) 0%, rgba(${look.tintRgb},${(look.tintAlpha * 0.45).toFixed(3)}) 100%)`,
    accent: look.accent,
    grainOpacity: +(0.035 + jitter * 0.008).toFixed(3), // 0.027~0.043
    grainSeed: Math.floor(r * 1000),
    thumbMarker: r < 0.5 ? "brackets" : "bar",
  };
}

/** 장르 고정 자막 강조색 — 랜덤 팔레트 대신 소재 성격이 색을 정한다 */
export function gradeColors(genre: ReelGenre): { normal: string; tension: string; reveal: string } {
  const look = LOOKS[genre];
  return { normal: "#ffffff", tension: look.tension, reveal: look.reveal };
}

/**
 * 시각 문법 공통 색·모션 토큰.
 *
 * 문법마다 제각각 색을 쓰면 채널 정체성이 사라진다. 여기 없는 색은 쓰지 않는다.
 */
export const V = {
  TEXT: "#F4F5F6",
  /** 단위·역할어 같은 보조 정보 */
  SUB: "rgba(255,255,255,0.84)",
  /** 상태 전용 — 모순·반박·충격 수치 */
  WARN: "#FF8A7A",
  TEXT_WARN: "#FFE3DC",
  /** 불확실 전용 — 원문이 '추정·주장'이라고 한 것 */
  HEDGE: "#E8C27A",
  /** 막대·격자의 바탕 */
  TRACK: "rgba(255,255,255,0.10)",
  EMPTY: "rgba(255,255,255,0.07)",
  EMPTY_LINE: "rgba(255,255,255,0.22)",
  SHADOW: "0 4px 20px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.9)",
} as const;

/**
 * 문장 그룹(라벨+본문+보조문구, 또는 수치 그래픽)을 세로로 중앙 정렬할 때 쓰는
 * 공통 대역. 문장 길이가 회차마다 달라 위/아래로 들쭉날쭉 배치되던 것을 고치기
 * 위한 것 — top~bottom 사이 빈 공간의 정중앙에 오도록 justifyContent:"center" 로
 * 감싼다. 최악의 경우(본문 3줄+보조 2줄)도 자막 안전선(812) 안에 들어오게
 * 여유를 뒀다.
 */
export const FRAME_V_TOP = 110;
export const FRAME_V_BOTTOM = 300;

/**
 * 글자 위에 까는 스크림. 사진 밝기에 따라 두 단계뿐이다 —
 * 문법마다 다르게 하면 화면이 튄다.
 */
export function scrim(bgBrightness = 0.78): string {
  const b = bgBrightness >= 0.82;
  return `linear-gradient(180deg,
    rgba(5,7,10,${b ? 0.62 : 0.52}) 0%,
    rgba(5,7,10,${b ? 0.86 : 0.76}) 20%,
    rgba(5,7,10,${b ? 0.86 : 0.76}) 78%,
    rgba(5,7,10,${b ? 0.68 : 0.58}) 100%)`;
}

/**
 * 허용 모션은 이것뿐이다: opacity, translateY(≤16px), 선의 길이.
 * 텍스트 scale 은 노안 재초점을 강요해서 쓰지 않는다.
 * spring·bounce·회전·반복 펄스도 금지 — 45세 이상 시청자에게 피로하다.
 */
export const V_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * 글자 폭 어림 — 렌더와 검증이 **같은 함수**를 써야 한다.
 *
 * 렌더 쪽에만 있으면, Node 쪽 게이트가 "이 문장은 들어간다"고 판정한 것이
 * 화면에서는 넘친다. 실제로 썸네일에서 글자 수로만 크기를 정했다가
 * '37년 만에'(숫자 포함)와 '존재하지만'(전부 한글)이 같은 5자인데 폭이
 * 달라 상자를 넘긴 적이 있다.
 *
 * 한글은 전각(1em), 라틴·숫자는 약 0.55em, 공백은 0.3em으로 잡는다.
 */
export function textEm(line: string): number {
  return [...line].reduce(
    (w, ch) =>
      w + (/[ᄀ-ᇿ㄰-㆏가-힣]/.test(ch) ? 1 : ch === " " ? 0.3 : 0.55),
    0,
  );
}

/**
 * 롱폼 썸네일 문구 기준(2026-11 실측: 시청자 55세 이상 77%, 휴대폰 86%).
 * 짧아야 각 줄을 크게 찍을 수 있다. 공백 포함, 줄바꿈 제외. 렌더와 문구 검사가 같이 쓴다.
 */
export const THUMB_TOTAL_MIN = 8;
export const THUMB_TOTAL_MAX = 14;
export const THUMB_LINE_MIN = 3;
export const THUMB_LINE_MAX = 9;

/** 주어진 폰트 크기로 maxPx 안에 들어가는가 */
export function fitsWidth(s: string, fontPx: number, maxPx: number): boolean {
  return textEm(s) * fontPx <= maxPx;
}

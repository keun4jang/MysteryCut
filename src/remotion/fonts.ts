import { staticFile, continueRender, delayRender } from "remotion";

/**
 * Pretendard(프레젠테이션용 한/영 통합 폰트)를 렌더 전에 로드.
 * public/fonts/ 의 woff2 를 @font-face 없이 FontFace API 로 등록하고,
 * 폰트가 준비될 때까지 렌더를 지연시킨다(headless 렌더에서 tofu 방지).
 */
export const FONT_FAMILY =
  'Pretendard, "Noto Sans CJK KR", "Noto Sans KR", system-ui, sans-serif';

let started = false;

export function ensureFonts(): void {
  if (started || typeof document === "undefined" || typeof FontFace === "undefined") return;
  started = true;
  const handle = delayRender("Pretendard 로딩");
  const faces: Array<{ weight: string; file: string }> = [
    { weight: "600", file: "fonts/Pretendard-SemiBold.woff2" },
    { weight: "700", file: "fonts/Pretendard-Bold.woff2" },
    { weight: "800", file: "fonts/Pretendard-ExtraBold.woff2" },
  ];
  Promise.all(
    faces.map(async ({ weight, file }) => {
      const face = new FontFace("Pretendard", `url(${staticFile(file)}) format('woff2')`, {
        weight,
      });
      await face.load();
      document.fonts.add(face);
    }),
  )
    .then(() => continueRender(handle))
    .catch(() => continueRender(handle)); // 실패해도 렌더는 진행(폴백 폰트)
}

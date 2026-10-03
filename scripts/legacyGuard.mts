/**
 * 옛 영상 보호 — 이 채널은 2021~2023년에 '새미했다' 이름으로 쓰던 채널이다.
 * 그 시절 영상(대부분 사장님이 직접 비공개로 둔 것)은 어떤 스크립트도 절대 건드리지
 * 않는다(사장님 지시, 2026-10-03). 미스터리 컷 자동 게시는 2026-07-22 부터라
 * 2026-01-01 이전에 올라간 영상은 전부 옛 영상으로 본다.
 *
 * 게시일을 모르는 영상도 옛 영상으로 본다 — 확인 못 한 것을 바꾸는 쪽이 더 위험하다.
 */
export const LEGACY_CUTOFF = "2026-01-01T00:00:00Z";

export function isLegacyVideo(publishedAt: string | undefined): boolean {
  return !publishedAt || publishedAt < LEGACY_CUTOFF;
}

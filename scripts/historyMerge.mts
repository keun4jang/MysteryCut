/**
 * 게시 이력 합집합(commitPostHistory.mts 가 쓴다 — 테스트에서 따로 부르려고 분리).
 * 식별자는 caseKey+날짜+형식. 11/8: 같은 날 같은 사건의 쇼츠와 롱폼(단일 사건 롱폼은 쇼츠 사건을 다시 다룬다)이
 * 예전 키(caseKey+날짜)로는 하나로 합쳐져 뒤의 것이 사라졌다.
 */
export interface MergePost {
  caseKey: string;
  at: string;
  format?: string;
  [k: string]: unknown;
}

export const postKey = (p: MergePost): string => `${p.caseKey} ${p.at} ${p.format ?? ""}`;

export function mergePosts<T extends MergePost>(remotePosts: T[], localPosts: T[]): T[] {
  const seen = new Set(remotePosts.map(postKey));
  return [...remotePosts, ...localPosts.filter((p) => !seen.has(postKey(p)))];
}

/**
 * 비주얼 챕터(장면) 정규화.
 *
 * 컷(세그먼트) 25~29개가 전부 다른 사진이면 '자동 생성 슬라이드쇼'처럼 보인다.
 * 2~3컷을 한 장면으로 묶어 사진 1장을 크롭·줌 변주로 나눠 쓰면(고유 사진 10~15장)
 * 시청자가 '연출된 영상'으로 인식한다. LLM 이 scene 번호를 붙이지만, 번호를
 * 빼먹거나 건너뛰거나 한 장면을 지나치게 길게 잡는 경우가 있어 여기서 보정한다.
 */

interface SceneInput {
  scene?: number;
  visualQuery: string;
  emphasis: "normal" | "tension" | "reveal";
}

export interface SceneAssignment {
  sceneIndex: number;
  shot: number;
}

/** 한 장면이 이보다 길면 사진 반복이 티가 난다 — 강제로 새 장면을 연다 */
const MAX_SHOTS_PER_SCENE = 3;

/**
 * 각 세그먼트에 (0부터 연속인) sceneIndex 와 장면 내 순번 shot 을 부여한다.
 * - LLM 이 scene 을 줬으면: 등장 순서대로 0..N 으로 리매핑, 누락분은 직전 장면 승계
 * - 아예 안 줬으면: visualQuery 가 바뀌는 지점을 장면 경계로 삼는 폴백
 * - 공통 보정: reveal 은 새 장면으로 시작(반전은 새 그림이어야 충격이 산다),
 *   한 장면이 MAX_SHOTS_PER_SCENE 을 넘으면 강제 분할
 */
export function assignScenes(segments: SceneInput[]): SceneAssignment[] {
  const hasLlmScenes = segments.some((s) => typeof s.scene === "number");

  const out: SceneAssignment[] = [];
  let sceneIndex = -1;
  let shot = 0;
  // 마지막으로 '명시된' scene 번호 — 번호가 없는 세그먼트를 건너뛰고도
  // 다음 명시 번호가 바뀌었는지를 판단한다 (0, (누락), 1 → 1에서 경계)
  let lastExplicit: number | undefined;

  for (let i = 0; i < segments.length; i++) {
    const cur = segments[i];
    let boundary: boolean;
    if (i === 0) {
      boundary = true;
    } else if (hasLlmScenes) {
      // 번호가 명시됐고 마지막 명시 번호와 다르면 경계. 누락은 직전 장면 승계.
      boundary = typeof cur.scene === "number" && cur.scene !== lastExplicit;
    } else {
      // 폴백: 검색어가 바뀌면 다른 그림을 의도한 것
      boundary =
        cur.visualQuery.trim().toLowerCase() !==
        segments[i - 1].visualQuery.trim().toLowerCase();
    }
    const revealBreak =
      i > 0 && cur.emphasis === "reveal" && segments[i - 1].emphasis !== "reveal";
    if (boundary || revealBreak || shot >= MAX_SHOTS_PER_SCENE) {
      sceneIndex += 1;
      shot = 0;
    }
    if (typeof cur.scene === "number") lastExplicit = cur.scene;
    out.push({ sceneIndex, shot });
    shot += 1;
  }
  return out;
}

/** 로그용 — 장면 수와 장면당 평균 컷 수 */
export function sceneStats(assignments: SceneAssignment[]): { scenes: number; avgShots: number } {
  const scenes = assignments.length ? assignments[assignments.length - 1].sceneIndex + 1 : 0;
  return { scenes, avgShots: scenes ? assignments.length / scenes : 0 };
}

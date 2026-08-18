import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { NarratedSegment } from "../types.js";

const BROLL_DIR = path.join(config.paths.public, "broll");

/**
 * 자료화면(B-roll) 어시스트 — Pexels 무료 스톡 사진.
 *
 * 사진은 세그먼트가 아니라 '비주얼 챕터(장면)' 단위로 1장씩 받는다.
 * 같은 장면의 2~3컷이 사진 1장을 크롭·줌 변주로 나눠 쓰면(고유 사진 10~15장)
 * 컷마다 다른 사진이 튀어나오는 슬라이드쇼 느낌이 사라지고, Pexels 호출도
 * 절반 이하로 준다. 장면의 대표 검색어는 그 장면 첫 세그먼트의 visualQuery.
 *
 * PEXELS_API_KEY 가 없거나 검색 실패 시 bgSrc 를 비워 그라디언트로 폴백합니다.
 */
export async function attachBroll(segments: NarratedSegment[]): Promise<NarratedSegment[]> {
  if (!config.pexels.apiKey) {
    console.log("  🖼️  PEXELS_API_KEY 없음 → 배경 없이 그라디언트로 렌더");
    return segments;
  }
  await fs.mkdir(BROLL_DIR, { recursive: true });

  // 같은 검색어는 사진을 재사용(과도한 반복 방지 + 호출 절약)
  const byQuery = new Map<string, string | undefined>();
  // 장면 번호 → 사진 경로 (장면당 1장)
  const byScene = new Map<number, string | undefined>();

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const scene = seg.sceneIndex ?? i; // 정규화 전 데이터(구버전 project.json) 폴백

    if (!byScene.has(scene)) {
      // 장면 첫 세그먼트의 검색어가 그 장면의 사진을 정한다
      const query = seg.visualQuery?.trim() || "dark mystery atmosphere";
      let bgSrc = byQuery.get(query);
      if (bgSrc === undefined && !byQuery.has(query)) {
        const fileName = `scene-${scene}.jpg`;
        bgSrc = (await downloadOne(query, path.join(BROLL_DIR, fileName)))
          ? `broll/${fileName}`
          : undefined;
        byQuery.set(query, bgSrc);
      }
      byScene.set(scene, bgSrc);
      console.log(`  🖼️  장면 ${scene + 1} "${query}" → ${bgSrc ?? "폴백"}`);
    }
    seg.bgSrc = byScene.get(scene);
  }
  return segments;
}

/** Pexels 에서 세로 사진 1장을 받아 저장. 성공 여부 반환 */
async function downloadOne(query: string, absPath: string): Promise<boolean> {
  try {
    const url =
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}` +
      `&orientation=portrait&per_page=1&size=large`;
    const res = await fetch(url, { headers: { Authorization: config.pexels.apiKey } });
    if (!res.ok) return false;
    const json = (await res.json()) as {
      photos?: Array<{ src?: { large2x?: string; large?: string; portrait?: string } }>;
    };
    const src = json.photos?.[0]?.src;
    const imgUrl = src?.large2x ?? src?.large ?? src?.portrait;
    if (!imgUrl) return false;

    const img = await fetch(imgUrl);
    if (!img.ok) return false;
    await fs.writeFile(absPath, Buffer.from(await img.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

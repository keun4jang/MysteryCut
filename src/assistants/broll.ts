import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { NarratedSegment } from "../types.js";

const BROLL_DIR = path.join(config.paths.public, "broll");

/**
 * 자료화면(B-roll) 어시스트 — Pexels 무료 스톡 사진.
 * 각 세그먼트의 visualQuery 로 분위기 맞는 세로 사진을 받아 배경으로 씁니다.
 * PEXELS_API_KEY 가 없거나 검색 실패 시 bgSrc 를 비워 그라디언트로 폴백합니다.
 */
export async function attachBroll(segments: NarratedSegment[]): Promise<NarratedSegment[]> {
  if (!config.pexels.apiKey) {
    console.log("  🖼️  PEXELS_API_KEY 없음 → 배경 없이 그라디언트로 렌더");
    return segments;
  }
  await fs.mkdir(BROLL_DIR, { recursive: true });

  // 같은 검색어는 사진을 재사용(과도한 반복 방지)
  const cache = new Map<string, string | undefined>();

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const query = seg.visualQuery?.trim() || "dark mystery atmosphere";

    let bgSrc = cache.get(query);
    if (bgSrc === undefined && !cache.has(query)) {
      const fileName = `seg-${i}.jpg`;
      bgSrc = await downloadOne(query, path.join(BROLL_DIR, fileName))
        ? `broll/${fileName}`
        : undefined;
      cache.set(query, bgSrc);
    }
    seg.bgSrc = bgSrc;
    console.log(`  🖼️  ${i + 1}/${segments.length} "${query}" → ${bgSrc ?? "폴백"}`);
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

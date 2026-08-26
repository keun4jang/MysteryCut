import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { NarratedSegment, NarratedChapter } from "../types.js";

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
        bgSrc = (await downloadOne(query, path.join(BROLL_DIR, fileName))).ok
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

/**
 * Pexels 에서 사진 1장을 받아 저장.
 * 성공하면 avg_color(있으면)를 함께 돌려준다 — 배경 밝기 자동 조절에 쓴다.
 */
async function downloadOne(
  query: string,
  absPath: string,
  orientation: "portrait" | "landscape" = "portrait",
): Promise<{ ok: boolean; avgColor?: string }> {
  try {
    const url =
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}` +
      `&orientation=${orientation}&per_page=1&size=large`;
    // 타임아웃 없으면 Pexels 가 매달릴 때 장면 수만큼(10회+) 5분씩 샌다.
    // 실패는 그라디언트 폴백이 받으므로 빨리 포기하는 쪽이 낫다.
    const res = await fetch(url, {
      headers: { Authorization: config.pexels.apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as {
      photos?: Array<{
        avg_color?: string;
        src?: { large2x?: string; large?: string; portrait?: string };
      }>;
    };
    const photo = json.photos?.[0];
    const src = photo?.src;
    const imgUrl = src?.large2x ?? src?.large ?? src?.portrait;
    if (!imgUrl) return { ok: false };

    const img = await fetch(imgUrl, { signal: AbortSignal.timeout(45_000) });
    if (!img.ok) return { ok: false };
    await fs.writeFile(absPath, Buffer.from(await img.arrayBuffer()));
    return { ok: true, avgColor: photo?.avg_color };
  } catch {
    return { ok: false };
  }
}

/**
 * 사진 평균색 → 배경에 걸 밝기 배수.
 *
 * 스톡 사진은 밝기가 제각각이라 한 값으로 누르면 한쪽이 무너진다. 흰 배경
 * 사진에 흰 자막을 얹으면 안 읽히고(실측으로 겪음), 반대로 원래 어두운 사진을
 * 똑같이 누르면 형태가 사라져 화면이 죽는다. Pexels 가 사진마다 주는
 * avg_color 를 쓰면 이미지를 디코딩하지 않고도(=추가 의존성·비용 0) 밝기를
 * 알 수 있다.
 */
export function brightnessForAvgColor(avgColor?: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(avgColor?.trim() ?? "");
  if (!m) return 0.78; // 정보 없음 → 중간값
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // 상대 휘도(간이) — 사람 눈 가중치
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (L > 0.7) return 0.68; // 아주 밝은 사진은 확실히 누른다
  if (L > 0.4) return 0.78;
  return 0.86; // 이미 어두운 사진은 덜 눌러야 형태가 남는다
}

/**
 * 롱폼용 — 챕터마다 배경 사진 1장.
 * 롱폼은 화면의 주인공이 사진이 아니라 자료 카드라서 사진 수가 적어도 된다.
 * (챕터 7~9개 → 사진 7~9장)
 */
export async function attachChapterBroll(chapters: NarratedChapter[]): Promise<NarratedChapter[]> {
  if (!config.pexels.apiKey) {
    console.log("  🖼️  PEXELS_API_KEY 없음 → 배경 없이 그라디언트로 렌더");
    return chapters;
  }
  await fs.mkdir(BROLL_DIR, { recursive: true });
  const cache = new Map<string, { bgSrc?: string; brightness: number }>();

  for (let i = 0; i < chapters.length; i++) {
    const query = chapters[i].visualQuery?.trim() || "dark archive documents";
    let hit = cache.get(query);
    if (!hit) {
      const fileName = `lf-ch-${i}.jpg`;
      const r = await downloadOne(query, path.join(BROLL_DIR, fileName), "landscape");
      hit = {
        bgSrc: r.ok ? `broll/${fileName}` : undefined,
        brightness: brightnessForAvgColor(r.avgColor),
      };
      cache.set(query, hit);
    }
    chapters[i].bgSrc = hit.bgSrc;
    chapters[i].bgBrightness = hit.brightness;
    console.log(
      `  🖼️  챕터 ${i + 1} "${query}" → ${hit.bgSrc ?? "폴백"} (밝기 ${hit.brightness})`,
    );
  }
  return chapters;
}

/**
 * 롱폼 썸네일 배경 1장.
 *
 * 챕터 배경과 따로 받는 이유 — 기준이 다르다. 챕터 배경은 8분 동안 뒤에 깔릴
 * 분위기면 되지만, 썸네일은 피드에서 0.5초 안에 "무슨 얘기인지" 알려야 한다.
 * 1챕터 사진을 돌려 쓰면 독살 사건에 해변 가족사진이 걸린다(실측).
 */
export async function fetchThumbBg(query: string): Promise<string | undefined> {
  if (!config.pexels.apiKey) return undefined;
  await fs.mkdir(BROLL_DIR, { recursive: true });
  const fileName = "lf-thumb-bg.jpg";
  const q = query.trim() || "dark object still life";
  const r = await downloadOne(q, path.join(BROLL_DIR, fileName), "landscape");
  console.log(`  🖼️  썸네일 배경 "${q}" → ${r.ok ? `broll/${fileName}` : "폴백(1챕터 사진)"}`);
  return r.ok ? `broll/${fileName}` : undefined;
}

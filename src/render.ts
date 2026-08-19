import path from "node:path";
import fs from "node:fs/promises";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { config } from "./config.js";
import type { ReelInputProps, LongformInputProps } from "./types.js";

let cachedServeUrl: string | null = null;

/** Remotion 프로젝트를 번들링 (최초 1회 캐시) */
async function getServeUrl(): Promise<string> {
  if (cachedServeUrl) return cachedServeUrl;
  cachedServeUrl = await bundle({
    entryPoint: config.paths.remotionEntry,
    // public/ 의 오디오 등 static 파일을 함께 serve
    publicDir: config.paths.public,
    // ESM `.js` 임포트를 실제 `.ts/.tsx` 로 해석하도록
    webpackOverride: (c) => ({
      ...c,
      resolve: {
        ...c.resolve,
        extensionAlias: {
          ".js": [".ts", ".tsx", ".js"],
          ".jsx": [".tsx", ".jsx"],
          ...(c.resolve?.extensionAlias ?? {}),
        },
      },
    }),
  });
  return cachedServeUrl;
}

/** 입력 props 로 릴스 mp4 를 렌더하고 파일 경로를 반환 */
export async function renderReel(
  inputProps: ReelInputProps,
  outFile = "reel.mp4",
): Promise<string> {
  await fs.mkdir(config.paths.out, { recursive: true });
  const serveUrl = await getServeUrl();

  const composition = await selectComposition({
    serveUrl,
    id: "MysteryReel",
    inputProps,
  });

  const outputLocation = path.join(config.paths.out, outFile);
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps,
    // 용량↓·속도↑ (인스타 업로드용으로 적당한 화질)
    crf: 24,
    x264Preset: "veryfast",
    jpegQuality: 80,
    concurrency: null, // 사용 가능한 코어 자동 활용
  });

  return outputLocation;
}

/** 롱폼(가로 1920x1080) 렌더 */
export async function renderLongform(
  inputProps: LongformInputProps,
  outFile = "longform.mp4",
): Promise<string> {
  await fs.mkdir(config.paths.out, { recursive: true });
  const serveUrl = await getServeUrl();
  const composition = await selectComposition({ serveUrl, id: "LongformDoc", inputProps });
  const outputLocation = path.join(config.paths.out, outFile);
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps,
    crf: 23,
    x264Preset: "veryfast",
    jpegQuality: 80,
    concurrency: null,
  });
  return outputLocation;
}

/** 롱폼 유튜브 커스텀 썸네일(1280x720) — 첫 프레임 추출이 아니라 전용 컴포지션 */
export async function renderLongformThumb(
  inputProps: LongformInputProps,
  outFile = "longform-thumb.jpg",
): Promise<string> {
  await fs.mkdir(config.paths.out, { recursive: true });
  const serveUrl = await getServeUrl();
  const composition = await selectComposition({ serveUrl, id: "LongformThumb", inputProps });
  const output = path.join(config.paths.out, outFile);
  await renderStill({ composition, serveUrl, output, inputProps, frame: 0, jpegQuality: 90 });
  return output;
}

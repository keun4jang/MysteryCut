import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseBuffer } from "music-metadata";
import { config } from "../config.js";
import type { NarratedSegment, ReelScript } from "../types.js";

const execFileAsync = promisify(execFile);

/**
 * 나레이션(TTS) 어시스트 — Python `edge-tts` CLI (무료, API 키 불필요).
 * Microsoft Edge 뉴럴 음성을 사용하며, 필요한 보안 토큰을 라이브러리가 처리합니다.
 *
 * 사전 설치: pipx install edge-tts   (또는 pip install edge-tts)
 */
export async function narrate(script: ReelScript): Promise<NarratedSegment[]> {
  await fs.mkdir(config.paths.audio, { recursive: true });
  await ensureEdgeTts();

  const result: NarratedSegment[] = [];
  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const fileName = `seg-${i}.mp3`;
    const absPath = path.join(config.paths.audio, fileName);

    await synthesizeToFile(seg.text, absPath);

    const bytes = await fs.readFile(absPath);
    const meta = await parseBuffer(new Uint8Array(bytes), { mimeType: "audio/mpeg" });
    const durationInSeconds = meta.format.duration ?? estimateDuration(seg.text);

    result.push({
      text: seg.text,
      emphasis: seg.emphasis,
      audioSrc: `audio/${fileName}`, // public/ 기준 상대경로 → staticFile()
      durationInSeconds,
    });
    console.log(
      `  🎙️  세그먼트 ${i + 1}/${script.segments.length} (${durationInSeconds.toFixed(1)}s)`,
    );
  }

  return result;
}

/** 한 문장을 edge-tts 로 합성해 파일로 저장 */
async function synthesizeToFile(text: string, absPath: string): Promise<void> {
  await execFileAsync("edge-tts", [
    "--voice",
    config.tts.voice,
    `--rate=${config.tts.rate}`,
    `--pitch=${config.tts.pitch}`,
    "--text",
    text,
    "--write-media",
    absPath,
  ]);
}

/** edge-tts 설치 여부 확인 (없으면 안내) */
async function ensureEdgeTts(): Promise<void> {
  try {
    await execFileAsync("edge-tts", ["--list-voices"]);
  } catch {
    throw new Error(
      "edge-tts 가 설치되어 있지 않습니다. `pipx install edge-tts` (또는 `pip install edge-tts`) 후 다시 실행하세요.",
    );
  }
}

/** 길이 측정 실패 시 대략적인 한국어 낭독 길이 추정 (초) */
function estimateDuration(text: string): number {
  const chars = text.replace(/\s/g, "").length;
  return Math.max(1.5, chars / 6);
}

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseBuffer } from "music-metadata";
import { config } from "../config.js";
import type { NarratedSegment, ReelScript } from "../types.js";

const execFileAsync = promisify(execFile);

/**
 * 나레이션(TTS) 어시스트.
 *  - google: Google Cloud TTS Neural2 (무료 등급, 더 자연스러움) — GOOGLE_TTS_API_KEY 필요
 *  - edge  : Python edge-tts CLI (무료, 키 불필요)   ← 기본
 */
export async function narrate(script: ReelScript): Promise<NarratedSegment[]> {
  await fs.mkdir(config.paths.audio, { recursive: true });
  const provider = config.tts.provider;
  if (provider === "edge") await ensureEdgeTts();
  console.log(`  🔊 TTS 제공자: ${provider}`);

  const result: NarratedSegment[] = [];
  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const fileName = `seg-${i}.mp3`;
    const absPath = path.join(config.paths.audio, fileName);

    if (provider === "google") await synthesizeGoogle(seg.text, absPath);
    else await synthesizeEdge(seg.text, absPath);

    const bytes = await fs.readFile(absPath);
    const meta = await parseBuffer(new Uint8Array(bytes), { mimeType: "audio/mpeg" });
    const durationInSeconds = meta.format.duration ?? estimateDuration(seg.text);

    result.push({
      text: seg.text,
      emphasis: seg.emphasis,
      audioSrc: `audio/${fileName}`,
      durationInSeconds,
      visualQuery: seg.visualQuery,
    });
    console.log(
      `  🎙️  세그먼트 ${i + 1}/${script.segments.length} (${durationInSeconds.toFixed(1)}s)`,
    );
  }
  return result;
}

/** Google Cloud TTS (REST + API 키) — 자연스러운 Neural2 음성 */
async function synthesizeGoogle(text: string, absPath: string): Promise<void> {
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${config.tts.google.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "ko-KR", name: config.tts.google.voice },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: config.tts.google.speakingRate,
          pitch: config.tts.google.pitch,
        },
      }),
    },
  );
  const json = (await res.json()) as { audioContent?: string; error?: unknown };
  if (!res.ok || !json.audioContent) {
    throw new Error(`Google TTS 실패: ${JSON.stringify(json).slice(0, 300)}`);
  }
  await fs.writeFile(absPath, Buffer.from(json.audioContent, "base64"));
}

/** Python edge-tts CLI */
async function synthesizeEdge(text: string, absPath: string): Promise<void> {
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

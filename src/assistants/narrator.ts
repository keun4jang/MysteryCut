import fs from "node:fs/promises";
import path from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { parseBuffer } from "music-metadata";
import { config } from "../config.js";
import type { NarratedSegment, ReelScript } from "../types.js";

/**
 * 나레이션(TTS) 어시스트 — Microsoft Edge TTS (무료, API 키 불필요).
 * 각 세그먼트를 한국어 뉴럴 음성으로 합성해 public/audio/ 에 저장하고,
 * 자막 싱크를 위해 오디오 길이를 측정합니다.
 */
export async function narrate(script: ReelScript): Promise<NarratedSegment[]> {
  await fs.mkdir(config.paths.audio, { recursive: true });

  const tts = new MsEdgeTTS();
  await tts.setMetadata(config.tts.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const result: NarratedSegment[] = [];
  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const fileName = `seg-${i}.mp3`;
    const absPath = path.join(config.paths.audio, fileName);

    const audio = await synthesize(tts, seg.text);
    await fs.writeFile(absPath, audio);

    const meta = await parseBuffer(new Uint8Array(audio), { mimeType: "audio/mpeg" });
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

/** 한 문장을 mp3 바이트로 합성 */
function synthesize(tts: MsEdgeTTS, text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = tts.toStream(text, {
      rate: config.tts.rate,
      pitch: config.tts.pitch,
    });
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("close", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/** 길이 측정 실패 시 대략적인 한국어 낭독 길이 추정 (초) */
function estimateDuration(text: string): number {
  const chars = text.replace(/\s/g, "").length;
  return Math.max(1.5, chars / 6);
}

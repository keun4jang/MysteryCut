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
export interface VoiceOverride {
  voice: string;
  rate: string;
  pitch: string;
}

export async function narrate(
  script: ReelScript,
  voiceOverride?: VoiceOverride,
): Promise<NarratedSegment[]> {
  await fs.mkdir(config.paths.audio, { recursive: true });
  const provider = config.tts.provider;
  if (provider === "edge") await ensureEdgeTts();
  console.log(`  🔊 TTS 제공자: ${provider}`);
  if (voiceOverride) {
    console.log(
      `  🎭 보이스 로테이션: ${voiceOverride.voice} (rate ${voiceOverride.rate}, pitch ${voiceOverride.pitch})`,
    );
  }

  // Google TTS 무료 한도 보호: 영상 1개당 글자수 상한
  if (provider === "google") {
    const totalChars = script.segments.reduce((a, s) => a + s.text.length, 0);
    const cap = config.tts.google.maxCharsPerRun;
    console.log(`  🔒 Google TTS 글자수 ${totalChars} / 상한 ${cap}`);
    if (totalChars > cap) {
      throw new Error(
        `Google TTS 안전 한도 초과: 이번 영상 ${totalChars}자 > 상한 ${cap}자. 무료 한도 보호를 위해 중단합니다.`,
      );
    }
  }

  const result: NarratedSegment[] = [];
  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const fileName = `seg-${i}.mp3`;
    const rawPath = path.join(config.paths.audio, `seg-${i}.raw.mp3`);
    const absPath = path.join(config.paths.audio, fileName);

    if (provider === "google") await synthesizeGoogle(seg.text, rawPath);
    else await synthesizeEdge(seg.text, rawPath, voiceOverride);

    // 문장 앞뒤 무음(edge-tts 패딩) 제거 → 문장 사이 로봇 같은 공백 없앰.
    // 사이 '숨'은 Remotion 타임라인에서 일정 간격으로 다시 넣는다(timing.ts).
    await trimSilence(rawPath, absPath);

    const bytes = await fs.readFile(absPath);
    const meta = await parseBuffer(new Uint8Array(bytes), { mimeType: "audio/mpeg" });
    const durationInSeconds = meta.format.duration ?? estimateDuration(seg.text);

    result.push({
      text: seg.text,
      textEn: seg.textEn,
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

/**
 * 오디오 앞뒤 무음을 잘라낸다(양끝 80ms 는 자음 어택 보호용으로 남김).
 * ffmpeg 2-패스: 앞 트림 → 뒤집어 뒤 트림 → 원복. ffmpeg 가 없거나 실패하면 원본을 그대로 쓴다.
 */
async function trimSilence(src: string, dst: string): Promise<void> {
  const filter =
    "silenceremove=start_periods=1:start_silence=0.08:start_threshold=-45dB:detection=peak," +
    "areverse," +
    "silenceremove=start_periods=1:start_silence=0.08:start_threshold=-45dB:detection=peak," +
    "areverse";
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      src,
      "-af",
      filter,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      dst,
    ]);
    // 트리밍이 과해 사실상 비면(전부 무음 등) 원본으로 폴백
    const st = await fs.stat(dst);
    if (st.size < 512) throw new Error("트리밍 결과가 비정상적으로 작음");
  } catch {
    await fs.copyFile(src, dst); // ffmpeg 미설치/실패 → 원본 사용(파이프라인 계속)
  }
}

/** Google Cloud TTS (REST + API 키). Chirp3-HD 딥보이스 우선, 실패 시 Neural2 폴백 */
async function synthesizeGoogle(text: string, absPath: string): Promise<void> {
  const g = config.tts.google;
  try {
    const audio = await googleSynthOnce(text, g.voice);
    await fs.writeFile(absPath, Buffer.from(audio, "base64"));
  } catch (e) {
    // Chirp3-HD 음성이 실패(미지원/오류)하면 남성 Neural2 로 폴백
    if (g.fallbackVoice && g.fallbackVoice !== g.voice) {
      console.log(`  ⚠️ Google TTS(${g.voice}) 실패 → ${g.fallbackVoice} 로 폴백`);
      const audio = await googleSynthOnce(text, g.fallbackVoice);
      await fs.writeFile(absPath, Buffer.from(audio, "base64"));
    } else {
      throw e;
    }
  }
}

/** 단일 음성으로 Google TTS 1회 호출 → base64 오디오. Chirp3-HD 는 pitch 미지원이라 제외 */
async function googleSynthOnce(text: string, voice: string): Promise<string> {
  const g = config.tts.google;
  const isChirp = /chirp/i.test(voice);
  const audioConfig: Record<string, unknown> = {
    audioEncoding: "MP3",
    speakingRate: g.speakingRate,
  };
  if (!isChirp) audioConfig.pitch = g.pitch; // Chirp3-HD 는 pitch 파라미터 미지원

  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${g.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "ko-KR", name: voice },
        audioConfig,
      }),
    },
  );
  const json = (await res.json()) as { audioContent?: string; error?: unknown };
  if (!res.ok || !json.audioContent) {
    throw new Error(`Google TTS 실패(${voice}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json.audioContent;
}

/** Python edge-tts CLI (보이스 로테이션 오버라이드 지원) */
async function synthesizeEdge(
  text: string,
  absPath: string,
  ov?: VoiceOverride,
): Promise<void> {
  await execFileAsync("edge-tts", [
    "--voice",
    ov?.voice ?? config.tts.voice,
    `--rate=${ov?.rate ?? config.tts.rate}`,
    `--pitch=${ov?.pitch ?? config.tts.pitch}`,
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

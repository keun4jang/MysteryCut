import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseBuffer } from "music-metadata";
import { config } from "../config.js";
import { toSpeechText } from "../lib/speech.js";
import { assignScenes, sceneStats } from "../lib/scenes.js";
import type { NarratedSegment, ReelScript, LongformScript, NarratedChapter } from "../types.js";

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

  // 비주얼 챕터 정규화 — LLM 의 scene 번호를 0부터 연속으로 보정 (broll 이 장면당 사진 1장)
  const scenes = assignScenes(script.segments);
  {
    const { scenes: n, avgShots } = sceneStats(scenes);
    console.log(`  🎬 비주얼 챕터 ${n}개 (장면당 평균 ${avgShots.toFixed(1)}컷)`);
  }

  const result: NarratedSegment[] = [];
  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const fileName = `seg-${i}.mp3`;
    const rawPath = path.join(config.paths.audio, `seg-${i}.raw.mp3`);
    const absPath = path.join(config.paths.audio, fileName);

    // 자막은 '3km' 그대로 두고, 읽을 때만 '3킬로미터'로 풀어 준다
    const spoken = toSpeechText(seg.text);
    if (spoken !== seg.text) console.log(`     🗣️  발음 변환: ${spoken.slice(0, 60)}`);

    if (provider === "google") await synthesizeGoogle(spoken, rawPath);
    else await synthesizeEdgeResilient(spoken, rawPath, voiceOverride);

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
      sceneIndex: scenes[i].sceneIndex,
      shot: scenes[i].shot,
    });
    console.log(
      `  🎙️  세그먼트 ${i + 1}/${script.segments.length} (${durationInSeconds.toFixed(1)}s)`,
    );
  }
  return result;
}

/**
 * 롱폼 나레이션 — 챕터 단위로 합성한다.
 *
 * 쇼츠와 속도가 다르다. 쇼츠는 +24~28% 로 몰아치지만, 8분을 그 속도로 들으면
 * 피로해서 중간에 나간다. 롱폼은 +8% 로 읽고 문장 사이 호흡을 길게 준다.
 * 보이스도 매번 랜덤이 아니라 하나로 고정한다 — 진행자가 매번 바뀌면
 * 다큐로서 신뢰가 생기지 않는다.
 */
export async function narrateLongform(
  script: LongformScript,
  voiceOverride?: VoiceOverride,
): Promise<NarratedChapter[]> {
  await fs.mkdir(config.paths.audio, { recursive: true });
  const provider = config.tts.provider;
  if (provider === "edge") await ensureEdgeTts();
  console.log(`  🔊 TTS 제공자: ${provider}`);
  if (voiceOverride) {
    console.log(
      `  🎭 롱폼 보이스: ${voiceOverride.voice} (rate ${voiceOverride.rate}, pitch ${voiceOverride.pitch})`,
    );
  }

  if (provider === "google") {
    const totalChars = script.chapters.reduce(
      (a, c) => a + c.segments.reduce((b, g) => b + g.text.length, 0),
      0,
    );
    const cap = config.tts.google.maxCharsPerRun;
    if (totalChars > cap) {
      throw new Error(
        `Google TTS 안전 한도 초과: 이번 영상 ${totalChars}자 > 상한 ${cap}자. 무료 한도 보호를 위해 중단합니다.`,
      );
    }
  }

  const out: NarratedChapter[] = [];
  let done = 0;
  const total = script.chapters.reduce((n, c) => n + c.segments.length, 0);

  for (let ci = 0; ci < script.chapters.length; ci++) {
    const ch = script.chapters[ci];
    const segments: NarratedChapter["segments"] = [];

    for (let si = 0; si < ch.segments.length; si++) {
      const seg = ch.segments[si];
      const fileName = `lf-${ci}-${si}.mp3`;
      const rawPath = path.join(config.paths.audio, `lf-${ci}-${si}.raw.mp3`);
      const absPath = path.join(config.paths.audio, fileName);

      const spoken = toSpeechText(seg.text);
      if (provider === "google") await synthesizeGoogle(spoken, rawPath);
      else await synthesizeEdgeResilient(spoken, rawPath, voiceOverride);
      await trimSilence(rawPath, absPath);

      const bytes = await fs.readFile(absPath);
      const meta = await parseBuffer(new Uint8Array(bytes), { mimeType: "audio/mpeg" });
      segments.push({
        text: seg.text,
        textEn: seg.textEn,
        emphasis: seg.emphasis,
        audioSrc: `audio/${fileName}`,
        durationInSeconds: meta.format.duration ?? estimateDuration(seg.text),
        // 게이트를 통과한 visual 만 남아 있는 상태다 (normalizeVisuals 가 앞에서 걸렀다)
        frame: seg.frame as NarratedChapter["segments"][0]["frame"],
      });
      done += 1;
    }

    out.push({
      heading: ch.heading,
      visualQuery: ch.visualQuery,
      segments,
    });
    const secs = segments.reduce((a, g) => a + g.durationInSeconds, 0);
    console.log(
      `  🎙️  챕터 ${ci + 1}/${script.chapters.length} "${ch.heading}" — ${segments.length}컷 ${secs.toFixed(1)}초 (${done}/${total})`,
    );
  }
  return out;
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
  await execFileAsync(
    "edge-tts",
    [
      "--voice",
      ov?.voice ?? config.tts.voice,
      `--rate=${ov?.rate ?? config.tts.rate}`,
      `--pitch=${ov?.pitch ?? config.tts.pitch}`,
      "--text",
      text,
      "--write-media",
      absPath,
    ],
    // 문장 하나(≤40자)는 정상일 때 몇 초면 끝난다. 타임아웃이 없으면 서버가
    // 응답을 안 주는 채로 매달릴 때 잡 전체(180분)를 소모한다 — 90초면 죽이고
    // 재시도 루프(synthesizeEdgeResilient)가 받는 편이 낫다.
    { timeout: 90_000 },
  );
}

/**
 * edge-tts 는 Microsoft 공식 API 가 아니라 Edge 브라우저 읽어주기 기능을
 * 역공학한 비공식 라이브러리다. Microsoft 가 엔드포인트/인증을 바꾸면 그날로
 * 깨질 수 있고, 나레이션이 죽으면 게시 전체가 실패한다. 5년 무인 운영을 버티기
 * 위해 (1) 일시적 오류는 재시도하고 (2) 계속 실패하면 완전히 다른 벤더(구글
 * 번역 무료 TTS)로 전환한다. 두 서비스가 같은 날 동시에 깨질 확률은 낮다.
 */
async function synthesizeEdgeResilient(
  text: string,
  absPath: string,
  ov?: VoiceOverride,
): Promise<void> {
  const MAX_RETRIES = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await synthesizeEdge(text, absPath, ov);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES - 1) {
        const wait = 2000 * (attempt + 1);
        console.warn(
          `  ⚠️ edge-tts 실패(${attempt + 1}/${MAX_RETRIES}) — ${wait / 1000}s 후 재시도: ${e instanceof Error ? e.message : e}`,
        );
        await sleep(wait);
      }
    }
  }
  console.warn(
    `  ⚠️ edge-tts ${MAX_RETRIES}회 연속 실패 — 대체 TTS(Google 번역 무료 음성)로 전환합니다.`,
  );
  try {
    await synthesizeGoogleTranslateTts(text, absPath);
    console.log("  🔁 대체 TTS 로 합성 완료");
  } catch (e2) {
    throw new Error(
      `edge-tts 와 대체 TTS 모두 실패했습니다. edge-tts: ${lastErr instanceof Error ? lastErr.message : lastErr} / 대체 TTS: ${e2 instanceof Error ? e2.message : e2}`,
    );
  }
}

/**
 * 최후 폴백: Google 번역의 비공식 무료 TTS 엔드포인트(API 키·과금 없음).
 * 요청당 글자수 제한이 있어 문장 단위로 쪼개 각각 합성한 뒤 이어붙인다.
 * (품질은 edge-tts 보다 떨어지지만, '게시가 아예 안 되는 것'보다는 낫다)
 */
async function synthesizeGoogleTranslateTts(text: string, absPath: string): Promise<void> {
  const chunks = splitForGtts(text);
  const tmpFiles = chunks.map((_, i) => `${absPath}.gtts-${i}.mp3`);
  try {
    for (let i = 0; i < chunks.length; i++) {
      await fetchGttsChunk(chunks[i], tmpFiles[i]);
    }
    if (tmpFiles.length === 1) {
      await fs.copyFile(tmpFiles[0], absPath);
    } else {
      await concatMp3(tmpFiles, absPath);
    }
  } finally {
    await Promise.all(tmpFiles.map((f) => fs.rm(f, { force: true }).catch(() => {})));
  }
}

/** 문장 단위로 쪼개되, 각 조각을 대략 60자(한글 기준) 이내로 유지 */
function splitForGtts(text: string, maxChars = 60): string[] {
  // 쉼표도 분할 지점에 포함 — 종결부호 없는 긴 문장이 어색한 위치에서 잘리는 것을 방지
  const sentences = text.split(/(?<=[.?!,、。！？，])\s*/).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > maxChars) {
      if (cur) chunks.push(cur.trim());
      if (s.length > maxChars) {
        for (let i = 0; i < s.length; i += maxChars) chunks.push(s.slice(i, i + maxChars));
        cur = "";
      } else {
        cur = s;
      }
    } else {
      cur += s;
    }
  }
  if (cur) chunks.push(cur.trim());
  return chunks.length ? chunks : [text];
}

async function fetchGttsChunk(text: string, dst: string): Promise<void> {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=ko&client=tw-ob`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(30_000), // 매달림 방지 — 짧은 문장 TTS 가 30초를 넘길 이유가 없다
  });
  if (!res.ok) throw new Error(`대체 TTS 요청 실패: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 256) throw new Error("대체 TTS 응답이 비정상적으로 작습니다");
  await fs.writeFile(dst, buf);
}

/** 여러 mp3 조각을 하나로 이어붙임(재인코딩 방식이라 조각 간 포맷 차이에도 안전) */
async function concatMp3(files: string[], dst: string): Promise<void> {
  const args: string[] = ["-y"];
  for (const f of files) args.push("-i", f);
  const filter = files.map((_, i) => `[${i}:a]`).join("") + `concat=n=${files.length}:v=0:a=1[out]`;
  args.push("-filter_complex", filter, "-map", "[out]", dst);
  await execFileAsync("ffmpeg", args);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * edge-tts 설치 여부만 확인한다.
 *
 * ★예전엔 `--list-voices` 로 확인했는데, 이건 설치 확인이 아니라 실제 네트워크
 * 호출이다(edge_tts/voices.py 가 MS 음성 목록 엔드포인트에 GET, 재시도·타임아웃
 * 없음). 이 preflight 는 narrate()/narrateLongform() 맨 앞, 아래에 애써 만든
 * synthesizeEdgeResilient(재시도 3회 + 구글번역 TTS 폴백)가 한 번도 실행되기 전에
 * 돈다 — MS 엔드포인트가 잠깐만 삐끗해도 전체 리질리언스 체계를 건너뛰고
 * 그날 TTS/게시가 통째로 죽는다(감사에서 확인된 high 등급 결함). `--version`
 * 은 로컬 패키지 메타데이터만 읽어 네트워크를 타지 않는다 — 설치 여부 확인
 * 목적에는 그걸로 충분하다.
 */
async function ensureEdgeTts(): Promise<void> {
  try {
    await execFileAsync("edge-tts", ["--version"], { timeout: 15_000 });
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

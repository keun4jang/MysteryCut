/**
 * '감동 실화' 편 배경음악(public/bgm/warm*.mp3)을 코드로 합성한다.
 *
 * 기존 eerie*.mp3 처럼 자체 합성 음원이라 저작권 클레임이 걸리지 않는다.
 * 잔잔한 장조 화성 진행 위에 패드·베이스·피아노풍 아르페지오를 얹고 리버브를 건다.
 * 끝의 잔향을 앞부분에 겹쳐 넣어(랩어라운드) 영상에서 loop 로 반복해도 이음매가 없다.
 * 음량은 기존 eerie 트랙 실측(RMS 약 -19 dBFS)에 맞춘다.
 *
 * 사용: npx tsx scripts/makeWarmBgm.mts   (ffmpeg 필요 — 없으면 FFMPEG 환경변수로 경로 지정)
 */
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";

const SR = 44100;
const TARGET_RMS_DB = -19;

interface Chord {
  bass: number;
  pad: number[];
  arp: number[];
}
interface Track {
  file: string;
  bpm: number;
  chords: Chord[];
  seed: number;
}

// MIDI 번호. 2마디(8박)에 화음 하나, 8개 화음이 한 바퀴.
const TRACKS: Track[] = [
  {
    file: "public/bgm/warm.mp3",
    bpm: 72,
    seed: 7,
    chords: [
      { bass: 48, pad: [60, 64, 67], arp: [60, 64, 67, 72] }, // C
      { bass: 47, pad: [59, 62, 67], arp: [62, 67, 71, 74] }, // G/B
      { bass: 45, pad: [57, 60, 64], arp: [57, 60, 64, 69] }, // Am
      { bass: 43, pad: [55, 59, 64], arp: [59, 64, 67, 71] }, // Em/G
      { bass: 41, pad: [57, 60, 65], arp: [60, 65, 69, 72] }, // F
      { bass: 40, pad: [55, 60, 64], arp: [60, 64, 67, 72] }, // C/E
      { bass: 38, pad: [57, 60, 62, 65], arp: [62, 65, 69, 72] }, // Dm7
      { bass: 43, pad: [55, 59, 62, 65], arp: [59, 62, 67, 71] }, // G7 → C
    ],
  },
  {
    file: "public/bgm/warm2.mp3",
    bpm: 66,
    seed: 23,
    chords: [
      { bass: 41, pad: [57, 60, 65], arp: [60, 65, 69, 72] }, // F
      { bass: 40, pad: [57, 60, 64], arp: [57, 64, 69, 72] }, // Am/E
      { bass: 38, pad: [57, 62, 65], arp: [62, 65, 69, 74] }, // Dm
      { bass: 46, pad: [58, 62, 65], arp: [58, 62, 65, 70] }, // Bb
      { bass: 45, pad: [57, 60, 65], arp: [60, 65, 69, 72] }, // F/A
      { bass: 43, pad: [58, 62, 65, 67], arp: [62, 65, 67, 70] }, // Gm7
      { bass: 48, pad: [60, 65, 67], arp: [60, 65, 67, 72] }, // Csus4
      { bass: 48, pad: [60, 64, 67, 70], arp: [60, 64, 67, 70] }, // C7 → F
    ],
  },
];

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** 결정론적 난수 — 같은 입력이면 항상 같은 음원 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function render(track: Track): { L: Float32Array; R: Float32Array } {
  const beat = 60 / track.bpm;
  const chordLen = beat * 8;
  const loopSec = chordLen * track.chords.length;
  const tail = 6;
  const n = Math.ceil((loopSec + tail) * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rand = rng(track.seed);

  const add = (t0: number, dur: number, pan: number, f: (t: number) => number) => {
    const i0 = Math.floor(t0 * SR);
    const len = Math.floor(dur * SR);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let k = 0; k < len && i0 + k < n; k++) {
      const v = f(k / SR);
      L[i0 + k] += v * gl;
      R[i0 + k] += v * gr;
    }
  };

  track.chords.forEach((c, ci) => {
    const t0 = ci * chordLen;
    // 패드 — 느린 어택, 길게 남는 릴리스. 좌우로 살짝 어긋난 두 음으로 폭을 만든다.
    const padDur = chordLen + 2.5;
    for (const m of c.pad) {
      for (const [cents, pan] of [[-4, -0.4], [4, 0.4]] as const) {
        const f = hz(m) * Math.pow(2, cents / 1200);
        add(t0, padDur, pan, (t) => {
          const env = Math.min(1, t / 1.8) * Math.min(1, Math.max(0, (padDur - t) / 2.5));
          const w = 2 * Math.PI * f * t;
          return 0.045 * env * (Math.sin(w) + 0.22 * Math.sin(2 * w) + 0.06 * Math.sin(3 * w));
        });
      }
    }
    // 베이스 — 근음 하나를 부드럽게
    const bassDur = chordLen + 1.2;
    add(t0, bassDur, 0, (t) => {
      const env = Math.min(1, t / 0.35) * Math.min(1, Math.max(0, (bassDur - t) / 1.2));
      const w = 2 * Math.PI * hz(c.bass) * t;
      return 0.11 * env * (Math.sin(w) + 0.15 * Math.sin(2 * w));
    });
    // 피아노풍 아르페지오 — 4분음표, 마지막 박은 쉰다
    const pattern = [0, 1, 2, 3, 2, 1, 2, -1];
    pattern.forEach((idx, b) => {
      if (idx < 0) return;
      const f = hz(c.arp[idx]);
      const vel = 0.055 + rand() * 0.02;
      const pan = (rand() - 0.5) * 0.5;
      add(t0 + b * beat + rand() * 0.012, 3.2, pan, (t) => {
        const env = Math.min(1, t / 0.008) * Math.exp(-t / 1.1);
        const w = 2 * Math.PI * f * t;
        return vel * env * (Math.sin(w) + 0.35 * Math.exp(-t * 3) * Math.sin(2 * w) + 0.1 * Math.exp(-t * 5) * Math.sin(3 * w));
      });
    });
  });

  reverb(L, R);

  // 랩어라운드: 한 바퀴 뒤로 넘친 잔향을 앞부분에 더해 반복 재생 이음매를 없앤다
  const loopN = Math.floor(loopSec * SR);
  for (let k = loopN; k < n; k++) {
    L[k - loopN] += L[k];
    R[k - loopN] += R[k];
  }
  return { L: L.slice(0, loopN), R: R.slice(0, loopN) };
}

/** 슈뢰더 리버브(콤 4 + 올패스 2). 좌우 지연을 조금 달리해 공간감을 낸다. */
function reverb(L: Float32Array, R: Float32Array): void {
  const wet = 0.32;
  const run = (x: Float32Array, spread: number) => {
    const out = new Float32Array(x.length);
    for (const [ms, fb] of [[29.7, 0.8], [37.1, 0.79], [41.1, 0.78], [43.7, 0.77]]) {
      const d = Math.floor(((ms + spread) / 1000) * SR);
      const buf = new Float32Array(d);
      let lp = 0;
      for (let i = 0, p = 0; i < x.length; i++, p = (p + 1) % d) {
        const y = buf[p];
        lp = y * 0.7 + lp * 0.3; // 감쇠를 고음부터 — 잔향이 날카롭지 않게
        buf[p] = x[i] + lp * fb;
        out[i] += y * 0.25;
      }
    }
    for (const [ms, g] of [[5.0, 0.7], [1.7, 0.7]]) {
      const d = Math.floor(((ms + spread / 4) / 1000) * SR);
      const buf = new Float32Array(d);
      for (let i = 0, p = 0; i < out.length; i++, p = (p + 1) % d) {
        const b = buf[p];
        const y = -g * out[i] + b;
        buf[p] = out[i] + g * y;
        out[i] = y;
      }
    }
    return out;
  };
  const wl = run(L, 0);
  const wr = run(R, 1.3);
  for (let i = 0; i < L.length; i++) {
    L[i] = L[i] * (1 - wet) + wl[i] * wet;
    R[i] = R[i] * (1 - wet) + wr[i] * wet;
  }
}

function normalize(L: Float32Array, R: Float32Array): { rmsDb: number; peakDb: number } {
  let sum = 0;
  for (let i = 0; i < L.length; i++) sum += L[i] * L[i] + R[i] * R[i];
  const rms = Math.sqrt(sum / (2 * L.length));
  const g = Math.pow(10, TARGET_RMS_DB / 20) / rms;
  let peak = 0;
  for (let i = 0; i < L.length; i++) {
    // 피크만 부드럽게 눌러 클리핑을 막는다(-3 dBFS 근처부터)
    L[i] = Math.tanh(L[i] * g * 1.2) / 1.2;
    R[i] = Math.tanh(R[i] * g * 1.2) / 1.2;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  let s2 = 0;
  for (let i = 0; i < L.length; i++) s2 += L[i] * L[i] + R[i] * R[i];
  return { rmsDb: 20 * Math.log10(Math.sqrt(s2 / (2 * L.length))), peakDb: 20 * Math.log10(peak) };
}

function wav(L: Float32Array, R: Float32Array): Buffer {
  const data = Buffer.alloc(L.length * 4);
  for (let i = 0; i < L.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
for (const track of TRACKS) {
  const { L, R } = render(track);
  const { rmsDb, peakDb } = normalize(L, R);
  const tmp = track.file.replace(/\.mp3$/, ".tmp.wav");
  await fs.writeFile(tmp, wav(L, R));
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", tmp, "-c:a", "libmp3lame", "-b:a", "160k", track.file]);
  await fs.rm(tmp);
  console.log(`🎵 ${track.file}: ${(L.length / SR).toFixed(1)}초, RMS ${rmsDb.toFixed(1)} dBFS, 피크 ${peakDb.toFixed(1)} dBFS`);
}

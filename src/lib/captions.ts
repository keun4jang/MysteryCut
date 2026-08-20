import { longformBreathSeconds } from "../remotion/timing.js";
import type { NarratedChapter } from "../types.js";

/**
 * 롱폼 자막 트랙(SRT) 생성.
 *
 * 왜 직접 만드는가 — 두 가지를 한 번에 해결한다.
 *
 * ① 자동자막(ASR) 억제. 유튜브는 올린 영상마다 음성을 인식해 '자동 생성됨'
 *    자막을 만든다. 그게 화면에 구워 넣은 자막과 겹쳐 두 겹으로 보인다.
 *    같은 언어의 수동 자막 트랙이 있으면 유튜브는 그쪽을 쓴다.
 * ② 정확도. ASR 은 고유명사·연도·법률 용어를 자주 틀리는데, 우리는 원본
 *    문장을 그대로 갖고 있으므로 100% 정확한 자막을 낼 수 있다. 자막은
 *    유튜브가 영상 내용을 이해하는 주요 신호라 추천에도 유리하다.
 *
 * 타이밍은 LongformDoc 의 시퀀스 계산과 **같은 식**을 써야 한다. 여기서
 * 어긋나면 화면 자막과 CC 가 서로 다른 시점에 뜬다. 그래서 프레임 단위로
 * 컴포지션과 동일하게 계산한 뒤 초로 되돌린다.
 * (호흡 구간은 무음이므로 자막 큐에 포함하지 않는다 — 문장 사이에 자막이
 *  잠깐 사라지는 편이 읽기에 낫다)
 */
export function longformSrt(chapters: NarratedChapter[], fps = 30): string {
  const cues: Array<{ start: number; end: number; text: string }> = [];
  let f = 0;

  for (const chapter of chapters) {
    chapter.segments.forEach((seg, i) => {
      const audioFrames = Math.max(1, Math.round(seg.durationInSeconds * fps));
      const breathFrames = Math.round(
        longformBreathSeconds(seg.emphasis, i === chapter.segments.length - 1) * fps,
      );
      const text = seg.text.trim();
      if (text) cues.push({ start: f / fps, end: (f + audioFrames) / fps, text });
      f += audioFrames + breathFrames;
    });
  }

  return cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${wrapCue(c.text)}\n`)
    .join("\n");
}

/** 00:01:23,456 */
function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

/**
 * 긴 문장은 두 줄로 나눈다 — 유튜브 자막 창이 한 줄에 32자쯤에서 접히는데,
 * 어디서 접힐지를 유튜브에 맡기면 어절 중간에서 잘린다. 어절 경계에서
 * 우리가 나눠 준다. (한국어는 공백 기준 어절이 곧 읽기 단위)
 */
function wrapCue(text: string, maxPerLine = 26): string {
  if (text.length <= maxPerLine) return text;
  const words = text.split(/\s+/);
  const half = text.length / 2;
  let best = "";
  let bestDiff = Infinity;
  let acc = "";
  for (let i = 0; i < words.length - 1; i++) {
    acc = acc ? `${acc} ${words[i]}` : words[i];
    const diff = Math.abs(acc.length - half);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = acc;
    }
  }
  if (!best) return text;
  return `${best}\n${text.slice(best.length).trim()}`;
}

import {
  LONGFORM_OPENER_LEAD,
  breathFramesAfter,
  longformSegmentFrames,
  THUMB_FRAMES,
} from "../remotion/timing.js";
import type { NarratedChapter, NarratedSegment } from "../types.js";

/**
 * 자막 트랙(SRT) 생성.
 *
 * 왜 직접 만드는가 — 정확도 때문이다.
 *
 * 유튜브는 올린 영상마다 음성을 인식해 '자동 생성됨'(ASR) 자막을 만드는데,
 * 연도·인명·법률 용어를 자주 틀린다("사형" → "사영", "1948년" → "1940년" 같은
 * 오인식). 우리는 나레이션 원문을 그대로 갖고 있으므로 100% 정확한 자막을
 * 낼 수 있고, CC 를 켜는 시청자는 그쪽을 보게 된다.
 *
 * 주의 — 이걸 올려도 ASR 트랙이 사라지지는 않는다. 유튜브는 한 영상에 같은
 * 언어의 트랙을 여러 개 두는 구조라 수동 트랙이 ASR 을 '대체'하는 동작 자체가
 * 없다(실측 확인). ASR 을 없애려면 유튜브 스튜디오 > 자막에서 자동 생성 트랙을
 * 직접 지워야 하고, API 로 끄는 방법은 없다. 그래서 화면 자막과 CC 가 겹치지
 * 않게 하는 일은 자막 트랙이 아니라 **화면 배치**로 푼다(LongformDoc 의 안전선).
 *
 * 타이밍은 LongformDoc 의 시퀀스 계산과 **같은 식**을 써야 한다. 여기서
 * 어긋나면 화면 자막과 CC 가 서로 다른 시점에 뜬다. 그래서 프레임 단위로
 * 컴포지션과 동일하게 계산한 뒤 초로 되돌린다.
 * (호흡 구간은 무음이므로 자막 큐에 포함하지 않는다 — 문장 사이에 자막이
 *  잠깐 사라지는 편이 읽기에 낫다)
 */
export function longformSrt(chapters: NarratedChapter[], fps = 30, lang: "ko" | "en" = "ko"): string {
  const cues: Array<{ start: number; end: number; text: string }> = [];
  let f = 0;

  for (const chapter of chapters) {
    f += LONGFORM_OPENER_LEAD; // 챕터 오프너 여백 — 컴포지션과 같은 값이어야 싱크가 맞는다
    chapter.segments.forEach((seg, i) => {
      // 자막은 소리 내어 읽는 부분(오디오)에만 걸어야 한다. 화면 표시 길이는
      // support 를 읽을 시간만큼 더 길어질 수 있지만(longformSegmentFrames),
      // 그 늘어난 몫까지 자막을 띄우면 이미 끝난 문장을 계속 띄우는 꼴이 된다.
      const audioFrames = Math.max(1, Math.round(seg.durationInSeconds * fps));
      const text = (lang === "en" ? (seg.textEn ?? "") : seg.text).trim();
      if (text) cues.push({ start: f / fps, end: (f + audioFrames) / fps, text });
      f += longformSegmentFrames(seg, i === chapter.segments.length - 1, fps);
    });
  }

  return toSrt(cues);
}

function toSrt(cues: Array<{ start: number; end: number; text: string }>): string {
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
  // 라틴 문자는 한글보다 좁아 한 줄에 두 배쯤 들어간다
  if (!/[가-힣]/.test(text)) maxPerLine = 52;
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

/**
 * 쇼츠 자막 트랙(SRT).
 *
 * 쇼츠 화면 자막은 세로 중앙에 있고 유튜브 CC 는 아래쪽에 뜨므로 서로 겹치지
 * 않는다. 그래서 쇼츠에는 '자동자막을 가리는' 목적이 없고, 순수하게 정확한
 * 자막을 제공하는 목적만 있다.
 */
export function reelSrt(
  segments: NarratedSegment[],
  hasThumb: boolean,
  fps = 30,
  lang: "ko" | "en" = "ko",
): string {
  const cues: Array<{ start: number; end: number; text: string }> = [];
  let f = hasThumb ? THUMB_FRAMES : 0;

  segments.forEach((seg, i) => {
    const audioFrames = Math.max(1, Math.round(seg.durationInSeconds * fps));
    const breath = i < segments.length - 1 ? breathFramesAfter(seg.emphasis, fps) : 0;
    const text = (lang === "en" ? (seg.textEn ?? "") : seg.text).trim();
    if (text) cues.push({ start: f / fps, end: (f + audioFrames) / fps, text });
    f += audioFrames + breath;
  });

  return toSrt(cues);
}

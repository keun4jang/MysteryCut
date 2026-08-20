/**
 * 자막(SRT) 타이밍이 화면과 일치하는지 대조.
 *
 *   npx tsx scripts/checkCaptionSync.mts
 *
 * 오프너 여백 상수가 timing.ts / LongformDoc.tsx / captions.ts 세 곳에 걸쳐
 * 있어서, 한 곳만 고치면 자막이 통째로 밀린다. 영상에서는 눈으로 못 잡는다.
 */
import { longformSrt } from "../src/lib/captions.js";
import { LONGFORM_OPENER_LEAD, longformBreathSeconds } from "../src/remotion/timing.js";
import { chapters } from "./longformFixture.js";

const fps = 30;
// 컴포지션이 계산하는 것과 동일한 식
const expected: number[] = [];
let abs = 0;
for (const c of chapters) {
  let f = abs + LONGFORM_OPENER_LEAD;
  c.segments.forEach((s, i) => {
    expected.push(f);
    f += Math.max(1, Math.round(s.durationInSeconds * fps))
       + Math.round(longformBreathSeconds(s.emphasis, i === c.segments.length - 1) * fps);
  });
  abs = f;
}

const srt = longformSrt(chapters, fps);
const cues = [...srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d\d\d) -->/g)].map((m) =>
  Math.round(((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4]) / 1000 * fps),
);

let bad = 0;
expected.forEach((e, i) => {
  if (cues[i] !== e) { bad++; console.log(`✗ 컷 ${i}: 화면 ${e}f / 자막 ${cues[i]}f`); }
});
console.log(bad ? `\n어긋남 ${bad}건 / ${expected.length}컷` : `전부 일치 (${expected.length}컷)`);
process.exit(bad ? 1 : 0);

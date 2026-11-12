/**
 * 원문 베끼기 검사 (수익창출 심사 대비, 11/12).
 *
 * 유튜브 YPP 는 '재사용·반복(비독창) 콘텐츠'를 거절 사유로 든다. 위키백과 문장을 그대로 읽는
 * 내레이션은 그 신호가 되고, CC BY-SA 출처 표기를 해도 '번역·낭독'은 해설로 보지 않는다.
 * 대본 내레이션 글자 n-gram 중 한국어 원문에도 그대로 있는 비율을 잰다.
 *
 * - 공백·문장부호를 지운 글자 12-gram. 고유명사·연도만 겹쳐서는 12자를 넘기 어렵고,
 *   한 문장을 거의 그대로 옮기면 바로 걸린다.
 * - 영어 원문은 비교하지 않는다(번역이라 글자가 겹치지 않는다).
 */
const N = 12;

function squash(s: string): string {
  return s.replace(/[\s\p{P}\p{S}]+/gu, "");
}

function grams(s: string, n = N): Set<string> {
  const t = squash(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n));
  return out;
}

/** 대본 12-gram 중 원문에도 있는 비율(0~1). 원문이 한국어가 아니면 0 */
export function sourceOverlap(scriptTexts: string[], sourceTexts: string[]): number {
  const src = new Set<string>();
  for (const s of sourceTexts) if (/[가-힣]/.test(s)) for (const g of grams(s)) src.add(g);
  if (!src.size) return 0;
  const mine = grams(scriptTexts.join(" "));
  if (!mine.size) return 0;
  let hit = 0;
  for (const g of mine) if (src.has(g)) hit++;
  return hit / mine.size;
}

/** 이 비율을 넘으면 '원문 낭독'으로 보고 다시 쓰게 한다 */
export const MAX_SOURCE_OVERLAP = 0.12;

/** 원문과 가장 많이 겹치는 내레이션 문장(재작성 지시에 예시로 보여준다) */
export function mostCopiedLines(scriptTexts: string[], sourceTexts: string[], limit = 3): string[] {
  const src = new Set<string>();
  for (const s of sourceTexts) if (/[가-힣]/.test(s)) for (const g of grams(s)) src.add(g);
  return scriptTexts
    .map((t) => {
      const g = grams(t);
      let hit = 0;
      for (const x of g) if (src.has(x)) hit++;
      return { t, r: g.size ? hit / g.size : 0 };
    })
    .filter((x) => x.r >= 0.5)
    .sort((a, b) => b.r - a.r)
    .slice(0, limit)
    .map((x) => x.t);
}

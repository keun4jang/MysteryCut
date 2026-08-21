import type { SourceDoc } from "../sources.js";
import { textEm } from "../text.js";

/**
 * 시각 문법 게이트 — 원문에 없는 것은 화면에 그리지 않는다.
 *
 * 이 채널은 실존 사건을 다룬다. 그래픽을 채우려고 사실을 추론하는 순간
 * 채널이 죽는다. 그래서 모든 게이트는 **의심스러우면 폐기**로 판정한다.
 * 폐기된 그래픽은 기존 자료 프레임(문장 확대)으로 강등될 뿐, 대본은 살아남는다.
 */

/** NFKC 정규화 + 공백·구두점 제거 + 소문자 — 원문 대조용 */
export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\s.,·;:!?'"“”‘’()[\]<>《》「」…\-–—~]/g, "")
    .toLowerCase();
}

/** 한국어 조사를 떼고 2자 이상 내용어만 남긴다 */
const JOSA = /(은|는|이|가|을|를|에서|에는|에게|에|으로|로|와|과|도|만|의|께서|부터|까지|이라고|라고)$/;
export function tokensOf(s: string): string[] {
  return s
    .split(/\s+/)
    .map((w) => w.replace(/[^가-힣A-Za-z0-9]/g, "").replace(JOSA, ""))
    .filter((w) => w.length >= 2);
}

export interface ResolvedSpan {
  quote: string;
  docIndex: number;
  charStart: number;
  lang: "ko" | "en";
}

/**
 * G1. 인용이 원문에 **글자 그대로** 있는가.
 *
 * 근사 일치를 허용하면 안 된다 — '없었다'를 '있었다'로 뒤집어도 통과해 버린다.
 * 너무 짧은 인용은 우연히 걸리므로 하한을 둔다.
 */
export function resolveSpan(quote: string, sources: SourceDoc[]): ResolvedSpan | null {
  const q = norm(quote);
  if (q.length < 14) return null;
  const hasKo = /[가-힣]/.test(quote);
  for (let i = 0; i < sources.length; i++) {
    const d = sources[i];
    // 언어가 어긋나면 대조가 성립하지 않는다 (영문 원문에 한국어 인용을 붙이는 경로)
    if (hasKo && d.lang !== "ko") continue;
    if (!hasKo && d.lang !== "en") continue;
    const at = norm(d.extract).indexOf(q);
    if (at >= 0) return { quote, docIndex: i, charStart: at, lang: d.lang };
  }
  return null;
}

/**
 * G2. 화면에 뜨는 글자가 그 인용에서 나온 것인가.
 *
 * 지금까지는 quote 만 검사하고 화면 글자(text)는 무검증이었다. 그러면
 * 근거는 진짜인데 화면에는 딴소리를 쓸 수 있다.
 */
export function textBackedBy(text: string, quote: string, ratio = 0.5): boolean {
  const t = tokensOf(text);
  if (!t.length) return false;
  const q = norm(quote);
  return t.filter((w) => q.includes(norm(w))).length / t.length >= ratio;
}

/** G3. 부정 표현 개수가 다르면 뜻이 뒤집힌 것이다 */
const NEG = /않|못|없|무혐의|불기소|아니|미확인|\bnot\b|\bno\b|\bnever\b|\bwithout\b/g;
export function negParity(a: string, b: string): boolean {
  return (a.match(NEG)?.length ?? 0) === (b.match(NEG)?.length ?? 0);
}

/**
 * G5. 확신도는 모델의 자기 신고를 믿지 않고 원문 주변을 보고 정한다.
 * 원문이 '추정·주장·의혹'이라고 한 것을 화면에서 단정하면 안 된다.
 */
const HEDGE =
  /추정|주장|의혹|설이\s*있|가능성|알려져|전해진|suspected|alleged|believed|reportedly|likely|possibly|claimed/i;
export function forceConfidence(span: ResolvedSpan, sources: SourceDoc[]): "stated" | "hedged" {
  const ext = norm(sources[span.docIndex].extract);
  const win = ext.slice(
    Math.max(0, span.charStart - 120),
    span.charStart + norm(span.quote).length + 120,
  );
  return HEDGE.test(win) || HEDGE.test(span.quote) ? "hedged" : "stated";
}

/**
 * G6. 실명·지명이 화면에 새는 것을 막는다 (형법 307조 1항).
 *
 * 블랙리스트('~씨' 같은 경칭)만으로는 뚫린다. 원문 제목·검색어에서 뽑은
 * 고유명사 후보를 화면 글자와 대조하는 **화이트리스트 역전**이 필요하다.
 */
export const ROLE_WORDS = new Set([
  "목격자", "신고자", "증인", "제보자", "관계자", "피해자", "유족", "가족", "배우자",
  "자녀", "형제자매", "이웃", "동료", "고용주", "피고인", "피의자", "용의자",
  "조사기관", "수사기관", "수사관", "검찰", "법원", "감정인", "부검의", "변호인",
  "언론", "기업", "병원", "학교", "행정기관", "주민", "생존자", "사망자", "실종자",
]);
/**
 * 사건명·문서 제목에 흔히 섞이는 **일반 명사**.
 * 이걸 안 걸러내면 '카메룬 니오스호 집단 사망 사건'에서 '사망'까지 고유명사로
 * 취급해, 정상적인 화면 글자('주민 사망')가 실명 유출로 반려된다.
 */
const GENERIC_TITLE_WORDS = new Set([
  "사건", "사고", "참사", "미스터리", "실종", "사망", "의문사", "집단", "괴담",
  "전설", "실화", "진실", "논란", "재판", "판결", "기록", "화재", "폭발", "독살",
  "살인", "강도", "유산", "상속", "실험", "조사", "수색", "발견", "은폐", "의혹",
  "재심", "무죄", "유죄", "증거", "가설", "결론", "당국", "정부", "보고서",
]);

export function nameLeak(text: string, sources: SourceDoc[], probeTitle: string): boolean {
  // (a) 라틴 대문자로 시작하는 낱말 = 영문 고유명사
  if (/[A-Z][a-z]/.test(text)) return true;
  // (b) 원문 제목·사건명에서 뽑은 고유명사가 화면 글자에 들어옴
  const proper = new Set<string>();
  for (const s of [probeTitle, ...sources.map((d) => d.title)]) {
    for (const t of tokensOf(s)) {
      if (!ROLE_WORDS.has(t) && !GENERIC_TITLE_WORDS.has(t)) proper.add(t);
    }
  }
  for (const t of tokensOf(text)) if (proper.has(t)) return true;
  // (c) 경칭이 붙은 한국어 이름
  if (/[가-힣]{2,4}\s*(씨|군|양|여사|옹)(?![가-힣])/.test(text)) return true;
  // (d) 행정구역 — '당시'·'즉시' 같은 오탐은 제외
  const OK = /당시|즉시|선포시|종료시|재처리|재출동|운동|사동|자동/;
  const m = /(?<![가-힣])([가-힣]{2,3})(시|군|구|읍|면|리|동)(?![가-힣])/.exec(text);
  if (m && !OK.test(m[0])) return true;
  return false;
}

/** G7. 폭. 넘치면 자르지 않고 폐기한다 — 잘린 사실은 다른 사실이다 */
export function fits(s: string, fontPx: number, maxPx: number): boolean {
  return textEm(s) * fontPx <= maxPx;
}

/** G8. 조립이 끝나고도 읽을 시간이 남는가 (30fps) */
export function readable(durationInFrames: number, buildFrames: number): boolean {
  return durationInFrames - buildFrames >= 75 && durationInFrames >= 120;
}

/**
 * G9. 챕터 위치. 절대 번호로 못박으면 챕터 수가 5~7개로 가변인 지금 깨진다.
 * 첫·마지막 챕터는 제외하고 중반 이후에만 그래픽을 허용한다.
 */
export function chapterAllowed(i: number, total: number): boolean {
  return i > 0 && i < total - 1 && i / (total - 1) >= 0.4;
}

/**
 * Q2. 숫자가 원문에 **그 숫자로** 있는가.
 * '1948년'에서 1948·194·48 을 긁어오는 것을 막으려면 자릿수 경계를 봐야 한다.
 */
export function numberInQuote(value: number, unit: string | undefined, quote: string): boolean {
  const v = String(value);
  if (new RegExp(`(?<![0-9])${v}(?![0-9])`).test(quote)) {
    // 단위가 있으면 숫자 직후에 그 단위가 따라와야 한다
    if (!unit) return true;
    return new RegExp(`(?<![0-9])${v}\\s*${escapeRe(unit)}`).test(quote);
  }
  // Q3. 한글 수사는 **단위를 동반할 때만** 인정한다.
  //     한자어 단자(일·이·삼…)는 '수사'·'오후' 같은 낱말에 걸려 오탐이 심하다.
  const KO_NUM: Record<number, string> = {
    1: "한", 2: "두", 3: "세", 4: "네", 5: "다섯", 6: "여섯", 7: "일곱",
    8: "여덟", 9: "아홉", 10: "열", 11: "열한", 12: "열두", 20: "스물", 30: "서른",
  };
  const ko = KO_NUM[value];
  if (!ko) return false;
  const COUNTER = unit ? escapeRe(unit) : "명|개|장|번|년|건|차례|번째|사람";
  return new RegExp(`${ko}\\s*(${COUNTER})`).test(quote);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Q5. 원문이 어림수라고 했으면 화면도 어림수여야 한다. '수십·수백'은 아예 못 쓴다 */
export function approxRule(quote: string): { approx: boolean; discard: boolean } {
  if (/수십|수백|수천/.test(quote)) return { approx: false, discard: true };
  return { approx: /약|여\s|가량|안팎|남짓|approximately|about|some/.test(quote), discard: false };
}

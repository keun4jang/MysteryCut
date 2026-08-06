/**
 * 화면 자막용 텍스트 → 나레이션(TTS)용 발음 텍스트 변환.
 *
 * 자막에는 '3km', '20%', '$4,000' 처럼 기호로 쓰는 게 읽기 좋지만,
 * TTS 는 단위 기호를 알파벳 그대로 읽어버린다("3km" → "삼 케이엠").
 * 그래서 음성 합성 직전에만 한글 발음으로 풀어 쓴다. (자막은 원문 유지)
 *
 * 단위를 한글로 풀면 뒤에 붙은 조사도 어긋나므로('4,000달러이') 함께 교정한다.
 */

/** 숫자 뒤 단위 기호 → 한글 발음. 긴 것부터 둬야 km 이 m 으로 잘리지 않는다. */
const UNITS: Array<[string, string]> = [
  ["km²", "제곱킬로미터"],
  ["m²", "제곱미터"],
  ["cm", "센티미터"],
  ["mm", "밀리미터"],
  ["km", "킬로미터"],
  ["kg", "킬로그램"],
  ["mg", "밀리그램"],
  ["ml", "밀리리터"],
  ["kHz", "킬로헤르츠"],
  ["dB", "데시벨"],
  ["m", "미터"],
  ["g", "그램"],
  ["t", "톤"],
  ["L", "리터"],
];

/** 통화 기호(숫자 앞) → 한글 발음 */
const CURRENCIES: Array<[string, string]> = [
  ["$", "달러"],
  ["€", "유로"],
  ["£", "파운드"],
  ["¥", "엔"],
  ["₩", "원"],
];

/** 받침 유무로 갈리는 조사쌍 [받침O, 받침X] */
const PARTICLES: Array<[string, string]> = [
  ["이", "가"],
  ["은", "는"],
  ["을", "를"],
  ["과", "와"],
  ["으로", "로"],
];
const PARTICLE_ALT = "으로|로|이|가|은|는|을|를|과|와";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 마지막 글자의 받침 상태에 맞춰 조사를 교정 */
function fixParticle(word: string, particle: string | undefined): string {
  if (!particle) return "";
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return particle; // 한글 음절이 아니면 그대로
  const jong = (code - 0xac00) % 28; // 0 = 받침 없음, 8 = ㄹ
  for (const [withBatchim, withoutBatchim] of PARTICLES) {
    if (particle !== withBatchim && particle !== withoutBatchim) continue;
    // '으로/로'만 예외: 받침이 없거나 ㄹ 받침이면 '로'
    if (withBatchim === "으로") return jong === 0 || jong === 8 ? "로" : "으로";
    return jong === 0 ? withoutBatchim : withBatchim;
  }
  return particle;
}

export function toSpeechText(input: string): string {
  let s = input;

  // 속도: '120km/h' → '시속 120킬로미터' (앞에 이미 '시속'이 있으면 중복 제거)
  s = s.replace(/(\d[\d,.]*)\s*km\/h/g, "시속 $1킬로미터");
  s = s.replace(/시속\s*시속/g, "시속");

  // 숫자 + 단위 (+ 뒤따르는 조사까지 함께 교정). 뒤에 알파벳이 오면 영어 단어이므로 제외
  for (const [sym, read] of UNITS) {
    const re = new RegExp(
      `(\\d[\\d,.]*)\\s*${escapeRe(sym)}(${PARTICLE_ALT})?(?![A-Za-z])`,
      "g",
    );
    s = s.replace(re, (_m, num: string, particle?: string) => `${num}${read}${fixParticle(read, particle)}`);
  }

  // 온도·각도·퍼센트 ('영하 30°C' 는 '섭씨'를 덧붙이지 않는다)
  s = s.replace(/(영하|영상)\s*(\d[\d,.]*)\s*(?:°C|℃)/g, "$1 $2도");
  s = s.replace(/(\d[\d,.]*)\s*(?:°C|℃)/g, "섭씨 $1도");
  s = s.replace(/(\d[\d,.]*)\s*(?:°F|℉)/g, "화씨 $1도");
  s = s.replace(/(-?\d[\d,.]*)\s*°(?![CF])/g, "$1도");
  s = s.replace(/(\d[\d,.]*)\s*%/g, "$1퍼센트");

  // 통화 (기호가 숫자 앞이라 자리를 바꾸고 조사도 교정)
  for (const [sym, read] of CURRENCIES) {
    const re = new RegExp(`${escapeRe(sym)}\\s*(\\d[\\d,.]*)(${PARTICLE_ALT})?`, "g");
    s = s.replace(re, (_m, num: string, particle?: string) => `${num}${read}${fixParticle(read, particle)}`);
  }

  // 시각 '3:15' → '3시 15분'
  s = s.replace(/(\d{1,2}):(\d{2})(?::(\d{2}))?/g, (_m, h, mi, sec) =>
    sec ? `${h}시 ${mi}분 ${sec}초` : `${h}시 ${mi}분`,
  );

  // 범위 '3~5명' → '3에서 5명'
  s = s.replace(/(\d)\s*[~∼]\s*(\d)/g, "$1에서 $2");

  s = s.replace(/&/g, " 앤 ").replace(/\s{2,}/g, " ");
  return s.trim();
}

/**
 * 플랫폼 연령제한(자살·자해·섭식장애 언급) 유발 표현 탐지·중립화.
 *
 * 인스타·유튜브는 이런 표현이 들어간 게시물에 18세 미만 열람 제한을 걸어
 * 도달을 크게 떨어뜨린다. 사건 사실은 유지하되 표현만 중립적으로 바꾼다.
 * (신규 생성은 producer 가, 기존 게시물은 scripts/fixPublishedText.mts 가 사용)
 */

/** 연령제한을 유발하는 표현 패턴 */
export const SENSITIVE_PATTERNS: RegExp[] = [
  /자살/g,
  /자해/g,
  /극단적\s*선택/g,
  /스스로\s*목숨을\s*끊/g,
  /목을\s*매/g,
  /투신/g,
  /음독/g,
  /손목을\s*긋/g,
  /거식증|폭식증/g,
  /\bsuicid\w*/gi,
  /\bself[-\s]?harm\w*/gi,
  /\bhanged?\s+(?:her|him)self/gi,
  /\bkilled\s+(?:her|him)self/gi,
  /\banorexi\w*|\bbulimi\w*/gi,
];

/** 텍스트 목록에서 걸린 표현들을 중복 없이 반환 */
export function findSensitiveTerms(texts: (string | undefined)[]): string[] {
  const hits = new Set<string>();
  for (const re of SENSITIVE_PATTERNS) {
    for (const t of texts) {
      if (!t) continue;
      for (const m of t.match(re) ?? []) hits.add(m.trim());
    }
  }
  return [...hits];
}

/** 사실 왜곡 없이 중립 표현으로 치환 (구체적 문맥 → 일반 순서) */
export function softenText(s: string): string {
  return s
    .replace(/(?:자살|극단적\s*선택)(?:로|으로)?\s*결론(?:을)?\s*내/g, "타살 혐의점을 찾지 못했다고 결론 내")
    .replace(/자살로\s*(결론|판단|종결)[^.?!]*/g, "타살 혐의점을 찾지 못한 채 종결")
    .replace(/(?:자살|극단적\s*선택)을\s*했?다는/g, "스스로 벌인 일이라는")
    .replace(/(자살|극단적\s*선택)\s*(결론|판단)/g, "의문사 종결")
    .replace(/(자살|극단적\s*선택)\s*(미스터리|사건|의혹|설)/g, "의문사 $2")
    .replace(/(?:자살|극단적\s*선택)\s*시도/g, "스스로 벌인 일로 보이는 시도")
    // '자살이냐 타살이냐' 처럼 타살과 대비되는 문맥
    .replace(/자살(과|이나|이냐|인지|이었을까|였을까)(\s*)(타살|살인)/g, "스스로 벌인 일$1$2$3")
    // 동사 활용형 — 일반 치환('의문의 죽음')을 그대로 쓰면 비문이 된다
    .replace(/자살한/g, "세상을 떠난")
    .replace(/자살했/g, "세상을 떠났")
    .replace(/자살하려[^\s.?!]*/g, "생을 마감하려")
    .replace(/자살하/g, "세상을 떠나")
    .replace(/스스로\s*목숨을\s*끊[^\s.?!]*/g, "숨을 거둔")
    .replace(/극단적\s*선택|자살/g, "의문의 죽음")
    .replace(/자해/g, "스스로 입힌 상처")
    .replace(/목을\s*매(달)?/g, "숨진")
    .replace(/투신/g, "추락")
    .replace(/음독/g, "중독")
    .replace(/손목을\s*긋는?/g, "상처를 내는")
    .replace(/거식증|폭식증/g, "섭식 문제")
    .replace(/ruled\s+it\s+a\s+suicide/gi, "closed the case with no evidence of foul play")
    .replace(/\bsuicides?\b/gi, "a self-inflicted act")
    .replace(/\bsuicidal\b/gi, "despairing")
    .replace(/\bself[-\s]?harm\w*/gi, "self-inflicted injury")
    .replace(/\b(hanged|killed)\s+(her|him)self/gi, "died")
    .replace(/\banorexi\w*|\bbulimi\w*/gi, "an eating disorder");
}

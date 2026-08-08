/**
 * 플랫폼 연령제한(자살·자해·섭식장애·노골적 성 표현) 유발 표현 탐지·중립화.
 *
 * 인스타·유튜브는 이런 표현이 들어간 게시물에 18세 미만 열람 제한을 걸어
 * 도달을 크게 떨어뜨린다. 사건 사실은 유지하되 표현만 중립적으로 바꾼다.
 * (신규 생성은 producer 가, 기존 게시물은 scripts/fixPublishedText.mts 가 사용)
 *
 * 불륜·치정 소재를 다루기 시작하면서 성행위 직접 표현도 함께 막는다.
 * 프롬프트로도 금지하지만 모델이 흘릴 수 있어 코드 레벨에서 한 번 더 거른다.
 */

/** 연령제한을 유발하는 표현 패턴 */
export const SENSITIVE_PATTERNS: RegExp[] = [
  // 성행위 직접 표현 — 유튜브 '제한적 광고'·인스타 연령제한 유발
  /성관계|육체관계|동침/g,
  // '잠자리에 들다'(수면), '정사(正史)에 기록된'(역사 소재) 오탐을 피해 서술어까지 묶어서 본다
  /(?:잠자리|정사)를\s*(?:가졌|맺었|했|나눴|벌였|같이)/g,
  /몸을\s*섞/g,
  /나체|알몸/g,
  /\bsex(?:ual)?\s+(?:relations?|intercourse|encounter)/gi,
  /\bslept\s+with\b/gi,
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
    // ── 성행위 직접 표현 → 판결문·신문 사회면 어투로 (뜻은 그대로, 광고·연령 안전) ──
    .replace(/(?:성관계|육체관계|정사|잠자리)를\s*(?:가졌|맺었|했|나눴|벌였)다/g, "부정한 관계를 맺었다")
    .replace(/(?:성관계|육체관계|정사|잠자리)를\s*(?:가졌|맺었|했|나눴|벌였)/g, "부정한 관계를 맺었")
    // 서술어 없이 남은 낱말은 성적 의미가 확실한 것만 (잠자리=수면, 정사=正史 오탐 방지)
    .replace(/성관계|육체관계/g, "부정한 관계")
    .replace(/동침한/g, "함께 밤을 보낸")
    .replace(/동침했/g, "함께 밤을 보냈")
    .replace(/동침/g, "함께 밤을 보낸 일")
    .replace(/몸을\s*섞은/g, "부정한 관계를 맺은")
    .replace(/몸을\s*섞[^\s.?!]*/g, "부정한 관계를 맺었")
    // 조사까지 맞춰 치환 (그냥 바꾸면 '옷차림이 흐트러진으로' 같은 비문이 된다)
    .replace(/(?:나체|알몸)\s*상태(?:로)?/g, "옷차림이 흐트러진 채")
    .replace(/(?:나체|알몸)(?:으)?로/g, "옷차림이 흐트러진 채로")
    .replace(/나체|알몸/g, "흐트러진 옷차림")
    .replace(/\bsex(?:ual)?\s+(?:relations?|intercourse|encounter)/gi, "an affair")
    .replace(/\bslept\s+with\b/gi, "had an affair with")
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

import { z } from "zod";
import { config } from "../config.js";
import { generateStructured } from "../lib/llm.js";
import { findSensitiveTerms, softenText } from "../lib/safeText.js";
import {
  StoryIdeaSchema,
  ReelScriptSchema,
  ReelMetadataSchema,
  type StoryIdea,
  type ReelScript,
  type ReelMetadata,
} from "../types.js";

/**
 * 통합 생성기 — 스토리·대본·캡션을 **한 번의 LLM 호출**로 생성.
 * (Gemini 무료 할당량을 아끼기 위해 3콜 → 1콜)
 */
const ReelPlanSchema = z.object({
  idea: StoryIdeaSchema,
  script: ReelScriptSchema,
  metadata: ReelMetadataSchema,
});
export type ReelPlan = { idea: StoryIdea; script: ReelScript; metadata: ReelMetadata };

export interface AvoidList {
  caseKeys: string[];
  titles: string[];
  /** 최근 게시물의 해시태그 (같은 세트 반복 금지용) */
  recentHashtags?: string[];
}

export interface PlanOptions {
  /** 버라이어티 팩이 고른 오프닝 훅 방식 지시문 */
  hookStyle?: string;
}

export async function writeReelPlan(
  seed?: string,
  avoid?: AvoidList,
  opts?: PlanOptions,
): Promise<ReelPlan> {
  const avoidBlock =
    avoid && (avoid.caseKeys.length || avoid.titles.length)
      ? [
          "",
          "★중복 금지: 아래 사건들은 이미 게시했다. 같은 사건은 물론이고, 제목만 바꾼 사실상 같은 소재도 절대 금지. 완전히 다른 새 사건/전설을 골라라.",
          `- 이미 쓴 caseKey: ${avoid.caseKeys.join(", ") || "(없음)"}`,
          `- 이미 쓴 제목: ${avoid.titles.join(" / ") || "(없음)"}`,
        ].join("\n")
      : "";

  const system = [
    `너는 인스타 릴스용 ${config.channel.language} 미스터리 콘텐츠 제작자다. 한 번에 아이디어·대본·캡션을 모두 만든다.`,
    `채널 주제: ${config.channel.niche}.`,
    "",
    "출력은 { idea, script, metadata } JSON 하나다.",
    "",
    "[idea] 가능하면 실화(실제 미제사건/역사 속 미스터리, 아주 옛날 것도 좋음) 기반.",
    "- caseKey: 이 사건/전설의 고유 식별자를 영어 소문자 슬러그로. 같은 사건이면 항상 같은 값이 나오게 대표 명칭+연도로. 예: 'brazil-lead-masks-1966', 'dyatlov-pass-1959', 'hinterkaifeck-murders-1922'.",
    "- thumbTitle: 썸네일(커버) 카드용 초자극 문구. 사건의 가장 소름 끼치는 한 방을 6~14자로, 필요하면 '\\n'으로 2줄. 피드에서 스크롤을 멈추게 하는 문구 — 명사형/단정형으로 강하게. 예: '피가 전부\\n사라졌다', '가면 쓴\\n두 구의 시신', '죽은 자가\\n보낸 편지'. 물음표·마침표 없이. 과장은 하되 사건 사실 범위 안에서. 줄바꿈은 반드시 실제 개행 문자(JSON \"\\n\" 이스케이프)로 — 백슬래시와 n 두 글자를 그대로 쓰면 화면에 '\\n'이 노출되므로 금지.",
    "- basedOnRealEvents 를 정직히 표시. 실존 인물(특히 생존자) 명예훼손·사적 개인 특정 금지.",
    "- factNote 에 '알려진 사실 vs 추측/미확인'을 한두 문장으로.",
    "- 너무 유명한 소재(브라질 납가면 등)만 반복하지 말고, 덜 알려진 사건·세계 각국 사례도 폭넓게.",
    avoidBlock,
    "",
    "[script] 실제 사람이 친구한테 신기한 얘기 들려주듯, 빠르고 자연스러운 구어체 나레이션. 세그먼트 배열.",
    "- 세그먼트 26~34개(짧게 요청하면 12~18개). 첫 2~3개 강한 훅, 중반 오픈루프, 후반 반전, 마지막은 사인오프.",
    "- ★총 분량: 모든 세그먼트 text(한국어) 글자수 합계가 공백 포함 600~700자. (TTS로 읽으면 최종 85~95초 — 60초 미만이면 수익화 요건 미달. 750자 넘게도 쓰지 마라.) 분량은 문장을 늘여서가 아니라 '내용'으로 채워라: 수사 과정, 목격 증언, 배제된 가설, 시간대별 정황 같은 사건 디테일을 1~2겹 더 깊게.",
    "[컷 연결] ★모든 컷은 다음 컷이 궁금해지게 끝나야 한다. (1) 새 정보를 던지되 그 의미/결과는 다음 컷에서 밝혀라 — '근데 그 수첩이 문제였어요'로 끊고 다음 컷에서 내용 공개. (2) 4~5컷마다 하나는 일부러 미완결로 끊어 떡밥을 남겨라. (3) 전체의 1/3, 2/3 지점에 굵직한 새 의문(중간 리훅)을 각 1개 배치 — 길어진 러닝타임의 중간 이탈을 막는 핵심 장치. (4) 앞 컷의 마지막 소재를 다음 컷 첫머리가 물려받아 도미노처럼 이어지게(끊긴 느낌 금지).",
    `[오프닝] ${opts?.hookStyle ?? "훅 방식: '실화 선언형' — 첫 문장에서 지어낸 얘기가 아님을 밝히며 시작."} basedOnRealEvents=true 면 앞부분(1~3세그먼트 안)에서 실화 기반임을 자연스럽게 입말로 밝혀라. 딱딱한 '실화입니다' 금지.`,
    "- 각 세그먼트에 visualQuery(영어 스톡 검색어 2~4단어) 필수. 예: 'foggy dark forest night','old handwritten notebook'. 실존 인물명 금지.",
    "- 각 세그먼트에 textEn 필수: text(한국어)의 자연스러운 영어 번역. 원어민 구어체, 직역·번역투 금지. 화면 자막이 한/영 위아래로 나란히 나오니 길이를 한국어와 비슷하게(간결한 한 문장, 화면 2줄 이내)로 맞춰라. 불필요하게 길게 늘이지 말 것.",
    "- emphasis: 긴장 'tension', 반전 'reveal', 나머지 'normal'.",
    "",
    "[종결어미] 한 호흡에 '-어요/-았어요/-죠/-거든요/-고요/-더라고요/-잖아요/-대요'와 짧은 평서 반말(-았다/-이다)을 섞어라. 같은 어미가 3문장 연속이면 무조건 하나 갈아끼운다. '~습니다' 문어체 남용 금지. 축약이 기본값: '-거였어요/됐어요/뭐였을까요'.",
    "[시제] 과거 구어체로 통일. '발견됩니다'처럼 현재형으로 시작해 뒤에서 과거로 넘어가는 시제 혼용 금지. '집착했었대요'(-았었-+-대요) 같은 겹활용도 금지, '푹 빠져 있었거든요'처럼.",
    "[리듬] 문장 길이를 일부러 들쭉날쭉하게. 다만 대부분의 세그먼트는 한 문장을 온전히 담아라(대략 20~45자, 화면 2~3줄). 너무 잘게 쪼개 화면이 허전하지 않게. 짧게 때리는 문장('사인 불명.','납으로요.')은 강조가 필요한 대목에서 클립당 1~2번만. 문장 사이는 구어 연결어로 물 흐르듯: 근데 / 그러니까 / 그래서 / 게다가 / 문제는 / 심지어 / 알고 보니 / 웃긴 게 / 더 소름인 건. 매 3~4문장에 하나씩. 툭툭 나열 금지.",
    "[수사의문문] '~까요?/~일까요?'는 맨 앞 훅과 맨 마지막 줄, 클립당 최대 2번. 중간 세그먼트에선 질문 금지 — 궁금증은 사실 진술로 눌러라. (X)'대체 왜 죽은 걸까요?' → (O)'근데 몸엔 상처 하나 없었어요. 사인 불명.'",
    "[강약·개입] 별것 아닌 디테일은 빠르게 흘리고, 핵심 한 방에서 멈춰 눌러라. 눌러주는 문장은 클립당 1~2개. 화자 반응 한 줄('이게 진짜 이상한데','솔직히 이 대목이 제일 무서워요')을 클립당 딱 한 번 슬쩍.",
    "[금지] 감정 지정 형용사('소름 돋는/충격적인/경악스러운/믿기지 않는')는 클립당 최대 1개 — 감정은 형용사 대신 사실로 보여줘라. 상투 필러('대체/과연/놀랍게도/바로 이것이었습니다/믿거나 말거나') 금지. 번역투 수동 명사구('~에서 발견된 것은 …이었다','~과의 접촉 시도') 능동 입말로. 관형어 3중 수식 겹치면 끊어 던져라('때는 1966년. 장소는 브라질 산비탈.').",
    "[엔딩] 마지막 2세그먼트로 '확실하게' 닫아라. (1) 시청자에게 질문/관점 한 줄로 여운(회차마다 다르게, '만약 여러분이라면~' 틀만 반복 금지, 미해결 사실 한 줄도 좋음). 그리고 (2) 반드시 마지막 세그먼트는 마무리 멘트로 끝낸다. 예: '재밌었으면 좋아요 하나 눌러주세요. 다음엔 더 소름 돋는 실화로 올게요.' / '이 사건 어떻게 생각해요? 좋아요랑 댓글로 알려줘요.' ★중요: '팔로우/구독/채널' 같은 특정 플랫폼 용어는 절대 쓰지 마라(인스타·유튜브 동시 게시). '좋아요'와 '댓글'만 사용. 어색하지 않게 입말로. 클리셰('미스터리는 아직도 풀리지 않았습니다') 금지.",
    "좋은 예시: '몸엔 상처 하나 없었어요. 독극물도 안 나왔고요. 근데 두 사람은 죽어 있었죠.' / '주머니엔 수첩 한 권만 덩그러니 있었어요. 근데 거기 적힌 메모가 좀 이상했거든요.'",
    "",
    "[metadata] caption(게시글 본문) + hashtags(검색 키워드 목록).",
    "- ★caption 에 해시태그(#) 절대 금지. 대신 검색될 키워드(미스터리, 실화, 미제사건, 사건 지역/연대/소재 등)를 본문 문장 안에 자연스럽게 녹여 써라. 예: '1977년 미국의 한 작은 마을에서 실제로 벌어진 미제사건이에요. 이런 미스터리 실화, 어떻게 생각하세요?' 처럼 키워드가 문장의 일부가 되게.",
    "- caption 구조: 첫 줄 후킹 → 사건 요약 2~3문장(키워드 자연 포함) → 마지막 질문으로 댓글 유도.",
    "- ★모든 텍스트 필드(caption/captionEn/text/textEn/title/thumbTitle)에서 줄바꿈은 반드시 JSON 개행 이스케이프로만. 백슬래시+n 두 글자나 <br> 를 문장 안에 쓰면 게시글·화면에 그 코드가 그대로 노출되므로 절대 금지.",
    "- caption 끝에 신뢰 문구 한 줄: '※ 실제 사건 기록을 바탕으로 재구성한 콘텐츠입니다. 일부 장면은 자료화면입니다.' (독창성·사실성 표시)",
    "- captionEn 필수: caption 전체의 자연스러운 영어 번역(후킹→요약→질문→신뢰 문구까지). 원어민 구어체, 직역 금지, 해시태그 금지. 신뢰 문구는 'Based on real case records. Some scenes are stock footage.' 로. 게시 시 한국어 아래에 붙어 글로벌 시청자가 읽음.",
    "- hashtags 필드에는 # 없이 검색 키워드 8~12개만 (유튜브 내부 태그용 메타데이터 — 화면/본문엔 표시 안 됨). 예: '미스터리', '미제사건', '실화', '서클빌'.",
    avoid?.recentHashtags?.length
      ? `- 키워드도 최근 게시물과 겹치지 않게 절반 이상 새로: 최근 사용 ${avoid.recentHashtags.slice(-40).join(", ")}`
      : "",
    "",
    "안전: 확인 안 된 사실을 진짜처럼 단정하지 말 것. 과도한 잔혹성 지양.",
    "",
    "[★플랫폼 연령제한 회피 — 최우선 규칙]",
    "인스타·유튜브는 자살/자해/섭식장애를 직접 언급한 게시물에 연령 제한(18세 미만 열람 불가)을 걸어 도달을 크게 떨어뜨린다.",
    "caption/captionEn/thumbTitle/title/각 세그먼트 text·textEn 어디에도 아래 표현을 쓰지 마라:",
    "- 금지(한국어): 자살, 자해, 극단적 선택, 스스로 목숨을 끊다, 목을 매다, 투신, 음독, 손목을 긋다, 거식/폭식",
    "- 금지(영어): suicide, suicidal, self-harm, killed herself/himself, hanged, overdose, anorexia, bulimia",
    "대신 사실을 왜곡하지 않는 중립 표현으로 바꿔 써라:",
    "- '자살로 결론 내렸다' → '경찰은 타살 혐의점을 찾지 못하고 사건을 종결했다'",
    "- '자살이었을까 타살이었을까' → '스스로 벌인 일이었을까, 누군가의 계획이었을까'",
    "- 'ruled it a suicide' → 'closed the case, finding no evidence of foul play'",
    "- 죽음의 구체적 방법·도구 묘사 금지. '어떻게 죽었는지'가 아니라 '왜 설명이 안 되는지'에 초점.",
    "이 규칙은 사건 선택보다 우선한다 — 소재는 그대로 쓰되 표현만 중립적으로.",
  ].join("\n");

  const user = seed
    ? `다음 조건/소재를 반영해서 만들어줘: ${seed}`
    : "새로운 실제 미제사건이나 역사 속 미스터리로 하나 만들어줘. 기존과 겹치지 않는 신선한 소재로.";

  // 대본 분량 검증 — 90초 안팎(틱톡 수익화 1분+ 요건 여유 충족)을 위해 한국어 580자 이상.
  // (실측: TTS +15% 기준 약 초당 7.9자 → 600~700자 ≈ 발화 76~89초 + 호흡/카드 → 약 85~95초)
  // 미달이면 피드백을 붙여 재생성 (최대 3회 시도, 최종적으로 가장 긴 안 채택)
  const MIN_CHARS = seed && /짧게|short/i.test(seed) ? 0 : 580;
  let best: ReelPlan | undefined;
  let bestChars = 0;
  let feedback = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const plan = (await generateStructured({
      schema: ReelPlanSchema,
      system,
      user: user + feedback,
      temperature: 1.15,
      maxRetries: 1,
    })) as ReelPlan;
    sanitizePlan(plan);
    const chars = plan.script.segments.reduce((n, s) => n + s.text.length, 0);
    // 연령제한 유발 표현이 남아 있으면 분량과 무관하게 재생성 (도달 손실이 더 크다)
    const flagged = findSensitive(plan);
    if (chars > bestChars) {
      best = plan;
      bestChars = chars;
    }
    if (!flagged.length && chars >= MIN_CHARS) return plan;

    feedback = "";
    if (flagged.length) {
      console.warn(`   ⚠️ 연령제한 위험 표현 발견(${flagged.join(", ")}) — 재생성 (${attempt + 1}/2)`);
      feedback += `\n★직전 시도에 플랫폼 연령제한을 유발하는 표현(${flagged.join(", ")})이 들어 있었다. 사건 사실은 유지하되 그 단어를 절대 쓰지 말고 중립 표현('타살 혐의점을 찾지 못했다', 'found no evidence of foul play' 등)으로 다시 써라.`;
    }
    if (chars < MIN_CHARS) {
      console.warn(`   ⚠️ 대본 분량 부족(${chars}자 < ${MIN_CHARS}자) — 재생성 (${attempt + 1}/2)`);
      feedback += `\n★직전 시도의 대본 총 글자수가 ${chars}자로 부족했다. 사건 디테일(수사 과정·증언·배제된 가설)을 더 채워 반드시 공백 포함 600~700자로 다시 써라. 문장 늘이기 말고 내용 추가로.`;
    }
  }
  // 3회 재생성에도 남으면 기계적으로 중립화 (게시 자체를 막기보다 표현만 순화)
  const leftover = findSensitive(best!);
  if (leftover.length) {
    softenSensitive(best!);
    console.warn(`   ⚠️ 재생성에도 위험 표현 잔존(${leftover.join(", ")}) — 자동 중립화 적용`);
  }
  if (bestChars < MIN_CHARS) {
    console.warn(`   ⚠️ 재생성에도 분량 미달 — 가장 긴 안(${bestChars}자)으로 진행`);
  }
  return best!;
}

/** 계획 전체 텍스트에서 위험 표현을 찾아 매칭된 단어 목록 반환 */
function findSensitive(plan: ReelPlan): string[] {
  return findSensitiveTerms(collectTexts(plan));
}

function collectTexts(plan: ReelPlan): (string | undefined)[] {
  const i = plan.idea;
  const m = plan.metadata;
  return [
    i.thumbTitle,
    i.title,
    i.hook,
    i.premise,
    i.synopsis,
    i.twist,
    i.factNote,
    m.caption,
    m.captionEn,
    ...(m.hashtags ?? []),
    ...plan.script.segments.flatMap((s) => [s.text, s.textEn]),
  ];
}

/** 최후 수단: 사실 왜곡 없이 중립 표현으로 치환 */
function softenSensitive(plan: ReelPlan): void {
  const fix = softenText;
  const i = plan.idea;
  i.thumbTitle = fix(i.thumbTitle);
  i.title = fix(i.title);
  i.hook = fix(i.hook);
  i.premise = fix(i.premise);
  if (i.synopsis) i.synopsis = fix(i.synopsis);
  if (i.twist) i.twist = fix(i.twist);
  if (i.factNote) i.factNote = fix(i.factNote);
  for (const s of plan.script.segments) {
    s.text = fix(s.text);
    if (s.textEn) s.textEn = fix(s.textEn);
  }
  plan.metadata.caption = fix(plan.metadata.caption);
  if (plan.metadata.captionEn) plan.metadata.captionEn = fix(plan.metadata.captionEn);
  plan.metadata.hashtags = (plan.metadata.hashtags ?? []).map(fix);
}

/**
 * LLM 이 줄바꿈을 백슬래시+n 두 글자('\n')나 <br> 로 내보내면 화면·캡션에
 * 그 코드가 그대로 노출된다. 생성 직후 한 곳에서 모두 정리한다.
 *  - 여러 줄이 자연스러운 필드(썸네일 제목·캡션)는 실제 줄바꿈으로
 *  - 한 줄이어야 하는 필드(자막·제목·훅 등)는 공백으로
 */
function sanitizePlan(plan: ReelPlan): void {
  const toBreaks = (s: string) =>
    s
      .replace(/\\+n/g, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const toSpace = (s: string) => toBreaks(s).replace(/\s*\n\s*/g, " ").trim();

  const i = plan.idea;
  i.thumbTitle = toBreaks(i.thumbTitle ?? "");
  i.title = toSpace(i.title ?? "");
  i.hook = toSpace(i.hook ?? "");
  i.premise = toSpace(i.premise ?? "");
  if (i.synopsis) i.synopsis = toSpace(i.synopsis);
  if (i.twist) i.twist = toSpace(i.twist);
  if (i.factNote) i.factNote = toSpace(i.factNote);

  for (const seg of plan.script.segments) {
    seg.text = toSpace(seg.text ?? "");
    if (seg.textEn) seg.textEn = toSpace(seg.textEn);
  }

  const m = plan.metadata;
  m.caption = toBreaks(m.caption ?? "");
  if (m.captionEn) m.captionEn = toBreaks(m.captionEn);
  m.hashtags = (m.hashtags ?? []).map((t) => toSpace(t).replace(/^#/, ""));
}

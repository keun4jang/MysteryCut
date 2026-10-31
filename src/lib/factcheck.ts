import { z } from "zod";
import { generateStructured } from "./llm.js";

/**
 * 완성 원고 사실 검증 — 원고 문장을 위키 원문과 한 줄씩 대조해 틀리거나 원문에 없는 구체적 사실을 고친다.
 *
 * 숫자 검사(gates.ts numbersInText)는 '원문에 없는 숫자'만 잡는다. 10/17 드라이런 제목 '총리의 실종…'(실제 국철 총재),
 * '시속 수백 킬로'(원문에 없음) 같은 낱말·과장 오류는 그대로 통과했다(사장님 승인으로 추가, 10/17).
 * 흐름: 검사 1회 → 걸린 줄만 고친 문장으로 교체 → 재검사 1회. 그래도 남으면 실패(호출부가 중단·건너뜀).
 * 검사 호출 자체가 실패하면(한도 초과 등) 통과시킨다 — 숫자 검사가 1차 방어선으로 남는다.
 */
export interface FactItem {
  /** 원고 안 위치 표시(예: 'title', 's3') — 결과를 되돌려 꽂을 때 쓴다 */
  id: string;
  text: string;
  /** 고친 문장을 반영한다(영어 번역이 딸린 줄은 fixEn 도 받는다) */
  apply: (fix: string, fixEn?: string) => void;
  /** 형식 제약(예: 썸네일 문구 최대 글자수) — 고친 문장이 넘으면 반영하지 않고 실패로 둔다 */
  maxLen?: number;
}

const FactCheckSchema = z.object({
  issues: z.array(
    z.object({
      id: z.string(),
      problem: z.string(),
      fix: z.string(),
      fixEn: z.string().optional(),
    }),
  ),
});
type FactIssue = z.infer<typeof FactCheckSchema>["issues"][number];

export async function findIssues(items: FactItem[], sourceText: string, caseTitle: string): Promise<FactIssue[] | null> {
  try {
    const v = await generateStructured({
      schema: FactCheckSchema,
      system:
        "너는 사실 검증 담당이다. [원고]의 각 줄을 [원문]과 대조해, 다음에 해당하는 줄만 골라낸다:\n" +
        "(가) 원문과 모순되는 사실 — 인물의 직함·관계(예: 원문은 '국철 총재'인데 '총리'), 날짜·연도, 장소, 숫자, 누가 무엇을 했는지, 사건 결과.\n" +
        "(나) 원문에 없는 구체적 사실을 단정한 것 — 원문에 없는 수치·속도·인원(예: '시속 수백 킬로'), 원문에 없는 인물 행동·발언·수사 결과, 추측을 확정 사실처럼 쓴 것, " +
        "다른 시대·다른 인물의 일을 이 사람 일로 옮긴 것(예: 1970년 단체의 시위를 1891년 인물이 한 일로).\n" +
        "(다) 한국어로 뜻이 통하지 않는 낱말·오타·꼬인 문장(예: '홀들바다 뛰어 들어갔어요', 기름을 '강유'로) — 원문에 맞는 바른 말로 고친다.\n" +
        "다음은 문제 삼지 마라: 분위기·감정 묘사, 시청자에게 던지는 질문, 투표·댓글·좋아요 요청, 다음 편 예고, " +
        "원문 내용을 자연스럽게 바꿔 말한 것, 원문에 있는 사실을 요약·생략한 것, 누구나 아는 일반 상식.\n" +
        "골라낸 줄마다 fix 에 원문에 맞게 고친 문장을 써라. 원래 말투·길이·문장 형태(제목은 제목답게, 짧은 문구는 짧게)를 최대한 유지하고 틀린 부분만 바꿔라. " +
        "원문에 근거가 아예 없어 고칠 수 없으면 그 줄의 사실 주장을 빼고 원문에 있는 사실로 바꾼 문장을 써라. " +
        "영어 번역이 딸린 줄([…/en] 표시)은 fixEn 에 고친 문장의 영어 번역도 써라. 문제없는 줄은 issues 에 넣지 마라.",
      user:
        `[사건] ${caseTitle}\n\n[원문]\n${sourceText}\n\n[원고]\n` +
        items.map((it) => `[${it.id}]${it.maxLen ? ` (짧은 문구: 고칠 때도 ${it.maxLen}자 이내, 같은 형식)` : ""} ${it.text}`).join("\n") +
        "\n\n{issues: [{id, problem(한 문장, 원문 근거), fix, fixEn(영어 번역이 딸린 줄만)}]} 로 답하라. 문제가 없으면 issues 는 빈 배열.",
      temperature: 0,
      maxRetries: 2,
    });
    const ids = new Set(items.map((it) => it.id));
    return v.issues.filter((i) => ids.has(i.id) && i.fix.trim());
  } catch (e) {
    console.warn(`  ⚠️ 사실 검증 호출 실패(통과 처리): ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** 원고를 검증·교정한다. 통과(또는 검사 불가)면 true, 고친 뒤에도 틀린 줄이 남으면 false. */
export async function verifyFacts(items: FactItem[], sourceText: string, caseTitle: string): Promise<boolean> {
  if (!sourceText.trim() || !items.length) return true;
  const first = await findIssues(items, sourceText, caseTitle);
  if (first === null) return true;
  if (!first.length) {
    console.log("  ✅ 사실 검증: 원문과 어긋난 줄 없음");
    return true;
  }
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const issue of first) {
    const it = byId.get(issue.id)!;
    if (it.maxLen && issue.fix.replace(/\s+/g, "").length > it.maxLen) {
      // 짧은 문구(썸네일 등)를 설명 문장으로 바꿔 버리는 교정은 반영하지 않는다(10/31 드라이런: 썸네일이 한 문장 설명이 됨)
      console.log(`  ⚠️ 사실 교정 보류 [${issue.id}] 고친 문구가 ${it.maxLen}자를 넘음: "${issue.fix}"`);
      continue;
    }
    console.log(`  ✏️  사실 교정 [${issue.id}] "${it.text}" → "${issue.fix}" (${issue.problem})`);
    it.apply(issue.fix, issue.fixEn);
    it.text = issue.fix;
  }
  const second = await findIssues(items, sourceText, caseTitle);
  if (second === null || !second.length) {
    console.log(`  ✅ 사실 검증: ${first.length}줄 교정 후 통과`);
    return true;
  }
  for (const issue of second) console.warn(`  ❌ 교정 후에도 남은 사실 오류 [${issue.id}] ${issue.problem}`);
  return false;
}

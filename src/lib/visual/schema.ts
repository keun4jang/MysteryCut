import { z } from "zod";

/**
 * 자료 화면의 시각 문법.
 *
 * 지금까지 '자료 프레임'은 나레이션 문장을 100px 로 그대로 확대한 화면이었다.
 * 그건 새로운 시각 정보가 아니라 자막의 확대판이고, 유튜브가 수익창출 부적합
 * 사례로 드는 '이미지 슬라이드쇼'에 가깝다. 사실을 **구조**로 보여주는 화면이
 * 필요하다.
 */
export const VISUAL_KINDS = [
  "quantity", // 수치 비교 — 큰 숫자 + 막대·칸 격자
] as const;
export type VisualKind = (typeof VISUAL_KINDS)[number];

/**
 * ★ LLM 에게 가는 스키마는 **느슨해야 한다.**
 *
 * generateStructured 는 schema.parse() 로 전부-아니면-전무 판정을 한다.
 * 여기에 .min()/.max()/.enum() 같은 하드 제약을 걸면, 그래픽 하나가 규칙을
 * 어겼을 때 8챕터 대본 전체가 폐기되고 재생성으로 넘어간다. 실제로 분량
 * 규칙에서 그 일이 났다(재생성 루프가 무료 호출을 2~4배로 태움).
 *
 * 그래서 제약은 describe() 로 **유도만** 하고, 실제 판정은 Node 쪽
 * 게이트(gates.ts)가 한다. 게이트에 걸리면 그 그래픽만 버리고 나머지 대본은
 * 그대로 쓴다.
 */

/** 원문 근거 한 조각. 코드가 sources[].extract 와 글자 단위로 대조한다. */
export const SourceSpanSchema = z.object({
  quote: z
    .string()
    .describe(
      "이 주장의 근거가 되는 원문 문장을 **그대로 복사**한 것. 요약·의역·번역 금지. " +
        "코드가 원문과 글자 단위로 대조하므로 한 글자라도 다르면 이 그래픽은 버려진다. " +
        "못 찾겠으면 그래픽을 만들지 마라.",
    ),
  docIndex: z.number().optional().describe("원문이 여러 건일 때 몇 번째 문서인지(0부터). 모르면 생략"),
});

/** 화면에 뜨는 사실 주장 하나 */
export const ClaimSchema = z.object({
  text: z
    .string()
    .describe("화면에 뜨는 글자. 명사구 또는 단문. 실명·지명·정확한 날짜 금지."),
  source: SourceSpanSchema,
  confidence: z
    .string()
    .optional()
    .describe("'stated'(원문이 단정) 또는 'hedged'(원문이 추정·주장·의혹이라고 씀)"),
  /** quantity 전용 */
  value: z.number().optional().describe("숫자 값. 원문에 그대로 있는 수만."),
  unit: z.string().optional().describe("단위 3자 이내. 예: 명, 년, 번, 건, %"),
  role: z.string().optional().describe("이 수가 무엇인지 역할어. 예: 사망자, 생존자, 경과, 재심 청구"),
});

/** 문장 하나에 붙는 시각 문법 */
export const VisualSchema = z.object({
  kind: z.string().describe(VISUAL_KINDS.join(" / ") + " 중 하나"),
  title: z.string().optional().describe("화면 좌상단 분류 꼬리표. 12자 이내"),
  claims: z.array(ClaimSchema).optional().describe("사실 주장들. 순서가 곧 화면 배치 순서"),
});
export type VisualLoose = z.infer<typeof VisualSchema>;

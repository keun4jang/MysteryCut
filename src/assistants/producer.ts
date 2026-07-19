import { z } from "zod";
import { config } from "../config.js";
import { generateStructured } from "../lib/llm.js";
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

export async function writeReelPlan(seed?: string): Promise<ReelPlan> {
  const system = [
    `너는 인스타 릴스용 ${config.channel.language} 미스터리 콘텐츠 제작자다. 한 번에 아이디어·대본·캡션을 모두 만든다.`,
    `채널 주제: ${config.channel.niche}.`,
    "",
    "출력은 { idea, script, metadata } JSON 하나다.",
    "",
    "[idea] 가능하면 실화(실제 미제사건/역사 속 미스터리, 아주 옛날 것도 좋음) 기반.",
    "- basedOnRealEvents 를 정직히 표시. 실존 인물(특히 생존자) 명예훼손·사적 개인 특정 금지.",
    "- factNote 에 '알려진 사실 vs 추측/미확인'을 한두 문장으로.",
    "",
    "[script] 실제 사람이 말하듯 자연스러운 구어체 대본. 세그먼트 배열.",
    "- 딱딱한 문어체·번역투·AI말투 금지. '~죠','~거든요','~였어요' 같은 입말, 짧게 끊어라.",
    "- 세그먼트 20~40개(짧게 요청하면 12~18개). 첫 2~3개는 강한 훅, 중반 오픈루프, 후반 반전, 마지막은 시청자에게 질문.",
    "- 각 세그먼트에 visualQuery(영어 스톡 검색어 2~4단어)를 반드시. 예: 'foggy dark forest night','old handwritten notebook'. 실존 인물명 금지.",
    "- emphasis: 긴장 'tension', 반전 'reveal', 나머지 'normal'.",
    "",
    "[metadata] caption(첫 줄 후킹, 실화면 '실화 바탕' 뉘앙스, 마지막 질문으로 댓글 유도) + hashtags 8~15개(# 포함).",
    "",
    "안전: 확인 안 된 사실을 진짜처럼 단정하지 말 것. 과도한 잔혹성 지양.",
  ].join("\n");

  const user = seed
    ? `다음 조건/소재를 반영해서 만들어줘: ${seed}`
    : "새로운 실제 미제사건이나 역사 속 미스터리로 하나 만들어줘. 기존과 겹치지 않는 신선한 소재로.";

  const plan = await generateStructured({
    schema: ReelPlanSchema,
    system,
    user,
    temperature: 1.15,
    maxRetries: 1,
  });
  return plan as ReelPlan;
}

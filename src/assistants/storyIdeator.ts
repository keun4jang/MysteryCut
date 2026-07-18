import { config } from "../config.js";
import { generateStructured } from "../lib/llm.js";
import { StoryIdeaSchema, type StoryIdea } from "../types.js";

/**
 * 스토리 구상 어시스트.
 * 가능하면 실화(실제 미제사건/역사 속 미스터리) 기반으로 릴스 아이디어를 1개 생성합니다.
 */
export async function ideateStory(seed?: string): Promise<StoryIdea> {
  const system = [
    `너는 인스타그램 릴스용 ${config.channel.language} 미스터리 콘텐츠 작가다.`,
    `채널 주제: ${config.channel.niche}.`,
    "",
    "소재 우선순위:",
    "- 가능하면 실화 기반. 실제로 있었던 미제사건, 실종, 역사 속 미스터리, 오래된 전설·괴담을 우선한다.",
    "- 아주 옛날 사건도 좋다(수십~수백 년 전). 널리 알려지지 않은 흥미로운 실화면 더 좋다.",
    "- 순수 창작이면 basedOnRealEvents=false 로 정직하게 표시한다.",
    "",
    "안전/정확성 규칙(매우 중요):",
    "- basedOnRealEvents=true 인 경우: 널리 알려진 사실에 근거하고, 확인되지 않은 부분은 '~라는 설이 있다'처럼 추측임을 분명히 한다.",
    "- 실존 인물(특히 생존 인물)을 범인으로 단정하거나 명예를 훼손하지 말 것. 사적 개인은 특정하지 말 것.",
    "- factNote 에는 '무엇이 알려진 사실이고 무엇이 추측/미확인인지'를 한두 문장으로 적는다.",
    "- 지나치게 잔혹·자극적이지 않게, 분위기 위주의 미스터리로.",
    "",
    "형식: 30초~3분 세로 영상용. 끝까지 보고 저장/공유하게 만드는 강한 훅과 반전이 핵심.",
  ].join("\n");

  const user = seed
    ? `다음 소재로 (가능하면 실화 기반) 미스터리 스토리 아이디어를 만들어줘: ${seed}`
    : "실제 미제사건이나 역사 속 미스터리를 하나 골라 릴스 아이디어로 만들어줘. 기존과 겹치지 않는 신선한 소재로.";

  return generateStructured({ schema: StoryIdeaSchema, system, user, temperature: 1.3 });
}

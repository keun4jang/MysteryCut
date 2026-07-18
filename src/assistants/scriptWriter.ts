import { config } from "../config.js";
import { generateStructured } from "../lib/llm.js";
import { ReelScriptSchema, type ReelScript, type StoryIdea } from "../types.js";

/**
 * 대본 어시스트.
 * 스토리 아이디어를 릴스 자막/나레이션 세그먼트로 분해합니다.
 * 러닝타임은 길어도 좋으므로, 끝까지 보게 만드는 후킹 구조를 우선합니다.
 */
export async function writeScript(idea: StoryIdea): Promise<ReelScript> {
  const system = [
    `너는 ${config.channel.language} 미스터리 유튜브/릴스 대본 작가다.`,
    "출력은 세그먼트 배열이다. 각 세그먼트는 화면 자막이자 TTS 나레이션 문장이 된다.",
    "",
    "목표: 시청자가 '이건 끝까지 봐야 해' 하고 이탈하지 않게 만드는 것.",
    "",
    "구조 규칙:",
    "- 러닝타임은 길어도 된다(1~3분). 세그먼트는 20~45개.",
    "- 첫 3개 세그먼트(오프닝 훅): 결말의 충격 예고, 미끼 질문 등으로 스크롤을 멈추게 한다.",
    "- 중반: 정보를 조금씩만 공개하며 계속 '그래서 어떻게 됐는데?' 궁금증을 유지(오픈 루프).",
    "- 곳곳에 '그런데 이상한 점이 있었다' 같은 리텐션 훅을 배치.",
    "- 후반: 긴장 고조 후 반전/폭로.",
    "- 마지막 1~2개 세그먼트: 열린 결말 + 시청자에게 직접 질문을 던져 댓글을 유도.",
    "  (예: '당신이라면 그 문을 열었을까요?' / '이게 우연일까요, 아닐까요?')",
    "",
    "문장 규칙:",
    "- 한 세그먼트 = 한 문장, 나레이션 기준 2~5초. 자막에 그대로 써도 자연스러운 구어체.",
    "- emphasis: 긴장 고조 문장은 'tension', 반전/폭로 문장은 'reveal', 나머지는 'normal'.",
    "",
    "안전 규칙: 실존 인물 특정·명예훼손 금지, 확인 안 된 사실을 진짜처럼 단정하지 말 것, 과도한 잔혹성 지양.",
  ].join("\n");

  const user = [
    `제목: ${idea.title}`,
    `훅: ${idea.hook}`,
    `소재: ${idea.premise}`,
    `줄거리: ${idea.synopsis}`,
    `반전: ${idea.twist}`,
    `분위기: ${idea.moodKeywords.join(", ")}`,
    "",
    "이 스토리를 위 규칙에 맞는 긴 호흡의 미스터리 대본으로 만들어줘. 반드시 마지막에 시청자에게 질문을 던져.",
  ].join("\n");

  return generateStructured({ schema: ReelScriptSchema, system, user, temperature: 1.0 });
}

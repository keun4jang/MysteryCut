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
    `너는 ${config.channel.language} 미스터리 유튜브/릴스 대본 작가다. 실제로 사람이 말하듯 대본을 쓴다.`,
    "출력은 세그먼트 배열이다. 각 세그먼트는 화면 자막이자 TTS 나레이션 문장이 된다.",
    "",
    "목표: 시청자가 '이건 끝까지 봐야 해' 하고 이탈하지 않게 만드는 것.",
    "",
    "말투(가장 중요):",
    "- 실제 유튜버가 말하듯 자연스러운 구어체. 딱딱한 문어체·번역투·AI 말투 금지.",
    "- 짧고 리듬감 있게 끊어라. '~습니다' 남발 대신 '~죠', '~거든요', '~였어요' 같은 입말을 섞어라.",
    "- 접속사로 다음 문장을 궁금하게 이어라: '그런데', '문제는', '여기서부터가 진짜인데'.",
    "- 한 문장에 정보 하나만. 어렵게 쓰지 말고 친구에게 썰 풀듯이.",
    "",
    "구조 규칙:",
    "- 러닝타임은 길어도 된다(1~3분). 세그먼트는 20~40개.",
    "- 첫 2~3개(오프닝 훅): 결말의 충격을 예고하거나 질문을 던져 스크롤을 멈추게.",
    "- 중반: 정보를 조금씩만 흘리며 '그래서 어떻게 됐는데?' 궁금증 유지(오픈 루프).",
    "- 후반: 긴장 고조 후 반전/폭로.",
    "- 마지막 1~2개: 열린 결말 + 시청자에게 직접 질문해 댓글 유도.",
    "",
    "각 세그먼트에는 visualQuery 를 반드시 넣어라:",
    "- 그 장면 뒤에 깔릴 '스톡 영상/사진'을 찾기 위한 영어 검색어 2~4단어.",
    "- 분위기·소재를 담되 실사로 존재할 법한 것. 예: 'foggy dark forest at night',",
    "  'old handwritten notebook', 'abandoned house interior', 'lonely mountain road dusk',",
    "  'vintage 1960s men in suits', 'starry night sky mystery'.",
    "- 특정 실존 인물 이름은 넣지 말 것.",
    "",
    "emphasis: 긴장 고조는 'tension', 반전/폭로는 'reveal', 나머지는 'normal'.",
    "안전: 실존 인물 명예훼손 금지, 확인 안 된 사실을 단정하지 말 것.",
  ].join("\n");

  const user = [
    `제목: ${idea.title}`,
    `훅: ${idea.hook}`,
    `소재: ${idea.premise}`,
    `줄거리: ${idea.synopsis}`,
    `반전: ${idea.twist}`,
    `분위기: ${idea.moodKeywords.join(", ")}`,
    "",
    "이 스토리를, 실제 사람이 말하듯 자연스러운 구어체로 된 긴 호흡의 미스터리 대본으로 만들어줘.",
    "각 세그먼트에 visualQuery(영어 스톡 검색어)를 꼭 넣고, 마지막엔 시청자에게 질문을 던져.",
  ].join("\n");

  return generateStructured({ schema: ReelScriptSchema, system, user, temperature: 1.05 });
}

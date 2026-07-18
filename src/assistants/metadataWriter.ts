import { config } from "../config.js";
import { generateStructured } from "../lib/llm.js";
import {
  ReelMetadataSchema,
  type ReelMetadata,
  type ReelScript,
  type StoryIdea,
} from "../types.js";

/**
 * 캡션/해시태그 어시스트.
 * 완성된 스토리/대본을 바탕으로 인스타 게시물 캡션과 해시태그를 생성합니다.
 */
export async function writeMetadata(
  idea: StoryIdea,
  script: ReelScript,
): Promise<ReelMetadata> {
  const system = [
    `너는 ${config.channel.language} 인스타그램 미스터리 채널 운영자다.`,
    "릴스 게시물의 캡션과 해시태그를 작성한다.",
    "규칙:",
    "- 캡션 첫 줄은 후킹, 이후 궁금증을 남기고 마지막에 시청자에게 질문을 던져 댓글을 유도.",
    "- 실화 기반이면 캡션에 '실화 바탕' 뉘앙스를 자연스럽게 담되, 확인 안 된 부분은 단정하지 말 것.",
    "- 해시태그는 8~15개. 미스터리/도시전설/미제사건/썰 관련 + 도달용 인기 태그 혼합.",
    "- 과한 낚시나 허위 단정 금지.",
  ].join("\n");

  const user = [
    `제목: ${idea.title}`,
    `줄거리: ${idea.synopsis}`,
    `실화 기반 여부: ${idea.basedOnRealEvents ? "예" : "아니오(창작)"}`,
    `사실/추측 메모: ${idea.factNote}`,
    `첫 자막(훅): ${script.segments[0]?.text ?? idea.hook}`,
  ].join("\n");

  return generateStructured({
    schema: ReelMetadataSchema,
    system,
    user,
    temperature: 0.9,
  });
}

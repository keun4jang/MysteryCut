import fs from "node:fs/promises";
import path from "node:path";

/**
 * Gemini 모델 자동 추종 (인스타 Graph API 버전과 같은 패턴, src/lib/igGraphVersion.ts 참고).
 *
 * 무료 모델은 시간이 지나면 이름이 바뀌거나 폐기된다. 매 실행(=매번 새 프로세스)마다
 * 죽은 후보를 처음부터 다시 시도하면 실제 생성 호출 실패로 무료 일일 한도를 헛되이
 * 갉아먹는다. 마지막으로 성공한 모델을 파일에 기록해두고, 다음 실행은 거기서부터
 * 시작한다(시행착오 없이). 게시 워크플로가 data/history.json 과 함께 이 파일도 커밋한다.
 */
const STATE_FILE = path.join("data", "geminiModel.txt");

let cached: string | null = null;

export async function loadGeminiModel(): Promise<string | null> {
  if (cached) return cached;
  try {
    const raw = (await fs.readFile(STATE_FILE, "utf8")).trim();
    if (raw) {
      cached = raw;
      return raw;
    }
  } catch {
    /* 파일 없음 — 아직 기록된 적 없음 */
  }
  return null;
}

export async function persistGeminiModel(model: string): Promise<void> {
  if (cached === model) return; // 이미 이 모델로 기록돼 있으면 커밋 낭비 안 함
  cached = model;
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, `${model}\n`);
}

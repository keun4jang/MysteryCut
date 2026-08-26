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
  // 제자리 writeFile 은 쓰는 도중 죽으면 잘린 파일을 남긴다. 이 파일은 쇼츠·롱폼
  // 워크플로가 history.json 과 함께 커밋하는데(위 주석 10행), commitPostHistory.mts
  // 의 합성 저장은 STATE_FILES 를 '있으면 그대로 스냅샷 → 다시 씀'만 하고 내용
  // 검증은 안 해서 잘린 파일도 그대로 커밋될 수 있다 — tmp+rename 으로 원자화.
  const tmp = `${STATE_FILE}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${model}\n`);
  await fs.rename(tmp, STATE_FILE);
}

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name} 가 설정되어 있지 않습니다. .env 를 확인하세요.`);
  return v;
}

export const paths = {
  root: ROOT,
  /** Remotion static 파일 루트 (렌더 시 이 폴더가 serve 됩니다) */
  public: path.join(ROOT, "public"),
  audio: path.join(ROOT, "public", "audio"),
  out: path.join(ROOT, "out"),
  remotionEntry: path.join(ROOT, "src", "remotion", "index.ts"),
};

export const config = {
  paths,
  channel: {
    language: process.env.CHANNEL_LANGUAGE ?? "한국어",
    niche: process.env.CHANNEL_NICHE ?? "미스터리, 도시전설, 미해결 사건, 심리 스릴러",
  },
  // 스토리·대본·캡션 생성: Google Gemini 무료 등급 (하루 몇 개는 무료 한도 안에서 충분)
  llm: {
    get apiKey() {
      return required("GEMINI_API_KEY");
    },
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  },
  // 나레이션: Microsoft Edge TTS (무료, API 키 불필요, 한국어 뉴럴 음성)
  tts: {
    voice: process.env.TTS_VOICE ?? "ko-KR-SunHiNeural",
    // 미스터리 톤: 살짝 느리고 낮게
    rate: process.env.TTS_RATE ?? "-8%",
    pitch: process.env.TTS_PITCH ?? "-4Hz",
  },
  // 업로드: Instagram Graph API (무료). 프로페셔널 계정 + Facebook 연동 필요.
  instagram: {
    graphVersion: process.env.IG_GRAPH_VERSION ?? "v21.0",
    get userId() {
      return required("IG_USER_ID");
    },
    get accessToken() {
      return required("IG_ACCESS_TOKEN");
    },
    // 토큰 자동 갱신에만 사용 (Facebook 앱 자격증명)
    app: {
      get id() {
        return required("FB_APP_ID");
      },
      get secret() {
        return required("FB_APP_SECRET");
      },
    },
  },
  video: {
    width: 1080,
    height: 1920,
    fps: 30,
  },
} as const;

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

/**
 * 선택 환경변수 읽기. undefined 뿐 아니라 빈 문자열("")도 미설정으로 보고 기본값을 씁니다.
 * (GitHub Actions 는 미설정 vars 를 빈 문자열로 넘기므로 `?? 기본값` 만으로는 부족)
 */
function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v != null && v.trim() !== "" ? v : fallback;
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
    language: opt("CHANNEL_LANGUAGE", "한국어"),
    niche: opt("CHANNEL_NICHE", "미스터리, 도시전설, 미해결 사건, 심리 스릴러"),
  },
  // 스토리·대본·캡션 생성: Google Gemini 무료 등급 (하루 몇 개는 무료 한도 안에서 충분)
  llm: {
    get apiKey() {
      return required("GEMINI_API_KEY");
    },
    model: opt("GEMINI_MODEL", "gemini-2.5-flash"),
  },
  // 나레이션: Microsoft Edge TTS (무료, API 키 불필요, 한국어 뉴럴 음성)
  tts: {
    voice: opt("TTS_VOICE", "ko-KR-SunHiNeural"),
    // 미스터리 톤: 살짝 느리고 낮게
    rate: opt("TTS_RATE", "-8%"),
    pitch: opt("TTS_PITCH", "-4Hz"),
  },
  // 업로드: Instagram Graph API (무료).
  //  - instagram_login: Instagram Login 방식 (graph.instagram.com, Facebook 페이지 불필요) ← 기본, 더 간단
  //  - facebook_login : Facebook Login 방식 (graph.facebook.com, 연결된 FB 페이지 필요)
  instagram: {
    mode: opt("IG_API_MODE", "instagram_login") as "instagram_login" | "facebook_login",
    graphVersion: opt("IG_GRAPH_VERSION", "v21.0"),
    get apiBase() {
      return opt("IG_API_MODE", "instagram_login") === "facebook_login"
        ? "https://graph.facebook.com"
        : "https://graph.instagram.com";
    },
    get userId() {
      return required("IG_USER_ID");
    },
    get accessToken() {
      return required("IG_ACCESS_TOKEN");
    },
    // 앱 자격증명 (최초 장기 토큰 교환에 사용. Instagram Login 갱신에는 불필요)
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

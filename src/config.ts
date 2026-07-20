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
  broll: path.join(ROOT, "public", "broll"),
  bgm: path.join(ROOT, "public", "bgm"),
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
    model: opt("GEMINI_MODEL", "gemini-2.0-flash"),
  },
  // 나레이션 TTS.
  //  - edge  : Microsoft Edge TTS (무료, 키 불필요) — 기본
  //  - google: Google Cloud TTS Neural2 (무료 등급 내, 더 자연스러움) — GOOGLE_TTS_API_KEY 있으면 자동 사용
  tts: {
    get provider() {
      const p = opt("TTS_PROVIDER", "");
      if (p === "edge" || p === "google") return p;
      return process.env.GOOGLE_TTS_API_KEY?.trim() ? "google" : "edge";
    },
    // edge (미스터리 톤: 낮고 묵직한 남성 음성, 또박또박 빠른 편)
    //  - rate +8%: -10% 균일 스트레치는 로봇/멍한 톤의 주범이라 오히려 살짝 빠르게
    //  - pitch -4Hz: InJoon 은 원래 저음, 더 낮춰 무게감(어두운 미스터리 톤)
    voice: opt("TTS_VOICE", "ko-KR-InJoonNeural"),
    rate: opt("TTS_RATE", "+8%"),
    pitch: opt("TTS_PITCH", "-4Hz"),
    google: {
      get apiKey() {
        return required("GOOGLE_TTS_API_KEY");
      },
      // 낮고 묵직한 남성 톤(ko-KR-Neural2-C), edge 와 동일하게 살짝 빠르고 더 낮게
      voice: opt("GOOGLE_TTS_VOICE", "ko-KR-Neural2-C"),
      speakingRate: Number(opt("GOOGLE_TTS_RATE", "1.08")), // 1.0=보통, 살짝 빠르게
      pitch: Number(opt("GOOGLE_TTS_PITCH", "-4.0")), // 반음 단위, 더 낮고 무겁게
      // 무료 한도(월 100만 자) 보호: 영상 1개당 글자수 상한 (2/day 기준 월 9만 자 수준)
      maxCharsPerRun: Number(opt("GOOGLE_TTS_MAX_CHARS", "15000")),
    },
  },
  // 배경 자료화면: Pexels 무료 스톡 (키 없으면 그라디언트 폴백)
  pexels: {
    apiKey: opt("PEXELS_API_KEY", ""),
  },
  // BGM: public/bgm/ 에 mp3 가 있으면 자동으로 깔림. 기본 eerie.mp3(저장소 포함)가 항상 재생됨.
  // (실제 믹스 볼륨은 MysteryReel.tsx 의 BGM_VOLUME 상수에서 적용)
  bgm: {
    volume: Number(opt("BGM_VOLUME", "0.22")),
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

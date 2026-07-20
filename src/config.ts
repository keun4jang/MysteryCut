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
    // edge (미스터리 톤: 낮고 묵직한 남성 음성, 차분한 보통 속도)
    //  - rate 0%: +8% 는 너무 빨라서 보통 속도로. (-10% 처럼 크게 늘리면 로봇 톤)
    //  - pitch -4Hz: InJoon 은 원래 저음, 더 낮춰 무게감(어두운 미스터리 톤)
    voice: opt("TTS_VOICE", "ko-KR-InJoonNeural"),
    rate: opt("TTS_RATE", "+0%"),
    pitch: opt("TTS_PITCH", "-4Hz"),
    google: {
      get apiKey() {
        return required("GOOGLE_TTS_API_KEY");
      },
      // 저음 남성 딥보이스: Google 최신 Chirp3-HD Charon(묵직한 남성).
      //  - Chirp3-HD 는 pitch 파라미터 미지원 → narrator 가 자동으로 pitch 를 빼고 요청.
      //  - 실패 시 남성 Neural2-C(pitch 지원)로 자동 폴백.
      voice: opt("GOOGLE_TTS_VOICE", "ko-KR-Chirp3-HD-Charon"),
      fallbackVoice: opt("GOOGLE_TTS_FALLBACK_VOICE", "ko-KR-Neural2-C"),
      speakingRate: Number(opt("GOOGLE_TTS_RATE", "0.96")), // 살짝 느리고 무게감 있게
      pitch: Number(opt("GOOGLE_TTS_PITCH", "-4.0")), // 반음 단위(Chirp3-HD 엔 미적용)
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
  // 업로드: YouTube Data API v3 (무료, Shorts 자동 분류). OAuth 필요.
  //  YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN 이 모두 있으면 자동으로 유튜브에도 게시.
  youtube: {
    // 세 값이 모두 있어야 활성화 (하나라도 없으면 유튜브 업로드 건너뜀)
    get enabled() {
      return Boolean(
        process.env.YT_CLIENT_ID?.trim() &&
          process.env.YT_CLIENT_SECRET?.trim() &&
          process.env.YT_REFRESH_TOKEN?.trim(),
      );
    },
    get clientId() {
      return required("YT_CLIENT_ID");
    },
    get clientSecret() {
      return required("YT_CLIENT_SECRET");
    },
    get refreshToken() {
      return required("YT_REFRESH_TOKEN");
    },
    // public | unlisted | private (첫 테스트는 unlisted 권장)
    privacyStatus: opt("YT_PRIVACY", "public"),
    categoryId: opt("YT_CATEGORY_ID", "24"), // 24 = Entertainment
  },
  video: {
    width: 1080,
    height: 1920,
    fps: 30,
  },
} as const;

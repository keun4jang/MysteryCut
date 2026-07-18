import { config } from "../config.js";

/**
 * Instagram(Facebook) 장기 액세스 토큰 갱신 도구.
 *
 * 기존 장기 토큰을 fb_exchange_token 으로 재교환하여 만료 기간이 새로 60일인
 * 토큰을 발급받습니다. 성공 시 **새 토큰만 stdout 으로** 출력하고(자동화에서
 * 캡처하기 쉽게), 만료 정보는 stderr 로 로깅합니다.
 *
 * 필요 환경변수: FB_APP_ID, FB_APP_SECRET, IG_ACCESS_TOKEN
 */
async function main() {
  const url = new URL(
    `https://graph.facebook.com/${config.instagram.graphVersion}/oauth/access_token`,
  );
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", config.instagram.app.id);
  url.searchParams.set("client_secret", config.instagram.app.secret);
  url.searchParams.set("fb_exchange_token", config.instagram.accessToken);

  const res = await fetch(url);
  const json = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    error?: unknown;
  };

  if (!res.ok || !json.access_token) {
    console.error("토큰 갱신 실패:", JSON.stringify(json));
    process.exit(1);
  }

  const days = json.expires_in ? Math.round(json.expires_in / 86400) : "?";
  console.error(`✅ 토큰 갱신 성공 (약 ${days}일 유효)`);

  // 새 토큰만 stdout 으로 (워크플로에서 gh secret set 으로 저장)
  process.stdout.write(json.access_token);
}

main().catch((err) => {
  console.error("토큰 갱신 오류:", err);
  process.exit(1);
});

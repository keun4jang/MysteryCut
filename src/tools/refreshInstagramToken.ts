import { config } from "../config.js";

/**
 * Instagram 장기 액세스 토큰 갱신 도구.
 *
 * - instagram_login 모드: ig_refresh_token 으로 갱신 (앱 시크릿 불필요).
 * - facebook_login 모드: fb_exchange_token 으로 재교환 (앱 시크릿 필요).
 *
 * 성공 시 새 토큰만 stdout 으로 출력하고, 만료 정보는 stderr 로 로깅합니다.
 * (워크플로에서 stdout 을 캡처해 gh secret set 으로 저장)
 */
async function main() {
  const token =
    config.instagram.mode === "facebook_login"
      ? await refreshFacebook()
      : await refreshInstagram();

  process.stdout.write(token);
}

/** Instagram Login: 앱 시크릿 없이 토큰만으로 갱신 */
async function refreshInstagram(): Promise<string> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", config.instagram.accessToken);

  const res = await fetch(url);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) {
    console.error("토큰 갱신 실패(instagram_login):", JSON.stringify(json));
    process.exit(1);
  }
  logDays(json.expires_in);
  return json.access_token;
}

/** Facebook Login: fb_exchange_token 재교환 (앱 시크릿 필요) */
async function refreshFacebook(): Promise<string> {
  const url = new URL(
    `https://graph.facebook.com/${config.instagram.graphVersion}/oauth/access_token`,
  );
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", config.instagram.app.id);
  url.searchParams.set("client_secret", config.instagram.app.secret);
  url.searchParams.set("fb_exchange_token", config.instagram.accessToken);

  const res = await fetch(url);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) {
    console.error("토큰 갱신 실패(facebook_login):", JSON.stringify(json));
    process.exit(1);
  }
  logDays(json.expires_in);
  return json.access_token;
}

function logDays(expiresIn?: number) {
  const days = expiresIn ? Math.round(expiresIn / 86400) : "?";
  console.error(`✅ 토큰 갱신 성공 (약 ${days}일 유효, 모드=${config.instagram.mode})`);
}

main().catch((err) => {
  console.error("토큰 갱신 오류:", err);
  process.exit(1);
});

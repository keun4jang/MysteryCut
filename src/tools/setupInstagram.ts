import { config } from "../config.js";

/**
 * 인스타 최초 셋업 도구. IG_USER_ID 와 장기 IG_ACCESS_TOKEN 을 출력합니다.
 * 출력값을 .env 또는 GitHub Secrets 에 넣으면 됩니다.
 *
 * ── instagram_login 모드 (기본, Facebook 페이지 불필요) ──
 *   앱 대시보드 → Instagram → API setup with Instagram login → "Generate access tokens"
 *   에서 받은 토큰을 IG_USER_TOKEN 으로 넣고 실행.
 *   필요: IG_USER_TOKEN, (선택) FB_APP_SECRET(=Instagram app secret, 장기토큰 교환용)
 *
 * ── facebook_login 모드 ──
 *   Graph API Explorer 사용자 토큰을 IG_USER_TOKEN 으로 넣고 실행.
 *   필요: FB_APP_ID, FB_APP_SECRET, IG_USER_TOKEN, (선택) PAGE_NAME
 */
async function main() {
  const userToken = process.env.IG_USER_TOKEN ?? process.env.FB_USER_TOKEN;
  if (!userToken) {
    throw new Error(
      "IG_USER_TOKEN 이 필요합니다. (instagram_login: 앱 대시보드에서 Generate token / facebook_login: Graph API Explorer 사용자 토큰)",
    );
  }

  if (config.instagram.mode === "facebook_login") {
    await setupFacebook(userToken);
  } else {
    await setupInstagram(userToken);
  }
}

/** Instagram Login: 토큰 → (선택)장기 교환 → user_id 조회 */
async function setupInstagram(userToken: string) {
  const V = config.instagram.graphVersion;
  let longToken = userToken;
  let days = 60;

  // 앱 시크릿이 있으면 장기 토큰으로 교환 (ig_exchange_token)
  const secret = process.env.FB_APP_SECRET;
  if (secret) {
    const ex = new URL("https://graph.instagram.com/access_token");
    ex.searchParams.set("grant_type", "ig_exchange_token");
    ex.searchParams.set("client_secret", secret);
    ex.searchParams.set("access_token", userToken);
    const r = await fetch(ex);
    const j = (await r.json()) as { access_token?: string; expires_in?: number };
    if (r.ok && j.access_token) {
      longToken = j.access_token;
      if (j.expires_in) days = Math.round(j.expires_in / 86400);
    } else {
      console.error("⚠️  장기 토큰 교환 실패(제공된 토큰 그대로 사용):", JSON.stringify(j));
    }
  }

  // user_id / username 조회
  const meUrl = new URL(`https://graph.instagram.com/${V}/me`);
  meUrl.searchParams.set("fields", "user_id,username");
  meUrl.searchParams.set("access_token", longToken);
  const meRes = await fetch(meUrl);
  const me = (await meRes.json()) as { user_id?: string; username?: string; id?: string };
  const igUserId = me.user_id ?? me.id;
  if (!meRes.ok || !igUserId) {
    throw new Error(`계정 조회 실패: ${JSON.stringify(me)}`);
  }

  print(igUserId, longToken, me.username ?? "(unknown)", days, "instagram_login");
}

/** Facebook Login: 사용자 토큰 → 장기 교환 → 페이지의 IG 비즈니스 계정 id 조회 */
async function setupFacebook(userToken: string) {
  const V = config.instagram.graphVersion;

  const exUrl = new URL(`https://graph.facebook.com/${V}/oauth/access_token`);
  exUrl.searchParams.set("grant_type", "fb_exchange_token");
  exUrl.searchParams.set("client_id", config.instagram.app.id);
  exUrl.searchParams.set("client_secret", config.instagram.app.secret);
  exUrl.searchParams.set("fb_exchange_token", userToken);
  const exRes = await fetch(exUrl);
  const ex = (await exRes.json()) as { access_token?: string; expires_in?: number };
  if (!exRes.ok || !ex.access_token) throw new Error(`장기 토큰 교환 실패: ${JSON.stringify(ex)}`);
  const longToken = ex.access_token;
  const days = ex.expires_in ? Math.round(ex.expires_in / 86400) : 60;

  const pagesUrl = new URL(`https://graph.facebook.com/${V}/me/accounts`);
  pagesUrl.searchParams.set("fields", "name,instagram_business_account{id,username}");
  pagesUrl.searchParams.set("access_token", longToken);
  const pgRes = await fetch(pagesUrl);
  const pg = (await pgRes.json()) as {
    data?: Array<{ name: string; instagram_business_account?: { id: string; username?: string } }>;
  };
  const pages = pg.data ?? [];
  const candidates = pages.filter((p) => p.instagram_business_account);
  const wantName = process.env.PAGE_NAME;
  const page =
    (wantName ? candidates.find((p) => p.name === wantName) : undefined) ?? candidates[0];
  if (!page?.instagram_business_account) {
    console.error("발견된 페이지:", pages.map((p) => p.name).join(", ") || "(없음)");
    throw new Error("페이지에 연결된 IG 비즈니스 계정을 찾지 못했습니다. 연결 후 다시 실행하세요.");
  }
  print(
    page.instagram_business_account.id,
    longToken,
    page.instagram_business_account.username ?? "(unknown)",
    days,
    `facebook_login / page=${page.name}`,
  );
}

function print(igUserId: string, token: string, username: string, days: number, mode: string) {
  console.log("");
  console.log(`✅ 인스타: @${username}  (모드: ${mode})`);
  console.log(`✅ 장기 토큰 (약 ${days}일 유효)`);
  console.log("");
  console.log("아래 값을 .env(로컬) 또는 GitHub Secrets 에 넣으세요:");
  console.log("────────────────────────────────────────");
  console.log(`IG_USER_ID=${igUserId}`);
  console.log(`IG_ACCESS_TOKEN=${token}`);
  console.log("────────────────────────────────────────");
  console.log("(이 값은 화면에만 출력됩니다. 안전한 곳에만 저장하세요.)");
}

main().catch((err) => {
  console.error("셋업 오류:", err instanceof Error ? err.message : err);
  process.exit(1);
});

import { config } from "../config.js";

/**
 * 인스타 최초 셋업 도구.
 *
 * Graph API Explorer 등에서 받은 사용자 토큰(FB_USER_TOKEN)을 가지고:
 *  1) 장기 토큰(약 60일)으로 교환하고
 *  2) 연결된 페이지에서 Instagram 비즈니스 계정 ID(IG_USER_ID)를 찾아
 * 두 값을 출력합니다. 출력된 값을 .env 또는 GitHub Secrets 에 넣으세요.
 *
 * 필요 환경변수: FB_APP_ID, FB_APP_SECRET, FB_USER_TOKEN
 * 선택: PAGE_NAME (연결된 페이지가 여러 개일 때 이름으로 지정, 예: "Mystery.cut")
 */
async function main() {
  const V = config.instagram.graphVersion;
  const userToken = process.env.FB_USER_TOKEN;
  if (!userToken) {
    throw new Error(
      "FB_USER_TOKEN 이 필요합니다. Graph API Explorer 에서 instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement, business_management 권한으로 사용자 토큰을 받아 환경변수로 넣으세요.",
    );
  }

  // 1) 장기 토큰 교환
  const exchangeUrl = new URL(`https://graph.facebook.com/${V}/oauth/access_token`);
  exchangeUrl.searchParams.set("grant_type", "fb_exchange_token");
  exchangeUrl.searchParams.set("client_id", config.instagram.app.id);
  exchangeUrl.searchParams.set("client_secret", config.instagram.app.secret);
  exchangeUrl.searchParams.set("fb_exchange_token", userToken);

  const exRes = await fetch(exchangeUrl);
  const ex = (await exRes.json()) as { access_token?: string; expires_in?: number };
  if (!exRes.ok || !ex.access_token) {
    throw new Error(`장기 토큰 교환 실패: ${JSON.stringify(ex)}`);
  }
  const longToken = ex.access_token;
  const days = ex.expires_in ? Math.round(ex.expires_in / 86400) : 60;

  // 2) 연결된 페이지 목록 + 각 페이지의 IG 비즈니스 계정 조회
  const pagesUrl = new URL(`https://graph.facebook.com/${V}/me/accounts`);
  pagesUrl.searchParams.set("fields", "name,instagram_business_account{id,username}");
  pagesUrl.searchParams.set("access_token", longToken);

  const pgRes = await fetch(pagesUrl);
  const pg = (await pgRes.json()) as {
    data?: Array<{
      name: string;
      instagram_business_account?: { id: string; username?: string };
    }>;
  };
  const pages = pg.data ?? [];
  if (pages.length === 0) {
    throw new Error(
      "연결된 페이지가 없습니다. 인스타 프로페셔널 계정을 이 Facebook 페이지에 연결했는지 확인하세요.",
    );
  }

  const wantName = process.env.PAGE_NAME;
  const candidates = pages.filter((p) => p.instagram_business_account);
  const page =
    (wantName ? candidates.find((p) => p.name === wantName) : undefined) ??
    candidates[0];

  if (!page?.instagram_business_account) {
    console.error("페이지는 있지만 연결된 IG 비즈니스 계정을 찾지 못했습니다.");
    console.error("발견된 페이지:", pages.map((p) => p.name).join(", "));
    throw new Error("인스타 프로 계정을 페이지에 연결한 뒤 다시 실행하세요.");
  }

  const igUserId = page.instagram_business_account.id;
  const username = page.instagram_business_account.username ?? "(unknown)";

  console.log("");
  console.log(`✅ 페이지: ${page.name}  /  인스타: @${username}`);
  console.log(`✅ 장기 토큰 (약 ${days}일 유효)`);
  console.log("");
  console.log("아래 값을 .env(로컬) 또는 GitHub Secrets 에 넣으세요:");
  console.log("────────────────────────────────────────");
  console.log(`IG_USER_ID=${igUserId}`);
  console.log(`IG_ACCESS_TOKEN=${longToken}`);
  console.log("────────────────────────────────────────");
  console.log("(이 값은 화면에만 출력됩니다. 안전한 곳에만 저장하세요.)");
}

main().catch((err) => {
  console.error("셋업 오류:", err instanceof Error ? err.message : err);
  process.exit(1);
});

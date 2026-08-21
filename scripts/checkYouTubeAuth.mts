/**
 * 유튜브 토큰 점검 — 게시하지 않고 권한만 확인한다.
 *
 * 드라이런(--no-publish)은 업로드 경로를 아예 타지 않아서 토큰이 고쳐졌는지
 * 알 수 없다. 그렇다고 확인하려고 실제 게시를 돌리면 인스타에 중복으로
 * 올라간다. 그래서 읽기 전용 호출만으로 판정한다.
 *
 * 1) refresh_token 으로 access_token 을 받는다 (client_id/secret 짝이 맞는지)
 * 2) tokeninfo 로 실제 부여된 스코프 목록을 받는다 (무엇이 빠졌는지)
 * 3) channels.list 로 채널을 읽는다 (1 unit — 쿼터에 사실상 무해)
 *
 * 2026-08-20 사고: yt-analytics.readonly 만 선택해 재발급받는 바람에
 * youtube.upload 가 빠졌고, 쇼츠·롱폼 업로드가 전부 403 으로 죽었다.
 * 그 사고를 30초 만에 잡아내는 것이 이 스크립트의 목적이다.
 */
import { config } from "../src/config.js";

const NEEDED = [
  ["https://www.googleapis.com/auth/youtube.upload", "영상 업로드"],
  ["https://www.googleapis.com/auth/youtube.force-ssl", "썸네일·자막 트랙 등록"],
  ["https://www.googleapis.com/auth/yt-analytics.readonly", "채널 성과 조회"],
] as const;

const { clientId, clientSecret, refreshToken } = config.youtube;
for (const [name, v] of [
  ["YT_CLIENT_ID", clientId],
  ["YT_CLIENT_SECRET", clientSecret],
  ["YT_REFRESH_TOKEN", refreshToken],
] as const) {
  if (!v) {
    console.error(`❌ ${name} 이 비어 있습니다.`);
    process.exit(1);
  }
}

// ① 액세스 토큰 교환
const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  }),
});
const token = (await tokenRes.json()) as {
  access_token?: string;
  error?: string;
  error_description?: string;
};
if (!token.access_token) {
  console.error(`❌ 액세스 토큰 발급 실패: ${token.error} — ${token.error_description ?? ""}`);
  if (token.error === "invalid_client") {
    console.error(
      "   YT_CLIENT_ID 와 YT_CLIENT_SECRET 이 서로 짝이 아니거나 잘못된 값입니다.",
    );
  }
  if (token.error === "invalid_grant") {
    console.error(
      "   리프레시 토큰이 폐기됐거나, 발급한 클라이언트가 지금 시크릿과 다릅니다.\n" +
        "   OAuth 동의 화면이 '테스트' 상태면 7일 만에 이렇게 됩니다.",
    );
  }
  process.exit(1);
}
console.log("✅ 액세스 토큰 발급 성공 (client_id/secret/refresh_token 짝이 맞음)");

// ② 실제 부여된 스코프 확인
const infoRes = await fetch(
  `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token.access_token)}`,
);
const info = (await infoRes.json()) as { scope?: string };
const granted = new Set((info.scope ?? "").split(/\s+/).filter(Boolean));

let missing = 0;
console.log("\n스코프:");
for (const [scope, why] of NEEDED) {
  const ok = granted.has(scope);
  if (!ok) missing++;
  console.log(`  ${ok ? "✅" : "❌"} ${scope.split("/auth/")[1]}  (${why})`);
}
const extra = [...granted].filter((s) => !NEEDED.some(([n]) => n === s));
if (extra.length) console.log(`  ·  그 외: ${extra.map((s) => s.split("/auth/")[1] ?? s).join(", ")}`);

// ③ 채널 읽기 (1 unit)
const chRes = await fetch(
  "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
  { headers: { Authorization: `Bearer ${token.access_token}` } },
);
const ch = (await chRes.json()) as {
  items?: Array<{ snippet?: { title?: string }; statistics?: { subscriberCount?: string; videoCount?: string } }>;
};
const me = ch.items?.[0];
if (me) {
  console.log(
    `\n채널: ${me.snippet?.title} — 구독자 ${me.statistics?.subscriberCount}, 영상 ${me.statistics?.videoCount}개`,
  );
} else {
  console.log("\n⚠️ 채널 정보를 못 읽었습니다 (권한 부족이거나 채널이 없는 계정)");
}

if (missing) {
  console.error(
    `\n❌ 스코프 ${missing}개 부족 — 이 상태로는 게시가 403 으로 실패합니다.\n` +
      "   OAuth Playground 에서 세 스코프를 모두 체크해 다시 발급받으세요.",
  );
  process.exit(1);
}
console.log("\n✅ 전부 정상 — 게시가 가능한 상태입니다.");

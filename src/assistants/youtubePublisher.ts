import fs from "node:fs/promises";
import { config } from "../config.js";
import type { StoryIdea, ReelMetadata } from "../types.js";

/**
 * YouTube 업로드 어시스트 (YouTube Data API v3, 무료).
 * 세로 1080x1920 · 60초 안팎이라 자동으로 Shorts 로 분류됩니다.
 *
 * 인증: OAuth 2.0 (설치형 앱). client_id/secret + refresh_token 으로 access_token 을
 * 발급받아 resumable 업로드합니다. (YT_CLIENT_ID/YT_CLIENT_SECRET/YT_REFRESH_TOKEN)
 *
 * 흐름: 리프레시 토큰 → 액세스 토큰 → resumable 세션 생성 → 바이트 PUT → videoId.
 */
export async function publishYouTube(
  videoPath: string,
  idea: StoryIdea,
  metadata: ReelMetadata,
): Promise<{ videoId: string }> {
  const accessToken = await getAccessToken();
  const bytes = await fs.readFile(videoPath);

  const snippet = {
    title: buildTitle(idea),
    description: buildDescription(metadata),
    categoryId: config.youtube.categoryId,
    tags: metadata.hashtags.map((t) => t.replace(/^#/, "")).slice(0, 15),
  };
  const status = {
    privacyStatus: config.youtube.privacyStatus,
    selfDeclaredMadeForKids: false,
  };

  // 1) resumable 업로드 세션 시작
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(bytes.byteLength),
      },
      body: JSON.stringify({ snippet, status }),
    },
  );
  if (!initRes.ok) {
    throw new Error(`YouTube 업로드 세션 생성 실패: ${await initRes.text()}`);
  }
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube 업로드 URL(Location 헤더)을 못 받았습니다.");

  // 2) 영상 바이트 업로드
  const upRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.byteLength) },
    body: new Uint8Array(bytes),
  });
  const json = (await upRes.json()) as { id?: string; error?: unknown };
  if (!upRes.ok || !json.id) {
    throw new Error(`YouTube 업로드 실패: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return { videoId: json.id };
}

/** 리프레시 토큰으로 새 액세스 토큰 발급 */
async function getAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    client_id: config.youtube.clientId,
    client_secret: config.youtube.clientSecret,
    refresh_token: config.youtube.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const json = (await res.json()) as { access_token?: string; error?: unknown };
  if (!res.ok || !json.access_token) {
    throw new Error(`YouTube 액세스 토큰 발급 실패: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

/** 유튜브 제목 (100자 제한). 제목 자체엔 해시태그를 넣지 않는다. */
function buildTitle(idea: StoryIdea): string {
  const base = idea.title?.trim() || idea.hook.trim();
  return base.length > 90 ? `${base.slice(0, 89)}…` : base;
}

/** 유튜브 설명 = 캡션 + 해시태그(+#Shorts 로 쇼츠 분류 유도) */
function buildDescription(m: ReelMetadata): string {
  const tags = m.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`));
  if (!tags.some((t) => /^#shorts$/i.test(t))) tags.push("#Shorts");
  return `${m.caption}\n\n${tags.join(" ")}`;
}

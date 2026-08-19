import fs from "node:fs/promises";
import { config } from "../config.js";
import type { StoryIdea, ReelMetadata, LongformScript } from "../types.js";

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
  /** 커스텀 썸네일 jpg 경로 (유튜브는 첫 프레임을 자동 채택하지 않으므로 직접 지정) */
  thumbPath?: string,
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

  // 3) 커스텀 썸네일 지정 (실패해도 게시 자체는 성공으로 처리)
  if (thumbPath) await setThumbnail(json.id, thumbPath, accessToken);

  // 4) 자동자막 억제: 빈 한국어 자막 트랙 등록 (있으면 유튜브가 자동자막 대신 사용)
  await suppressAutoCaptions(json.id, accessToken);

  return { videoId: json.id };
}

/**
 * 롱폼(가로 16:9) 업로드.
 *
 * 쇼츠와 다른 점: 3분을 넘고 가로라서 Shorts 로 분류되지 않는다(= 시청 시간이
 * YPP 4,000시간에 산입된다). 썸네일도 첫 프레임이 아니라 전용 1280x720 이미지를
 * 올린다. 자동자막 억제는 하지 않는다 — 롱폼은 화면 자막이 하단 한 줄뿐이라
 * 자동자막이 겹치지 않고, CC 가 있으면 접근성·검색에 오히려 유리하다.
 */
export async function publishLongform(
  videoPath: string,
  script: LongformScript,
  /** 위키백과 참고자료 (설명란 하단) */
  citation: string | undefined,
  thumbPath?: string,
): Promise<{ videoId: string }> {
  const accessToken = await getAccessToken();
  const bytes = await fs.readFile(videoPath);

  const description = [script.description.trim(), citation?.trim()]
    .filter(Boolean)
    .join("\n\n———\n\n");

  const snippet = {
    title: script.title.slice(0, 100),
    description: description.slice(0, 4900),
    categoryId: config.youtube.categoryId,
    tags: (script.tags ?? []).map((t) => t.replace(/^#/, "")).slice(0, 15),
    defaultLanguage: "ko",
    defaultAudioLanguage: "ko",
  };
  const status = {
    privacyStatus: config.youtube.privacyStatus,
    selfDeclaredMadeForKids: false,
  };

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
  if (!initRes.ok) throw new Error(`YouTube 롱폼 업로드 세션 생성 실패: ${await initRes.text()}`);
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube 업로드 URL(Location 헤더)을 못 받았습니다.");

  const upRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.byteLength) },
    body: new Uint8Array(bytes),
  });
  const json = (await upRes.json()) as { id?: string };
  if (!upRes.ok || !json.id) {
    throw new Error(`YouTube 롱폼 업로드 실패: ${JSON.stringify(json).slice(0, 400)}`);
  }

  if (thumbPath) await setThumbnail(json.id, thumbPath, accessToken);
  return { videoId: json.id };
}

/**
 * 자동 생성 자막이 화면 자막과 겹쳐 보이는 문제 억제.
 * 유튜브는 업로드된 자막 트랙이 있으면 자동자막 대신 그것을 쓰므로,
 * 사실상 빈 한국어 SRT 를 등록해 아무것도 표시되지 않게 한다.
 * captions.insert 는 youtube.force-ssl 스코프 필요 — 없으면 안내만 남기고 계속.
 */
export async function suppressAutoCaptions(
  videoId: string,
  accessToken: string,
): Promise<boolean> {
  // 완전히 빈 파일은 거부될 수 있어 0.4초짜리 공백 큐 하나를 넣는다 (검증된 포맷)
  const blankSrt = "1\n00:00:00,000 --> 00:00:00,400\n \n";
  const meta = JSON.stringify({
    snippet: { videoId, language: "ko", name: "", isDraft: false },
  });
  const boundary = "mysterycut_caption_boundary";
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${blankSrt}\r\n` +
    `--${boundary}--`;

  try {
    const res = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (res.ok) {
      console.log("   🔇 자동자막 억제용 빈 자막 트랙 등록 완료");
      return true;
    }
    const text = (await res.text()).replace(/\s+/g, " ").slice(0, 250);
    if (res.status === 403 && /insufficient|scope/i.test(text)) {
      console.warn(
        "   ⚠️ 자막 등록 권한 부족(youtube.force-ssl 스코프 필요) — YT_REFRESH_TOKEN 을 " +
          "youtube.upload + youtube.force-ssl 두 스코프로 재발급하면 자동자막 억제가 활성화됩니다.",
      );
    } else if (res.status === 409) {
      console.log("   🔇 자막 트랙이 이미 존재 — 건너뜀");
      return true;
    } else if (res.status === 403 && /quota/i.test(text)) {
      console.warn("   ⚠️ 유튜브 일일 쿼터 초과 — 남은 영상은 내일 이어서 처리하세요.");
    } else {
      console.warn(`   ⚠️ 자막 등록 실패(게시는 완료됨): HTTP ${res.status} ${text}`);
    }
  } catch (e) {
    console.warn(`   ⚠️ 자막 등록 실패(게시는 완료됨): ${e instanceof Error ? e.message : e}`);
  }
  return false;
}

/** 리프레시 토큰으로 액세스 토큰 발급 (백필 스크립트에서도 사용) */
export async function getYoutubeAccessToken(): Promise<string> {
  return getAccessToken();
}

/**
 * thumbnails.set — 업로드한 영상에 커스텀 썸네일 지정.
 * 채널이 전화번호 인증(고급 기능)돼 있어야 허용됨. 403 이면 안내만 남기고 계속.
 */
async function setThumbnail(
  videoId: string,
  thumbPath: string,
  accessToken: string,
): Promise<void> {
  try {
    const img = await fs.readFile(thumbPath);
    const res = await fetch(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "image/jpeg",
          "Content-Length": String(img.byteLength),
        },
        body: new Uint8Array(img),
      },
    );
    if (res.ok) {
      console.log("   🖼️  유튜브 커스텀 썸네일 지정 완료");
    } else {
      const body = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
      console.warn(
        `   ⚠️ 유튜브 썸네일 지정 실패(게시는 완료됨): HTTP ${res.status} ${body}` +
          (res.status === 403
            ? " — 채널 전화번호 인증이 필요할 수 있음: https://www.youtube.com/verify"
            : ""),
      );
    }
  } catch (e) {
    console.warn(
      `   ⚠️ 유튜브 썸네일 지정 실패(게시는 완료됨): ${e instanceof Error ? e.message : e}`,
    );
  }
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
  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    // refresh_token 은 access_token 과 달리 자동 재발급이 불가능하다(사람이
    // OAuth 동의를 다시 거쳐야 함). invalid_grant 는 원인이 여러 갈래라
    // (동의 화면이 '테스트' 상태 → 7일 만료 / 6개월 미사용 / 사용자가 접근 취소 /
    //  같은 클라이언트의 리프레시 토큰 50개 초과로 오래된 것부터 폐기) 그냥
    // 에러만 던지면 5년 뒤 디버깅하는 사람이 원인을 못 찾는다. 명확히 짚어준다.
    if (json.error === "invalid_grant") {
      throw new Error(
        `YouTube 리프레시 토큰이 더 이상 유효하지 않습니다(invalid_grant: ${json.error_description ?? "?"}). ` +
          "가능한 원인: (1) Google Cloud Console 의 OAuth 동의 화면이 '테스트' 상태면 토큰이 7일 만에 만료됩니다 " +
          "— '프로덕션'으로 전환하세요. (2) 6개월 이상 미사용. (3) 사용자가 앱 접근을 취소함. " +
          "(4) 같은 클라이언트의 리프레시 토큰이 50개를 넘어 오래된 것부터 자동 폐기됨. " +
          "해결: OAuth Playground 에서 다시 인증해 새 리프레시 토큰을 받고 YT_REFRESH_TOKEN 시크릿을 교체하세요.",
      );
    }
    throw new Error(`YouTube 액세스 토큰 발급 실패: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

/** 유튜브 제목 (100자 제한). 제목 자체엔 해시태그를 넣지 않는다. */
function buildTitle(idea: StoryIdea): string {
  const base = idea.title?.trim() || idea.hook.trim();
  return base.length > 90 ? `${base.slice(0, 89)}…` : base;
}

/**
 * 유튜브 설명 = 한글 캡션(위) + 영어 번역(아래) — 글로벌 시청자 대응.
 * 해시태그 없음(키워드는 본문에 녹아 있음). 검색용 키워드는 snippet.tags 로만.
 * 세로 1080x1920·3분 미만이라 #Shorts 없이도 쇼츠로 자동 분류됨.
 */
function buildDescription(m: ReelMetadata): string {
  const body = m.captionEn?.trim()
    ? `${m.caption}\n\n———\n\n${m.captionEn}`
    : m.caption;
  // 참고자료는 유튜브 설명란에만 붙인다(인스타는 링크가 클릭되지 않아 노이즈만 된다).
  // 시청자 신뢰뿐 아니라, 수익창출 심사에서 '조사에 근거한 콘텐츠'임을 보이는 근거가 된다.
  return m.sourcesCitation?.trim() ? `${body}\n\n———\n\n${m.sourcesCitation}` : body;
}

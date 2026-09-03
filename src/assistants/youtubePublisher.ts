import fs from "node:fs/promises";
import { config } from "../config.js";
import { loadLatestLongform } from "../lib/latestLongform.js";
import { loadLongformPlaylistId, persistLongformPlaylistId } from "../lib/longformPlaylist.js";
import type { StoryIdea, ReelMetadata, LongformScript } from "../types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 일시 장애에 강한 fetch — 네트워크 오류(fetch failed 류)와 429/5xx 만 재시도한다.
 *
 * 렌더에 40분을 쓴 뒤 업로드가 502 한 번에 죽으면 그날 게시가 통째로 날아간다
 * (재실행하면 대본부터 전부 다시 만든다). 유튜브 업로드는 resumable 프로토콜이라
 * **같은 세션 URL 로 다시 PUT 해도 중복 영상이 생기지 않는다** — 같은 세션은
 * 같은 영상 하나로 귀결되므로 재시도가 안전하다. 세션 생성(init)과 토큰 발급도
 * 영상이 만들어지기 전 단계라 재시도로 중복이 생길 수 없다.
 * 4xx(429 제외)는 재시도해도 같은 답이라 즉시 반환해 호출부가 처리하게 둔다.
 */
async function fetchRetry(
  url: string,
  init: RequestInit,
  label: string,
  attempts = 4,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        if (i < attempts - 1) {
          const wait = 3000 * 3 ** i;
          console.warn(`   ⚠️ ${label} HTTP ${res.status} — ${wait / 1000}s 후 재시도 (${i + 1}/${attempts})`);
          await sleep(wait);
          continue;
        }
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        const wait = 3000 * 3 ** i;
        console.warn(
          `   ⚠️ ${label} 네트워크 오류 — ${wait / 1000}s 후 재시도 (${i + 1}/${attempts}): ${e instanceof Error ? e.message : e}`,
        );
        await sleep(wait);
      }
    }
  }
  throw lastErr ?? new Error(`${label}: ${attempts}회 시도 모두 실패`);
}

/**
 * '게시됐지만 기록 안 됨' 창을 닫는 안전망.
 *
 * 영상 바이트 PUT 이 유튜브 서버에는 완전히 도착해 videoId 가 발급됐는데,
 * 그 응답을 받는 도중 네트워크가 끊기면(파싱 실패로 드러남) 호출부는 실패로
 * 처리해 이력에 아무것도 안 남는다 — 실제로는 영상이 라이브인데 다음 실행이
 * 같은 사건을 다시 골라 같은 영상을 또 올릴 수 있다(감사에서 발견). PUT 자체가
 * fetchRetry 를 통과했다면(=서버 응답을 아예 못 받았거나 이해 못한 상태) 최근
 * 업로드 목록에서 방금 만든 제목을 찾아 videoId 를 복구한다 — 실패로 단정하기
 * 전 마지막으로 확인하는 것뿐이라, 이 조회 자체가 실패해도(스코프 부족 등)
 * 조용히 포기하고 원래 오류로 넘어간다.
 */
async function reconcileRecentUpload(accessToken: string, title: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      "https://www.googleapis.com/youtube/v3/search?part=snippet&forMine=true&type=video&order=date&maxResults=5",
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; publishedAt?: string } }>;
    };
    const now = Date.now();
    for (const item of json.items ?? []) {
      const videoId = item.id?.videoId;
      const publishedAt = item.snippet?.publishedAt ? Date.parse(item.snippet.publishedAt) : NaN;
      // 방금 이 실행에서 시도한 업로드인지: 제목 완전 일치 + 10분 이내 게시
      if (videoId && item.snippet?.title === title && !Number.isNaN(publishedAt) && now - publishedAt < 10 * 60_000) {
        return videoId;
      }
    }
  } catch {
    /* 복구 시도 자체의 실패는 무시 — 호출부가 원래 오류로 실패 처리한다 */
  }
  return undefined;
}

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
  /** 나레이션 원문으로 만든 한국어 자막(SRT) */
  srt?: string,
  /** 영어 자막(SRT) */
  srtEn?: string,
): Promise<{ videoId: string }> {
  const accessToken = await getAccessToken();
  const bytes = await fs.readFile(videoPath);

  const snippet = {
    title: buildTitle(idea),
    description: await buildDescription(metadata),
    categoryId: config.youtube.categoryId,
    tags: metadata.hashtags.map((t) => t.replace(/^#/, "")).slice(0, 15),
  };
  const status = {
    privacyStatus: config.youtube.privacyStatus,
    selfDeclaredMadeForKids: false,
  };

  // 1) resumable 업로드 세션 시작
  const initRes = await fetchRetry(
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
    "업로드 세션 생성",
  );
  if (!initRes.ok) {
    throw new Error(`YouTube 업로드 세션 생성 실패: ${await initRes.text()}`);
  }
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube 업로드 URL(Location 헤더)을 못 받았습니다.");

  // 2) 영상 바이트 업로드
  const upRes = await fetchRetry(
    uploadUrl,
    {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.byteLength) },
      body: new Uint8Array(bytes),
    },
    "영상 바이트 업로드",
  );
  let json: { id?: string; error?: unknown } = {};
  let parsed = true;
  try {
    json = (await upRes.json()) as { id?: string; error?: unknown };
  } catch {
    parsed = false;
  }
  if (!parsed || !upRes.ok || !json.id) {
    // 응답을 못 받았거나(파싱 실패) 서버 오류(5xx)면, PUT 자체는 도착해
    // 실제로는 성공했을 가능성이 있다 — 실패로 단정하기 전에 확인한다.
    if (!parsed || upRes.status >= 500) {
      const recovered = await reconcileRecentUpload(accessToken, snippet.title);
      if (recovered) {
        console.warn(`   ⚠️ 업로드 응답을 못 받았지만 최근 업로드 목록에서 videoId 복구: ${recovered}`);
        json = { id: recovered };
      }
    }
    if (!json.id) {
      throw new Error(`YouTube 업로드 실패: ${JSON.stringify(json).slice(0, 400)}`);
    }
  }

  // 3) 커스텀 썸네일 지정 (실패해도 게시 자체는 성공으로 처리)
  if (thumbPath) await setThumbnail(json.id, thumbPath, accessToken);

  // 4) 정확한 한국어·영어 자막 트랙 등록
  if (srt) await uploadCaptionTrack(json.id, srt, accessToken, "한국어");
  if (srtEn) await uploadCaptionTrack(json.id, srtEn, accessToken, "English", "en");

  // 5) 롱폼 유도 댓글 자동 작성 (고정은 Studio 에서 수동 — postPromoComment 참고)
  await postPromoComment(json.id, accessToken);

  return { videoId: json.id };
}

/**
 * 롱폼(가로 16:9) 업로드.
 *
 * 쇼츠와 다른 점: 3분을 넘고 가로라서 Shorts 로 분류되지 않는다(= 시청 시간이
 * YPP 4,000시간에 산입된다). 썸네일도 첫 프레임이 아니라 전용 1280x720 이미지를
 * 올린다.
 */
export async function publishLongform(
  videoPath: string,
  script: LongformScript,
  /** 위키백과 참고자료 (설명란 하단) */
  citation: string | undefined,
  thumbPath?: string,
  /** 나레이션 원문으로 만든 한국어 자막(SRT) */
  srt?: string,
  /** 영어 자막(SRT) — 시청자의 22%가 미국이라 별도 트랙으로 올린다 */
  srtEn?: string,
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

  const initRes = await fetchRetry(
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
    "업로드 세션 생성",
  );
  if (!initRes.ok) throw new Error(`YouTube 롱폼 업로드 세션 생성 실패: ${await initRes.text()}`);
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube 업로드 URL(Location 헤더)을 못 받았습니다.");

  const upRes = await fetchRetry(
    uploadUrl,
    {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.byteLength) },
      body: new Uint8Array(bytes),
    },
    "영상 바이트 업로드",
  );
  let json: { id?: string } = {};
  let parsed = true;
  try {
    json = (await upRes.json()) as { id?: string };
  } catch {
    parsed = false;
  }
  if (!parsed || !upRes.ok || !json.id) {
    if (!parsed || upRes.status >= 500) {
      const recovered = await reconcileRecentUpload(accessToken, snippet.title);
      if (recovered) {
        console.warn(`   ⚠️ 업로드 응답을 못 받았지만 최근 업로드 목록에서 videoId 복구: ${recovered}`);
        json = { id: recovered };
      }
    }
    if (!json.id) {
      throw new Error(`YouTube 롱폼 업로드 실패: ${JSON.stringify(json).slice(0, 400)}`);
    }
  }

  if (thumbPath) await setThumbnail(json.id, thumbPath, accessToken);

  // 롱폼 전체 재생목록에 추가 (쇼츠 설명란이 이 재생목록을 링크한다 —
  // buildDescription 참고). 실패해도 게시 자체는 이미 완료된 상태라 계속한다.
  const playlistId = await ensureLongformPlaylist(accessToken);
  if (playlistId) await addToLongformPlaylist(playlistId, json.id, accessToken);

  // 정확한 한국어 자막 트랙 등록 (ASR 오인식 대체용 — 겹침 문제는 화면 배치로 푼다)
  if (srt) await uploadCaptionTrack(json.id, srt, accessToken, "한국어");
  // 영어 트랙 — 화면에 깔리는 작은 영어 자막과 같은 문장이지만, CC 로 켜면
  // 시청자가 크기·색을 직접 조절할 수 있다. 미국 시청자 22% 를 위한 것.
  if (srtEn) await uploadCaptionTrack(json.id, srtEn, accessToken, "English", "en");

  return { videoId: json.id };
}

/**
 * 한국어 자막 트랙 등록 (captions.insert, multipart, 400 units).
 *
 * 이 트랙은 자동자막(ASR)을 없애지 못한다 — 유튜브는 한 영상에 같은 언어의
 * 트랙을 여러 개 두는 구조라 '대체' 동작 자체가 없고, ASR 생성을 끄는 API 도
 * 없다(실측 확인). 목적은 정확도다: CC 를 켜는 시청자에게 ASR 오인식 대신
 * 나레이션 원문을 그대로 보여준다.
 *
 * captions.insert 는 youtube.force-ssl 스코프 필요 — 없으면 안내만 남기고 계속한다.
 * 자막 실패로 게시 자체를 되돌리지 않는다(영상은 이미 올라가 있다).
 * 같은 (언어, 이름) 쌍이 이미 있으면 409 — 재시도 상황에서 정상이므로 넘어간다.
 */
async function uploadCaptionTrack(
  videoId: string,
  srt: string,
  accessToken: string,
  name: string,
  language: "ko" | "en" = "ko",
): Promise<boolean> {
  const meta = JSON.stringify({
    snippet: { videoId, language, name, isDraft: false },
  });
  const boundary = "mysterycut_caption_boundary";
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${srt}\r\n` +
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
      console.log(`   💬 ${name || language} 자막 트랙 등록 완료 (${srt.split("\n\n").length}개 큐)`);
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

const LONGFORM_PLAYLIST_TITLE = "사건 분석 다큐 (롱폼 전체보기)";

/**
 * 롱폼 전체 재생목록을 확보한다(상태 파일에 있으면 재사용, 없으면 동명
 * 재생목록이 이미 있는지 찾아보고, 그마저 없으면 새로 만든다).
 *
 * playlists.insert/playlistItems.insert 는 youtube/youtubepartner/
 * youtube.force-ssl 세 스코프 중 하나가 필요하다(공식 문서 확인) — 이
 * 파이프라인은 자막 트랙 등록에 이미 youtube.force-ssl 을 쓰므로 스코프가
 * 있으면 대개 같이 딸려 있다. 없으면(스코프 부족 등) 조용히 실패시키고
 * undefined 를 돌려준다 — 썸네일·자막과 같은 원칙으로, 재생목록 실패가
 * 영상 게시 자체를 막으면 안 된다.
 */
async function ensureLongformPlaylist(accessToken: string): Promise<string | undefined> {
  const existing = await loadLongformPlaylistId();
  if (existing) return existing;

  const H = { Authorization: `Bearer ${accessToken}` };
  try {
    // 예전에 수동으로(또는 상태 파일 유실 후 이전 실행이) 만든 동명 재생목록이
    // 있으면 그걸 재사용한다 — 매번 새로 만들면 재생목록이 여러 개로 쪼개진다.
    const listRes = await fetch(
      "https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50",
      { headers: H, signal: AbortSignal.timeout(15_000) },
    );
    if (listRes.ok) {
      const listJson = (await listRes.json()) as {
        items?: Array<{ id: string; snippet?: { title?: string } }>;
      };
      const found = listJson.items?.find((p) => p.snippet?.title === LONGFORM_PLAYLIST_TITLE);
      if (found) {
        await persistLongformPlaylistId(found.id);
        console.log(`   📃 기존 롱폼 재생목록 재사용: ${found.id}`);
        return found.id;
      }
    }

    const createRes = await fetch("https://www.googleapis.com/youtube/v3/playlists?part=snippet,status", {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        snippet: {
          title: LONGFORM_PLAYLIST_TITLE,
          description: "위키백과 등 공개 출처에 근거한 실제 사건 분석 다큐 모음.",
        },
        status: { privacyStatus: config.youtube.privacyStatus },
      }),
    });
    const createJson = (await createRes.json()) as { id?: string; error?: unknown };
    if (!createRes.ok || !createJson.id) {
      console.warn(
        `   ⚠️ 롱폼 재생목록 생성 실패(쇼츠 링크는 최신 영상 1개로 폴백): ${JSON.stringify(createJson).slice(0, 300)}`,
      );
      return undefined;
    }
    await persistLongformPlaylistId(createJson.id);
    console.log(`   📃 롱폼 재생목록 신규 생성: ${createJson.id}`);
    return createJson.id;
  } catch (e) {
    console.warn(`   ⚠️ 롱폼 재생목록 확보 실패: ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

/** 방금 게시한 롱폼을 재생목록 맨 위(position 0)에 추가 — 최신이 항상 먼저 보이게 */
async function addToLongformPlaylist(playlistId: string, videoId: string, accessToken: string): Promise<void> {
  try {
    const res = await fetch("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        snippet: { playlistId, position: 0, resourceId: { kind: "youtube#video", videoId } },
      }),
    });
    if (res.ok) {
      console.log("   📃 재생목록에 추가 완료");
      return;
    }
    console.warn(`   ⚠️ 재생목록 추가 실패(게시는 완료됨): HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  } catch (e) {
    console.warn(`   ⚠️ 재생목록 추가 실패(게시는 완료됨): ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * 방금 올린 쇼츠에 롱폼 유도 댓글을 자동으로 단다.
 *
 * "관련 동영상" 카드·커뮤니티 탭 게시물은 YouTube Data API 어디에도 엔드포인트가
 * 없어(공식 문서·리소스 목록 전체 확인, 2026-08-30) 100% 수동이지만, 댓글
 * "작성"은 commentThreads.insert 로 된다(자막 등록에 이미 쓰는 youtube.force-ssl
 * 스코프로 동작). 다만 "고정"은 API에 없다 — 이 댓글이 올라간 뒤 사람이
 * Studio 에서 한 번 눌러 고정해야 효과가 난다(작성까지는 매번 자동, 고정만 수동).
 *
 * 롱폼(재생목록/최신 영상)이 아직 하나도 없으면 홍보할 대상이 없으므로 조용히
 * 건너뛴다. 실패해도 게시 자체는 이미 끝난 상태라 계속한다.
 */
async function postPromoComment(videoId: string, accessToken: string): Promise<void> {
  const playlistId = await loadLongformPlaylistId();
  let text: string;
  if (playlistId) {
    text = `🎬 이 사건, 더 깊이 파고든 다큐도 있어요\n전체보기: https://www.youtube.com/playlist?list=${playlistId}`;
  } else {
    const longform = await loadLatestLongform();
    if (!longform) return;
    text = `🎬 더 깊이 파고든 사건 분석 다큐: "${longform.title}"\nhttps://youtu.be/${longform.videoId}`;
  }
  try {
    const res = await fetch("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } },
      }),
    });
    if (res.ok) {
      console.log("   💬 롱폼 유도 댓글 작성 완료 (Studio 에서 고정은 수동으로)");
      return;
    }
    console.warn(`   ⚠️ 롱폼 유도 댓글 작성 실패(게시는 완료됨): HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  } catch (e) {
    console.warn(`   ⚠️ 롱폼 유도 댓글 작성 실패(게시는 완료됨): ${e instanceof Error ? e.message : e}`);
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
  const res = await fetchRetry(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    },
    "액세스 토큰 발급",
  );
  // fetchRetry 는 429/5xx 를 재시도하지만, 그 재시도가 다 소진된 뒤(또는 4xx)
  // 응답 바디가 JSON 이 아닐 수 있다(예: 프록시의 502 HTML 페이지) — res.json()
  // 을 바로 부르면 SyntaxError 로 죽어 아래 invalid_grant 진단 로직에 닿지도
  // 못한다. 텍스트로 먼저 받아 파싱을 시도한다.
  const bodyText = await res.text();
  let json: { access_token?: string; error?: string; error_description?: string };
  try {
    json = JSON.parse(bodyText) as typeof json;
  } catch {
    throw new Error(`YouTube 액세스 토큰 발급 실패: HTTP ${res.status} (JSON 아님): ${bodyText.slice(0, 300)}`);
  }
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
async function buildDescription(m: ReelMetadata): Promise<string> {
  const body = m.captionEn?.trim()
    ? `${m.caption}\n\n———\n\n${m.captionEn}`
    : m.caption;
  // 참고자료는 유튜브 설명란에만 붙인다(인스타는 링크가 클릭되지 않아 노이즈만 된다).
  // 시청자 신뢰뿐 아니라, 수익창출 심사에서 '조사에 근거한 콘텐츠'임을 보이는 근거가 된다.
  let out = m.sourcesCitation?.trim() ? `${body}\n\n———\n\n${m.sourcesCitation}` : body;
  // ★쇼츠 시청자를 롱폼(수익창출 시청시간이 산입되는 유일한 포맷)으로 데려오는
  // 유일한 장치. Analytics 실측(2026-08-27): 채널 조회의 96%가 쇼츠 피드
  // 자체에서만 나고, 이 링크가 생기기 전엔 쇼츠에서 롱폼으로 넘어갈 경로가
  // 전혀 없어 롱폼 90일 시청시간이 18분에 그쳤다.
  // 재생목록을 우선한다 — '최신 영상 1개' 링크는 시간이 지나면 낡고 롱폼이
  // 뜸한 주엔 오래된 영상만 계속 가리키지만, 재생목록은 매번 최신 항목이
  // 맨 위로 올라가면서도 과거 전체 카탈로그로의 접근이 유지된다. 재생목록이
  // 아직 없으면(막 붙인 기능이라 첫 롱폼 게시 전이거나 생성이 실패한 경우)
  // 예전 방식인 '최신 영상 1개' 링크로 자연스럽게 대체한다.
  const playlistId = await loadLongformPlaylistId();
  if (playlistId) {
    out += `\n\n———\n\n🎬 사건 분석 다큐(롱폼) 전체보기: https://www.youtube.com/playlist?list=${playlistId}`;
  } else {
    const longform = await loadLatestLongform();
    if (longform) {
      out += `\n\n———\n\n🎬 더 깊이 파고든 사건 분석 다큐: "${longform.title}"\nhttps://youtu.be/${longform.videoId}`;
    }
  }
  return out;
}

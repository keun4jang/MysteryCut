import fs from "node:fs/promises";
import { config } from "../config.js";
import type { ReelMetadata } from "../types.js";

/**
 * Facebook 릴스 업로드 어시스트 (Meta Graph API Reels Publishing, 무료).
 * 인스타와 같은 Meta 생태계 — 페이스북 페이지에 하루 3회 자동 교차게시해서
 * 콘텐츠 수익화 프로그램(조회수 수익) 자격이 열리는 순간부터 수익 대상이 되게 한다.
 *
 * 인증: 페이지 액세스 토큰 (FB_PAGE_ID / FB_PAGE_TOKEN).
 * 흐름: 업로드 세션 시작 → rupload 바이트 업로드 → 게시(finish) → 상태 확인.
 * 릴스 규격 초과(길이 등)로 거부되면 일반 페이지 동영상으로 자동 폴백
 * (일반 동영상도 인스트림 광고 수익 대상).
 */
export async function publishFacebookReel(
  videoPath: string,
  metadata: ReelMetadata,
): Promise<{ videoId: string; asReel: boolean }> {
  const { pageId, pageToken, graphVersion } = config.facebook;
  const bytes = await fs.readFile(videoPath);
  const description = buildDescription(metadata);

  try {
    const videoId = await uploadAsReel(pageId, pageToken, graphVersion, bytes, description);
    return { videoId, asReel: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`   ⚠️ 릴스 업로드 실패(${msg.slice(0, 200)}) — 일반 동영상으로 폴백`);
    const videoId = await uploadAsVideo(pageId, pageToken, graphVersion, bytes, description);
    return { videoId, asReel: false };
  }
}

/** Reels Publishing API: start → rupload → finish → (상태 폴링) */
async function uploadAsReel(
  pageId: string,
  token: string,
  v: string,
  bytes: Buffer,
  description: string,
): Promise<string> {
  // 1) 업로드 세션 시작
  const startRes = await fetch(`https://graph.facebook.com/${v}/${pageId}/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_phase: "start", access_token: token }),
  });
  const start = (await startRes.json()) as { video_id?: string; upload_url?: string };
  if (!startRes.ok || !start.video_id || !start.upload_url) {
    throw new Error(`세션 시작 실패: ${JSON.stringify(start).slice(0, 300)}`);
  }

  // 2) 바이트 업로드 (rupload)
  const upRes = await fetch(start.upload_url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      offset: "0",
      file_size: String(bytes.byteLength),
      "Content-Type": "application/octet-stream",
    },
    body: new Uint8Array(bytes),
  });
  const up = (await upRes.json()) as { success?: boolean };
  if (!upRes.ok || !up.success) {
    throw new Error(`바이트 업로드 실패: ${JSON.stringify(up).slice(0, 300)}`);
  }

  // 3) 게시
  const finParams = new URLSearchParams({
    access_token: token,
    video_id: start.video_id,
    upload_phase: "finish",
    video_state: "PUBLISHED",
    description,
  });
  const finRes = await fetch(
    `https://graph.facebook.com/${v}/${pageId}/video_reels?${finParams}`,
    { method: "POST" },
  );
  const fin = (await finRes.json()) as { success?: boolean };
  if (!finRes.ok || !fin.success) {
    throw new Error(`게시 실패: ${JSON.stringify(fin).slice(0, 300)}`);
  }

  // 4) 처리 완료 대기 (최대 3분) — 실패 상태면 에러로 폴백 유도
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const stRes = await fetch(
      `https://graph.facebook.com/${v}/${start.video_id}?fields=status&access_token=${token}`,
    );
    const st = (await stRes.json()) as {
      status?: { video_status?: string; processing_phase?: { status?: string } };
    };
    const s = st.status?.video_status;
    if (s === "ready") return start.video_id;
    if (s === "error") throw new Error("영상 처리 중 오류 (릴스 규격 미충족 가능)");
  }
  // 시간 초과여도 게시 요청 자체는 접수됨 — 성공으로 간주
  console.warn("   ⚠️ 릴스 처리 상태 확인 시간 초과 — 게시는 접수됨");
  return start.video_id;
}

/** 폴백: 일반 페이지 동영상 업로드 (graph-video, multipart) */
async function uploadAsVideo(
  pageId: string,
  token: string,
  v: string,
  bytes: Buffer,
  description: string,
): Promise<string> {
  const form = new FormData();
  form.append("access_token", token);
  form.append("description", description);
  form.append("source", new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), "reel.mp4");
  const res = await fetch(`https://graph-video.facebook.com/${v}/${pageId}/videos`, {
    method: "POST",
    body: form,
  });
  const json = (await res.json()) as { id?: string };
  if (!res.ok || !json.id) {
    throw new Error(`페이스북 동영상 업로드 실패: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json.id;
}

/** 설명 = 한글 캡션(위) + 영어 번역(아래). 해시태그 없음 — 인스타/유튜브와 동일 정책 */
function buildDescription(m: ReelMetadata): string {
  return m.captionEn?.trim() ? `${m.caption}\n\n———\n\n${m.captionEn}` : m.caption;
}

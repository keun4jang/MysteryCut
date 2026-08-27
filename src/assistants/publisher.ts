import fs from "node:fs/promises";
import { config } from "../config.js";
import { loadGraphVersion, nextGraphVersion, persistGraphVersion } from "../lib/igGraphVersion.js";
import type { ReelMetadata } from "../types.js";

// 컨테이너 생성/게시는 모드에 따라 graph.instagram.com 또는 graph.facebook.com
const BASE = config.instagram.apiBase;
// 메타가 config.instagram.graphVersion(v21.0 등)을 지원 종료해도 자동으로 다음
// 버전을 찾아 재시도한다(아래 graphFetch). 5년 방치를 버티기 위한 장치 —
// 자세한 설계 이유는 lib/igGraphVersion.ts 참고.
const MAX_VERSION_BUMPS = 20;
let versionPromise: Promise<string> | null = null;
function currentVersion(): Promise<string> {
  versionPromise ??= loadGraphVersion(config.instagram.graphVersion);
  return versionPromise;
}

/** 메타의 "버전 지원 종료" 오류 메시지를 휴리스틱으로 감지 */
function isVersionDeprecatedError(json: unknown): boolean {
  const msg = String(
    (json as { error?: { message?: string } })?.error?.message ?? "",
  ).toLowerCase();
  if (!msg.includes("version")) return false;
  return /(no longer supported|not supported|deprecated|unsupported)/.test(msg);
}

/**
 * Graph API 호출 + 버전 만료 자동 대응. urlFor(version) 은 그 버전을 넣은 전체 URL.
 * 지원 종료 오류가 감지되면 버전을 올려 재시도하고, 성공한 버전은 파일에 기록해
 * 다음 실행부터 바로 그 버전으로 시작하게 한다.
 */
async function graphFetch(
  urlFor: (version: string) => string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  let version = await currentVersion();
  const startedAt = version;
  for (let attempt = 0; attempt <= MAX_VERSION_BUMPS; attempt++) {
    // 타임아웃 없으면 undici 기본 300초에 의존한다 — waitUntilFinished 는 이
    // 호출을 최대 45회 반복하므로, 한 번이라도 느리게 매달리면 3분 폴링
    // 예산이 통째로 그 한 번에 잡아먹힌다.
    const res = await fetch(urlFor(version), { ...init, signal: AbortSignal.timeout(30_000) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) {
      if (version !== startedAt) {
        console.warn(
          `  ✅ 인스타 Graph API ${version} 로 갱신 확인 — 다음 실행부터 이 버전으로 시작합니다.`,
        );
        await persistGraphVersion(version).catch(() => {});
      }
      return json;
    }
    if (isVersionDeprecatedError(json) && attempt < MAX_VERSION_BUMPS) {
      const next = nextGraphVersion(version);
      console.warn(`  ⚠️ 인스타 Graph API ${version} 지원 종료 감지 → ${next} 로 재시도`);
      version = next;
      continue;
    }
    throw new Error(`인스타 API 요청 실패(${version}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  throw new Error("인스타 Graph API 버전 자동 탐색이 모두 실패했습니다.");
}

/**
 * 업로드 어시스트 — 렌더된 mp4 를 Instagram 릴스로 게시.
 *
 * Instagram API(Instagram Login)는 바이트 직접 업로드 대신 "공개 URL(video_url)"을
 * 요구한다. 그래서 렌더 결과물을 GitHub 릴리스에 임시로 올려 공개 URL 을 만들고,
 * 그 URL 로 컨테이너를 생성 → 처리 완료 대기 → 게시한 뒤, 임시 릴리스를 삭제한다.
 *
 * 흐름: 임시 공개 호스팅 → 컨테이너 생성(video_url) → 처리 완료 폴링 → 게시 → 정리.
 */
export async function publishReel(
  videoPath: string,
  metadata: ReelMetadata,
): Promise<{ mediaId: string }> {
  const caption = buildCaption(metadata);

  // 1) 영상을 공개 URL 로 임시 호스팅 (인스타가 이 URL 에서 영상을 내려받아 처리)
  const { videoUrl, cleanup } = await hostVideoPublicly(videoPath);
  try {
    // 2) video_url 로 미디어 컨테이너 생성
    const containerId = await createContainer(caption, videoUrl);
    // 3) 인스타가 영상을 내려받아 처리 완료할 때까지 대기
    await waitUntilFinished(containerId);
    // 4) 게시
    const mediaId = await publish(containerId);
    return { mediaId };
  } finally {
    // 5) 임시 호스팅 정리 (게시 완료 후엔 URL 불필요)
    await cleanup().catch(() => {});
  }
}

function buildCaption(m: ReelMetadata): string {
  // 한글(위) + 영어 번역(아래) — 글로벌 시청자 대응. 해시태그 없음(키워드는 본문에).
  return m.captionEn?.trim()
    ? `${m.caption}\n\n———\n\n${m.captionEn}`
    : m.caption;
}

/**
 * 렌더 mp4 를 GitHub 릴리스 에셋으로 임시 업로드해 공개 URL 을 만든다.
 * (GitHub Actions 가 자동 제공하는 GITHUB_TOKEN / GITHUB_REPOSITORY 사용)
 * 반환한 cleanup() 은 그 임시 릴리스와 태그를 지운다.
 */
async function hostVideoPublicly(
  videoPath: string,
): Promise<{ videoUrl: string; cleanup: () => Promise<void> }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_REPOSITORY?.trim(); // "owner/name"
  if (!token || !repo) {
    throw new Error(
      "인스타 업로드용 공개 호스팅 실패: GITHUB_TOKEN/GITHUB_REPOSITORY 가 없습니다. (워크플로에서 GITHUB_TOKEN 전달 + permissions: contents: write 필요)",
    );
  }
  const [owner, name] = repo.split("/");
  const api = "https://api.github.com";
  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // 고유 태그 (동시 실행 충돌 방지). 파이프라인 런타임이라 Date 사용 가능.
  const tag = `media-${Date.now()}`;

  // 1) 임시 릴리스 생성
  const relRes = await fetch(`${api}/repos/${owner}/${name}/releases`, {
    method: "POST",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      body: "임시 미디어 호스팅 (자동 생성/삭제)",
      prerelease: true,
    }),
  });
  const rel = (await relRes.json()) as { id?: number; error?: unknown };
  if (!relRes.ok || !rel.id) {
    throw new Error(`임시 릴리스 생성 실패: ${JSON.stringify(rel).slice(0, 300)}`);
  }
  const releaseId = rel.id;

  // 2) mp4 를 릴리스 에셋으로 업로드
  const bytes = await fs.readFile(videoPath);
  const upRes = await fetch(
    `https://uploads.github.com/repos/${owner}/${name}/releases/${releaseId}/assets?name=reel.mp4`,
    {
      method: "POST",
      headers: { ...ghHeaders, "Content-Type": "video/mp4" },
      body: new Uint8Array(bytes),
    },
  );
  const asset = (await upRes.json()) as { browser_download_url?: string; error?: unknown };
  if (!upRes.ok || !asset.browser_download_url) {
    await deleteRelease(api, owner, name, releaseId, tag, ghHeaders);
    throw new Error(`릴리스 에셋 업로드 실패: ${JSON.stringify(asset).slice(0, 300)}`);
  }

  const cleanup = () => deleteRelease(api, owner, name, releaseId, tag, ghHeaders);
  return { videoUrl: asset.browser_download_url, cleanup };
}

/**
 * 임시 호스팅 릴리스·태그 삭제. 호출부는 실패해도 무시하고 넘어가지만(정리
 * 실패로 게시 자체를 되돌릴 이유는 없다), 실패가 흔적도 없이 사라지면 영상
 * mp4 가 공개 릴리스로 저장소에 영구히 남아도 아무도 모른다(감사에서 발견) —
 * 최소한 로그는 남겨 나중에 사람이 media-* 릴리스 목록을 보고 원인을 찾을
 * 수 있게 한다.
 */
async function deleteRelease(
  api: string,
  owner: string,
  name: string,
  releaseId: number,
  tag: string,
  headers: Record<string, string>,
): Promise<void> {
  const relRes = await fetch(`${api}/repos/${owner}/${name}/releases/${releaseId}`, {
    method: "DELETE",
    headers,
  });
  if (!relRes.ok && relRes.status !== 404) {
    console.warn(`  ⚠️ 임시 릴리스 삭제 실패(${tag}, HTTP ${relRes.status}) — 수동 정리 필요할 수 있음`);
  }
  const tagRes = await fetch(`${api}/repos/${owner}/${name}/git/refs/tags/${tag}`, {
    method: "DELETE",
    headers,
  });
  if (!tagRes.ok && tagRes.status !== 404) {
    console.warn(`  ⚠️ 임시 태그 삭제 실패(${tag}, HTTP ${tagRes.status}) — 수동 정리 필요할 수 있음`);
  }
}

async function createContainer(caption: string, videoUrl: string): Promise<string> {
  const params = new URLSearchParams({
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    access_token: config.instagram.accessToken,
  });
  const json = await graphFetch((v) => `${BASE}/${v}/${config.instagram.userId}/media`, {
    method: "POST",
    body: params,
  });
  const id = json.id as string | undefined;
  if (!id) throw new Error(`컨테이너 생성 실패: ${JSON.stringify(json)}`);
  return id;
}

/**
 * 인스타가 영상을 처리 완료(FINISHED)할 때까지 최대 45회(4초 간격, 3분) 폴링.
 *
 * ★폴링 도중 graphFetch 가 일시 오류(네트워크 블립, graph.instagram.com 의
 * 순간 5xx)를 한 번만 던져도 예전엔 그 자리에서 전체 게시가 실패했다 — 3분
 * 안에 40회 넘는 호출 중 단 1회의 흔들림도 허용하지 않은 셈이다. 실제로는
 * 컨테이너가 그 뒤 정상적으로 FINISHED 됐을 수 있는데 폴링을 포기해버린다
 * (감사에서 발견). 연속 실패가 일정 횟수를 넘을 때만 진짜 장애로 본다.
 */
async function waitUntilFinished(containerId: string): Promise<void> {
  const MAX_CONSECUTIVE_FAILURES = 5; // 20초 연속 불통이면 진짜 장애로 본다
  let consecutiveFailures = 0;
  for (let attempt = 0; attempt < 45; attempt++) {
    await sleep(4000);
    let json: Record<string, unknown>;
    try {
      json = await graphFetch(
        (v) => `${BASE}/${v}/${containerId}?fields=status_code,status&access_token=${config.instagram.accessToken}`,
      );
      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw e;
      console.warn(
        `  ⚠️ 처리 상태 조회 실패(${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}, 계속 폴링): ${e instanceof Error ? e.message : e}`,
      );
      continue;
    }
    if (json.status_code === "FINISHED") return;
    if (json.status_code === "ERROR") {
      throw new Error(`영상 처리 실패: ${JSON.stringify(json)}`);
    }
    console.log(`  ⏳ 처리 중... (${json.status_code ?? "IN_PROGRESS"})`);
  }
  throw new Error("영상 처리 시간 초과");
}

async function publish(containerId: string): Promise<string> {
  const params = new URLSearchParams({
    creation_id: containerId,
    access_token: config.instagram.accessToken,
  });
  const json = await graphFetch((v) => `${BASE}/${v}/${config.instagram.userId}/media_publish`, {
    method: "POST",
    body: params,
  });
  const id = json.id as string | undefined;
  if (!id) throw new Error(`게시 실패: ${JSON.stringify(json)}`);
  return id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

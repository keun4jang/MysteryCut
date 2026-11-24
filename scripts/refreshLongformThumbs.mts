/**
 * 클릭률이 낮은 롱폼 4편의 썸네일 교체(대상은 thumbRefreshPlan.mts 에 고정).
 *
 *   npx tsx scripts/refreshLongformThumbs.mts [--only=<videoId>]           # 미리보기: 이미지만 만든다. 유튜브 호출 없음
 *   npx tsx scripts/refreshLongformThumbs.mts --apply [--only=<videoId>]   # 미리보기 이미지를 그대로 적용
 *
 * - 적용은 다시 렌더하지 않는다. Pexels 결과가 바뀌어도 눈으로 확인한 그 파일이 올라가게 한다.
 * - 교체 전 현재 썸네일 URL 을 로그에 남기고 이미지도 backup/ 에 받아 둔다(교체 후 같은 URL 이 새 이미지를 보여줄 수 있다).
 * - 2026년 이전 옛 영상·게시일 불명 영상이 하나라도 있으면 아무것도 바꾸지 않는다.
 * - 제목·설명은 건드리지 않는다. 쿼터: videos.list 1 + 편당 thumbnails.set 50.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";
import { fetchThumbBg } from "../src/assistants/broll.js";
import { getYoutubeAccessToken } from "../src/assistants/youtubePublisher.js";
import { deriveGrade } from "../src/lib/grade.js";
import { renderLongformThumb } from "../src/render.js";
import type { LongformInputProps } from "../src/types.js";
import { isLegacyVideo } from "./legacyGuard.mjs";
import { planIssues, THUMB_REFRESH_PLAN, type ThumbRefreshItem } from "./thumbRefreshPlan.mjs";

const OUT_NAME = "thumb-refresh";
const OUT_DIR = path.join(config.paths.out, OUT_NAME);
const MANIFEST = path.join(OUT_DIR, "manifest.json");
const MAX_BYTES = 2 * 1024 * 1024; // 유튜브 썸네일 상한

type ManifestEntry = { videoId: string; thumbTitle: string; sha256: string; bytes: number };
type Thumbs = { default?: { url: string }; medium?: { url: string }; high?: { url: string }; standard?: { url: string }; maxres?: { url: string } };

const apply = process.argv.includes("--apply");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).trim();
if (only && !THUMB_REFRESH_PLAN.some((p) => p.videoId === only)) {
  throw new Error(`${only} 는 교체 대상 4편이 아닙니다.`);
}
const targets = THUMB_REFRESH_PLAN.filter((p) => !only || p.videoId === only);

for (const item of targets) {
  const issues = planIssues(item);
  if (issues.length) throw new Error(`${item.videoId} 문구 규칙 위반: ${issues.join(" / ")}`);
}

const sha256 = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");
const imagePath = (id: string) => path.join(OUT_DIR, `${id}.jpg`);

async function preview() {
  if (!config.pexels.apiKey) throw new Error("PEXELS_API_KEY 가 없습니다.");
  await fs.mkdir(OUT_DIR, { recursive: true });
  // 렌더 번들이 public/ 을 복사하므로 사진을 전부 받은 뒤에 렌더한다
  const backgrounds = new Map<string, string>();
  for (const item of targets) {
    const got = await fetchThumbBg(item.thumbQuery);
    if (!got) throw new Error(`${item.videoId} 배경 사진을 찾지 못했습니다("${item.thumbQuery}").`);
    const name = `broll/lf-refresh-${item.videoId}.jpg`;
    await fs.rename(path.join(config.paths.public, got), path.join(config.paths.public, name));
    backgrounds.set(item.videoId, name);
  }
  const manifest: ManifestEntry[] = [];
  for (const item of targets) {
    const bg = backgrounds.get(item.videoId)!;
    const props: LongformInputProps = {
      title: "",
      thumbTitle: item.thumbTitle,
      thumbBadge: item.thumbBadge,
      centralQuestion: "",
      thumbQuery: item.thumbQuery,
      thumbBgSrc: bg,
      chapters: [{ heading: "", visualQuery: "", bgSrc: bg, segments: [] }],
      grade: deriveGrade(item.caseKey, item.thumbBadge),
    };
    const file = await renderLongformThumb(props, path.join(OUT_NAME, `${item.videoId}.jpg`));
    const img = await fs.readFile(file);
    if (img.byteLength > MAX_BYTES) throw new Error(`${item.videoId} 이미지가 2MB 를 넘습니다.`);
    manifest.push({ videoId: item.videoId, thumbTitle: item.thumbTitle, sha256: sha256(img), bytes: img.byteLength });
    console.log(`🖼️ ${item.videoId} "${item.thumbTitle.replace("\n", " / ")}" (${Math.round(img.byteLength / 1024)}KB)`);
  }
  await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log("미리보기 완료. 유튜브는 바꾸지 않았습니다.");
}

/** 미리보기 파일이 지금 계획과 같고 손상되지 않았는지 — 하나라도 어긋나면 업로드 전에 멈춘다 */
async function loadApproved(item: ThumbRefreshItem, manifest: ManifestEntry[]): Promise<Uint8Array> {
  const entry = manifest.find((m) => m.videoId === item.videoId);
  if (!entry) throw new Error(`${item.videoId} 미리보기 기록이 없습니다.`);
  if (entry.thumbTitle !== item.thumbTitle) throw new Error(`${item.videoId} 미리보기 뒤에 문구가 바뀌었습니다. 미리보기를 다시 만드세요.`);
  const img = new Uint8Array(await fs.readFile(imagePath(item.videoId)));
  if (sha256(img) !== entry.sha256) throw new Error(`${item.videoId} 이미지가 미리보기와 다릅니다.`);
  if (img.byteLength > MAX_BYTES) throw new Error(`${item.videoId} 이미지가 2MB 를 넘습니다.`);
  return img;
}

async function applyAll() {
  const manifest = JSON.parse(await fs.readFile(MANIFEST, "utf8")) as ManifestEntry[];
  const images = new Map<string, Uint8Array>();
  for (const item of targets) images.set(item.videoId, await loadApproved(item, manifest));

  const token = await getYoutubeAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${targets.map((t) => t.videoId).join(",")}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`영상 조회 실패: HTTP ${res.status}`);
  const info = (await res.json()) as { items?: Array<{ id: string; snippet: { publishedAt?: string; thumbnails?: Thumbs } }> };

  // 전부 확인하고 백업까지 끝난 뒤에만 교체를 시작한다
  const backupDir = path.join(OUT_DIR, "backup");
  await fs.mkdir(backupDir, { recursive: true });
  for (const item of targets) {
    const video = info.items?.find((v) => v.id === item.videoId);
    if (!video || isLegacyVideo(video.snippet.publishedAt)) {
      throw new Error(`🛡️ ${item.videoId} 는 옛 영상이거나 게시일을 확인할 수 없어 전체 작업을 중단합니다.`);
    }
    const t = video.snippet.thumbnails;
    const url = t?.maxres?.url ?? t?.standard?.url ?? t?.high?.url ?? t?.medium?.url ?? t?.default?.url;
    if (!url) throw new Error(`${item.videoId} 현재 썸네일 URL 이 없습니다.`);
    console.log(`↩️ ${item.videoId} 현재 썸네일: ${url} (저장소 원본: ${item.originalThumb})`);
    const old = await fetch(url);
    if (!old.ok) throw new Error(`${item.videoId} 현재 썸네일 백업 실패: HTTP ${old.status}`);
    await fs.writeFile(path.join(backupDir, `${item.videoId}-before.jpg`), Buffer.from(await old.arrayBuffer()));
  }

  for (const item of targets) {
    const img = images.get(item.videoId)!;
    const set = await fetch(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${item.videoId}&uploadType=media`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg", "Content-Length": String(img.byteLength) },
        body: img,
      },
    );
    if (!set.ok) throw new Error(`${item.videoId} 교체 실패(이 영상부터 중단): HTTP ${set.status} ${(await set.text()).slice(0, 300)}`);
    console.log(`✅ ${item.videoId} 교체 완료 "${item.thumbTitle.replace("\n", " / ")}"`);
  }
}

await (apply ? applyAll() : preview());

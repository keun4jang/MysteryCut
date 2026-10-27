import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { config } from "../config.js";
import { generateStructured, type InlineImage } from "../lib/llm.js";

const execFileAsync = promisify(execFile);

/**
 * 아트디렉터 — 렌더된 영상의 썸네일과 장면 몇 컷을 AI 가 직접 보고 디자인 결함을 짚는다(10/27 사장님 요청
 * "아트디렉터 만들어서 항상 디자인 감시하고 수정해줘").
 *
 * 매 실행(드라이런 포함) 로그에 `🎨 아트디렉터` 줄로 남기고, 주간 아트디렉터 점검(Claude 예약 작업)이 그 로그와
 * thumbnails/ 보관본을 모아 디자인 코드(src/remotion/*)를 고친다. 게시를 막지는 않는다 — AI 시각 판정은
 * 오탐이 있어 영상 하나를 통째로 버리는 근거로 쓰기엔 이르다. 검사 실패(한도 초과 등)도 조용히 넘어간다.
 */
const ReviewSchema = z.object({
  overall: z.number().int().min(1).max(10),
  issues: z.array(
    z.object({
      image: z.string(),
      severity: z.enum(["critical", "major", "minor"]),
      category: z.string(),
      problem: z.string(),
      fix: z.string(),
    }),
  ),
});
export type DesignReview = z.infer<typeof ReviewSchema>;

const CHECKLIST = [
  "너는 한국어 미스터리·실화 채널 '미스터리 컷'의 아트디렉터다. 첨부 이미지(썸네일과 영상 장면)를 보고 디자인 결함만 짚어라.",
  "채널 기준: 어두운 시네마틱 톤, Pretendard 계열 굵은 고딕, 흰 글자+그림자, 빨간 배지, 쇼츠는 세로 1080x1920(위 230px·아래 330px 는 플랫폼 UI 가 덮는 구역), 롱폼 썸네일은 1280x720 이며 360px 폭에서도 읽혀야 한다.",
  "확인할 것:",
  "1) 글자가 화면 밖으로 잘리거나, 줄바꿈이 어색하게 끊기거나(한 글자·조사만 다음 줄로), 다른 요소와 겹치는 것",
  "2) 배경과 대비가 낮아 읽기 어려운 글자, 너무 작은 글자(쇼츠 자막 40px 미만 체감, 썸네일 문구가 360px 폭에서 안 읽힘)",
  "3) 폰트가 섞인 것(고딕 사이에 명조·세리프·시스템 기본체가 끼어 있음), 깨진 글자(□·?·외계어)",
  "4) 플랫폼 UI 가림 구역(쇼츠 상단·하단)에 걸친 핵심 글자",
  "5) 배경 사진 문제: 주제와 무관해 보임, 다른 회사 로고·워터마크·외국어 글자가 크게 보임, 선정적·잔혹한 이미지, 실존 인물로 오해될 얼굴 클로즈업, 저화질·늘어남",
  "6) 같은 장면 반복, 지나치게 어둡거나 하얗게 날아간 화면",
  "severity: critical=시청자가 바로 알아챌 오류(잘린 글자·깨진 글자·부적절 이미지), major=품질을 눈에 띄게 떨어뜨림, minor=다듬으면 좋음.",
  "image 에는 첨부 순서 이름(예: 'thumb', 'frame-50%')을 쓰고, fix 에는 디자인 코드에서 바꿀 방향을 구체적으로 써라(예: '썸네일 문구 3줄 이상이면 글자 크기를 단계적으로 줄이기').",
  "문제가 없으면 issues 는 빈 배열. 취향 차이는 넣지 마라. overall 은 1~10 점.",
].join("\n");

async function frameAt(videoPath: string, seconds: number, outPath: string): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-ss", seconds.toFixed(2), "-i", videoPath, "-frames:v", "1",
      "-vf", "scale='min(720,iw)':-2", "-q:v", "4", outPath,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function durationOf(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", videoPath,
  ]);
  return Number(stdout.trim()) || 0;
}

async function toImage(file: string): Promise<InlineImage> {
  return { mimeType: "image/jpeg", data: (await fs.readFile(file)).toString("base64") };
}

/**
 * 썸네일·장면을 검수해 로그에 남긴다. 결과는 돌려주지만 호출부는 게시 여부 판단에 쓰지 않는다.
 * @param kind 쇼츠는 5컷, 롱폼은 8컷(길어서 장면 종류가 많다)
 */
export async function reviewDesign(opts: {
  kind: "shorts" | "longform";
  videoPath: string;
  thumbPath?: string;
  title: string;
}): Promise<DesignReview | null> {
  try {
    const dir = path.join(config.paths.out, "art-review");
    await fs.mkdir(dir, { recursive: true });
    const dur = await durationOf(opts.videoPath);
    const marks = opts.kind === "shorts" ? [0.04, 0.25, 0.5, 0.75, 0.95] : [0.01, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.97];
    const names: string[] = [];
    const images: InlineImage[] = [];
    if (opts.thumbPath) {
      names.push("thumb");
      images.push(await toImage(opts.thumbPath));
    }
    for (const m of marks) {
      const out = path.join(dir, `frame-${Math.round(m * 100)}.jpg`);
      if (dur > 0 && (await frameAt(opts.videoPath, dur * m, out))) {
        names.push(`frame-${Math.round(m * 100)}%`);
        images.push(await toImage(out));
      }
    }
    if (!images.length) return null;
    const review = await generateStructured({
      schema: ReviewSchema,
      system: CHECKLIST,
      user:
        `[${opts.kind === "shorts" ? "쇼츠(세로)" : "롱폼(가로) 몰아보기"}] 제목: ${opts.title}\n` +
        `첨부 순서: ${names.join(", ")}\n{overall, issues:[{image, severity, category, problem, fix}]} 로 답하라.`,
      images,
      temperature: 0,
      maxRetries: 1,
    });
    const icon = { critical: "🟥", major: "🟧", minor: "🟨" } as const;
    console.log(`   🎨 아트디렉터: ${review.overall}/10점, 지적 ${review.issues.length}건`);
    for (const i of review.issues) {
      console.log(`   🎨 ${icon[i.severity]} [${i.image}] ${i.category}: ${i.problem} → 수정 방향: ${i.fix}`);
    }
    return review;
  } catch (e) {
    console.warn(`   ⚠️ 아트디렉터 검수 생략: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    return null;
  }
}

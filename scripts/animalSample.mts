/**
 * 동물 캐릭터 그림체 샘플(11/12, 사장님 "일단 무료로 샘플보여줘") — 게시와 무관한 시험용.
 * 하일브론의 유령(11/11 롱폼) 장면 5컷을 어두운 누아르풍 동물 캐릭터로 그린다. 폭력 묘사 없음.
 *
 * 무료만 쓴다: ① Gemini 무료 등급 이미지 모델(키에 결제가 연결돼 있지 않아 과금 없음)
 *             ② 실패하면 키 없는 무료 서비스(image.pollinations.ai)
 * 결과: samples/animal/*.jpg + samples/animal/README.md(어느 쪽으로 만들었는지)
 */
import fs from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";

const STYLE =
  "dark noir graphic novel illustration, anthropomorphic animals wearing 1990s-2000s European clothing, " +
  "muted desaturated colors with a single warm accent light, cinematic composition, serious adult documentary tone, " +
  "painterly texture, no gore, no blood, no weapons, no text, no letters, no watermark";

const SCENES = [
  { file: "01-evidence-board", w: 1280, h: 720, prompt: "a fox detective in a trench coat standing in front of a cork evidence board covered with photos and red string, late night German police office, desk lamp" },
  { file: "02-dna-lab", w: 1280, h: 720, prompt: "an owl forensic scientist in a white lab coat holding up a DNA test strip under a lamp in a dim laboratory, test tubes on the table" },
  { file: "03-europe-map", w: 1280, h: 720, prompt: "three wolf police investigators seen from behind studying a large map of Europe with many red pins, dark briefing room" },
  { file: "04-swab-factory", w: 1280, h: 720, prompt: "a quiet factory packaging line of sterile cotton swabs, a rabbit worker in a hairnet seen from behind as a silhouette, cold fluorescent light" },
  { file: "05-shorts-cover", w: 720, h: 1280, prompt: "vertical poster, a fox detective holding a single cotton swab up to the light, dramatic close-up, deep shadows" },
];

await fs.mkdir("samples/animal", { recursive: true });
const log: string[] = [];

async function viaGemini(prompt: string): Promise<Buffer | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const ai = new GoogleGenAI({ apiKey: key });
  for (const model of ["gemini-2.5-flash-image", "gemini-2.5-flash-image-preview", "gemini-2.0-flash-preview-image-generation"]) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseModalities: ["IMAGE", "TEXT"] },
      });
      for (const part of res.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          log.push(`Gemini(${model})`);
          return Buffer.from(part.inlineData.data, "base64");
        }
      }
      console.log(`   Gemini ${model}: 이미지 없음`);
    } catch (e) {
      console.log(`   Gemini ${model} 실패: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`);
    }
  }
  return null;
}

async function viaPollinations(prompt: string, w: number, h: number, seed: number): Promise<Buffer | null> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&seed=${seed}&model=flux`;
  for (let t = 0; t < 3; t++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      const type = res.headers.get("content-type") ?? "";
      if (res.ok && type.startsWith("image/")) {
        log.push("Pollinations(flux)");
        return Buffer.from(await res.arrayBuffer());
      }
      console.log(`   Pollinations HTTP ${res.status} ${type}`);
    } catch (e) {
      console.log(`   Pollinations 실패: ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((r) => setTimeout(r, 5000 * (t + 1)));
  }
  return null;
}

const made: string[] = [];
for (const [i, s] of SCENES.entries()) {
  const prompt = `${s.prompt}. ${STYLE}. ${s.w > s.h ? "16:9 wide frame" : "9:16 vertical frame"}`;
  console.log(`🎨 ${s.file}`);
  const img = (await viaGemini(prompt)) ?? (await viaPollinations(prompt, s.w, s.h, 4100 + i));
  if (!img) {
    console.log("   ❌ 두 방법 모두 실패");
    continue;
  }
  const ext = img[0] === 0x89 ? "png" : "jpg";
  await fs.writeFile(`samples/animal/${s.file}.${ext}`, img);
  made.push(`${s.file}.${ext} — ${log[log.length - 1]}`);
  console.log(`   ✅ ${s.file}.${ext} (${log[log.length - 1]}, ${(img.length / 1024).toFixed(0)}KB)`);
}
await fs.writeFile(
  "samples/animal/README.md",
  `# 동물 캐릭터 그림체 샘플 (하일브론의 유령)\n\n${made.map((m) => `- ${m}`).join("\n")}\n\n스타일: ${STYLE}\n`,
);
console.log(`\n완료 ${made.length}/${SCENES.length}`);
if (!made.length) process.exit(1);

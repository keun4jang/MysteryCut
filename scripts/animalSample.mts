/**
 * 동물 캐릭터 그림체 샘플(11/12, 사장님 "일단 무료로 샘플보여줘") — 게시와 무관한 시험용.
 * 하일브론의 유령(11/11 롱폼) 장면 5컷을 어두운 누아르풍 동물 캐릭터로 그린다. 폭력 묘사 없음.
 *
 * 무료만 쓴다: ① AI Horde(자원봉사 GPU, 익명 키, SDXL) ② Gemini 무료 등급(11/12 기준 이미지 한도 0)
 *             ③ 키 없는 Pollinations(익명은 1장 뒤 402 — 간격을 크게 둔다)
 * 결과: samples/animal/*.jpg + samples/animal/README.md(어느 쪽으로 만들었는지)
 */
import fs from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";

const STYLE =
  "(anthropomorphic animal character with an animal head and fur:1.5), furry, dark noir graphic novel illustration, animals wearing 1990s-2000s European clothing, " +
  "muted desaturated colors with a single warm accent light, cinematic composition, serious adult documentary tone, " +
  "painterly texture, no gore, no blood, no weapons, no text, no letters, no watermark";

const SCENES = [
  { file: "01-evidence-board", w: 1280, h: 720, prompt: "(fox head:1.4), a fox-headed detective in a trench coat standing in front of a cork evidence board covered with photos and red string, late night German police office, desk lamp" },
  { file: "02-dna-lab", w: 1280, h: 720, prompt: "(owl head:1.4), an owl-headed forensic scientist in a white lab coat holding up a DNA test strip under a lamp in a dim laboratory, test tubes on the table" },
  { file: "03-europe-map", w: 1280, h: 720, prompt: "(wolf heads:1.4), three wolf-headed police investigators seen from behind studying a large map of Europe with many red pins, dark briefing room" },
  { file: "04-swab-factory", w: 1280, h: 720, prompt: "a quiet factory packaging line of sterile cotton swabs, a rabbit-headed worker with long ears in a hairnet seen from behind as a silhouette, cold fluorescent light" },
  { file: "05-shorts-cover", w: 720, h: 1280, prompt: "(fox head:1.4), vertical poster, a fox-headed detective holding a single cotton swab up to the light, dramatic close-up, deep shadows" },
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

async function viaHorde(prompt: string, w: number, h: number): Promise<Buffer | null> {
  const H = { apikey: "0000000000", "Content-Type": "application/json", "Client-Agent": "mystery-cut-sample:1.0:anon" };
  try {
    const start = await fetch("https://aihorde.net/api/v2/generate/async", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        prompt: `${prompt} ### human face, human head, human skin, photo, gore, blood, text, watermark, extra ears, deformed`,
        params: { width: w, height: h, steps: 28, cfg_scale: 6, sampler_name: "k_dpmpp_2m", n: 1, karras: true },
        models: ["AlbedoBase XL (SDXL)", "Juggernaut XL"],
        nsfw: false,
        censor_nsfw: true,
        r2: true,
      }),
    });
    const sj = (await start.json()) as { id?: string; message?: string };
    if (!sj.id) {
      console.log(`   Horde 요청 실패: ${start.status} ${sj.message ?? ""}`);
      return null;
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 40 * 60_000) {
      await new Promise((r) => setTimeout(r, 10_000));
      const c = (await (await fetch(`https://aihorde.net/api/v2/generate/check/${sj.id}`, { headers: H })).json()) as {
        done?: boolean;
        faulted?: boolean;
        queue_position?: number;
        wait_time?: number;
      };
      if (c.faulted) break;
      if (!c.done) continue;
      const st = (await (await fetch(`https://aihorde.net/api/v2/generate/status/${sj.id}`, { headers: H })).json()) as {
        generations?: Array<{ img: string; model: string }>;
      };
      const g = st.generations?.[0];
      if (!g) break;
      const img = await fetch(g.img);
      if (!img.ok) break;
      log.push(`AI Horde(${g.model})`);
      return Buffer.from(await img.arrayBuffer());
    }
    console.log("   Horde 시간 초과/실패");
  } catch (e) {
    console.log(`   Horde 실패: ${e instanceof Error ? e.message : e}`);
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
    await new Promise((r) => setTimeout(r, 60_000 * (t + 1)));
  }
  return null;
}

const made: string[] = [];
// Horde 는 대기열이 길어(장당 수 분) 5장을 동시에 요청한다
await Promise.all(
  SCENES.map(async (s, i) => {
    await new Promise((r) => setTimeout(r, i * 2500)); // Horde 는 초당 2건 제한
    const prompt = `${s.prompt}. ${STYLE}. ${s.w > s.h ? "16:9 wide frame" : "9:16 vertical frame"}`;
    const [hw, hh] = s.w > s.h ? [1024, 576] : [576, 1024];
    const img = (await viaHorde(prompt, hw, hh)) ?? (await viaPollinations(prompt, s.w, s.h, 4100 + i));
    if (!img) {
      console.log(`❌ ${s.file} 실패`);
      return;
    }
    const ext = img[0] === 0x89 ? "png" : img.subarray(8, 12).toString() === "WEBP" ? "webp" : "jpg";
    await fs.writeFile(`samples/animal/${s.file}.${ext}`, img);
    made.push(`${s.file}.${ext}`);
    console.log(`✅ ${s.file}.${ext} (${(img.length / 1024).toFixed(0)}KB)`);
  }),
);
await fs.writeFile(
  "samples/animal/README.md",
  `# 동물 캐릭터 그림체 샘플 (하일브론의 유령)\n\n${made.map((m) => `- ${m}`).join("\n")}\n\n스타일: ${STYLE}\n`,
);
console.log(`\n완료 ${made.length}/${SCENES.length}`);
if (!made.length) process.exit(1);

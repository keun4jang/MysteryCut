import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "../config.js";
import { generateStructured } from "../lib/llm.js";
import { hordeGenerate } from "../lib/horde.js";
import type { NarratedSegment, StoryIdea } from "../types.js";

/**
 * 동물 캐릭터 그림(11/12 시험, 사장님 "무료로 쇼츠 1편 시험") — ANIMAL_ART=1 일 때만 켜진다.
 *
 * 영상 전체가 아니라 두 장면만 바꾼다: ① 첫 장면(썸네일·후킹) ② 반전(reveal) 장면.
 * 무료 AI Horde 로 장면당 후보 2장을 뽑고, Gemini(무료, 이미지 판독)가 채점해 기준을 넘는 것만 쓴다.
 * 못 넘으면 원래 Pexels 사진을 그대로 둔다 — 시험이 영상을 망가뜨리지 않게.
 *
 * 원칙(아동용 오해·피해자 경시 방지): 어두운 어른 누아르 그림체, 폭력·피 없음, 피해자는 그리지 않음,
 * 등장인물은 동물 머리를 한 사람 형태, 귀엽거나 밝은 만화체 금지.
 */
const STYLE =
  "(anthropomorphic animal character with an animal head and fur:1.4), dark noir graphic novel illustration, " +
  "muted desaturated colors with one warm accent light, deep shadows, cinematic vertical composition, serious adult tone, painterly texture";
const NEGATIVE =
  "human face, human head, cute, chibi, cartoon for kids, bright colors, smiling, thumbs up, gore, blood, weapon, corpse, nudity, text, letters, watermark, deformed, extra limbs, extra ears";

const PromptSchema = z.object({ prompt: z.string() });
const JudgeSchema = z.object({
  animalHeads: z.boolean(),
  looksForKids: z.boolean(),
  violenceOrGore: z.boolean(),
  hasTextOrWatermark: z.boolean(),
  anatomyOk: z.boolean(),
  readableAsAnimal: z.boolean(),
  matchesScene: z.boolean(),
  score: z.number(),
});

async function scenePrompt(idea: StoryIdea, narration: string, role: string): Promise<string> {
  const r = (await generateStructured({
    schema: PromptSchema,
    system: [
      "You write a single English image-generation prompt (max 60 words) for one scene of a serious true-crime short.",
      "All characters are anthropomorphic animals (an animal head on a person's body, wearing period clothing). Pick fitting species (e.g. fox detective, owl scientist, badger clerk).",
      "Never depict victims, bodies, violence, blood or weapons. A suspect is a silhouette or seen from behind.",
      "Describe concrete objects and the place from the narration, the era, lighting and camera angle. No text or signs in the image.",
      "If the scene role asks for a visible character, show the animal head clearly lit (not from behind, not hidden by a hat or darkness).",
      "Do not include style words; they are added separately.",
    ].join("\n"),
    user: `Case: ${idea.title}\nScene role: ${role}\nNarration (Korean): ${narration}`,
    temperature: 0.7,
    maxRetries: 1,
  })) as z.infer<typeof PromptSchema>;
  return r.prompt.trim();
}

async function judge(img: Buffer, scene: string): Promise<number> {
  const mime = img.subarray(8, 12).toString() === "WEBP" ? "image/webp" : img[0] === 0x89 ? "image/png" : "image/jpeg";
  try {
    const j = (await generateStructured({
      schema: JudgeSchema,
      system:
        "You review an illustration for a serious adult true-crime channel. Answer strictly. score: 0-10 overall usability (composition, clarity, mood, no artifacts).",
      user: `Intended scene: ${scene}\nAre the characters animal-headed (not human faces)? Does it look like children's content (cute, bright, toy-like)? Any violence/gore? Any text or watermark? Is anatomy coherent? readableAsAnimal: at phone size, can a viewer tell instantly that the character is an animal (head visible, lit)? Does it match the scene?`,
      images: [{ mimeType: mime, data: img.toString("base64") }],
      temperature: 0.2,
      maxRetries: 1,
    })) as z.infer<typeof JudgeSchema>;
    const ok = j.animalHeads && j.readableAsAnimal && !j.looksForKids && !j.violenceOrGore && !j.hasTextOrWatermark && j.anatomyOk;
    console.log(
      `   🦊 채점 ${j.score}/10 ${ok ? "통과 조건 충족" : "탈락"}(동물 ${j.animalHeads}, 아동용 ${j.looksForKids}, 폭력 ${j.violenceOrGore}, 글자 ${j.hasTextOrWatermark}, 형태 ${j.anatomyOk})`,
    );
    return ok ? j.score : 0;
  } catch (e) {
    console.log(`   🦊 채점 실패 — 탈락 처리: ${e instanceof Error ? e.message : e}`);
    return 0;
  }
}

export async function attachAnimalArt(segments: NarratedSegment[], idea: StoryIdea): Promise<number> {
  let applied = 0;
  const sceneOf = (s: NarratedSegment, i: number) => s.sceneIndex ?? i;
  const revealIdx = segments.findIndex((s) => s.emphasis === "reveal");
  const targets = [{ scene: 0, role: "opening hook and thumbnail — the main animal character must face the camera (front or three-quarter view, head and shoulders clearly visible, readable as an animal at a glance)" }];
  if (revealIdx > 0 && sceneOf(segments[revealIdx], revealIdx) !== 0)
    targets.push({ scene: sceneOf(segments[revealIdx], revealIdx), role: "the twist / reveal moment" });

  const dir = path.join(config.paths.public, "broll");
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(
    targets.map(async (t, k) => {
      await new Promise((r) => setTimeout(r, k * 3000)); // Horde 초당 2건 제한
      const narration = segments
        .filter((s, i) => sceneOf(s, i) === t.scene)
        .map((s) => s.text)
        .join(" ");
      const p = await scenePrompt(idea, narration, t.role);
      console.log(`   🦊 장면 ${t.scene + 1}(${t.role}) 프롬프트: ${p}`);
      const imgs = await hordeGenerate(`${p}. ${STYLE}`, NEGATIVE, 576, 1024, 2);
      let best: { img: Buffer; score: number } | undefined;
      for (const img of imgs) {
        const score = await judge(img, p);
        if (score >= 7 && (!best || score > best.score)) best = { img, score };
      }
      if (!best) {
        console.log(`   🦊 장면 ${t.scene + 1}: 쓸 만한 그림 없음(후보 ${imgs.length}장) — 원래 사진 유지`);
        return;
      }
      const ext = best.img.subarray(8, 12).toString() === "WEBP" ? "webp" : best.img[0] === 0x89 ? "png" : "jpg";
      const file = `animal-scene-${t.scene}.${ext}`;
      await fs.writeFile(path.join(dir, file), best.img);
      for (const [i, s] of segments.entries()) if (sceneOf(s, i) === t.scene) s.bgSrc = `broll/${file}`;
      applied++;
      console.log(`   🦊 장면 ${t.scene + 1}: 동물 그림 적용(${best.score}/10) → broll/${file}`);
    }),
  );
  return applied;
}

import type { SourceDoc } from "../sources.js";
import type { LongformScript, ResolvedVisual, VisualQuantityMode } from "../../types.js";
import {
  approxRule, chapterAllowed, fits, forceConfidence, nameLeak, negParity,
  numberInQuote, readable, resolveSpan, textBackedBy,
} from "./gates.js";

/** 화면에 쓸 수 있는 역할어 — 목록 밖은 폐기 (G6 (c) 역전) */
const ROLE_OK =
  /^(사망자|생존자|실종자|피해자|목격자|증인|주민|승객|직원|환자|가축|재심 청구|경과|간격|조사 기간|수색 기간|기록|진술|신고|출동|검출|불검출|건물|가구|세대)$/;

const MAX_BAR_W = 1400;
const NUM_FONT = 188;
const UNIT_FONT = 76;
const NAME_FONT = 72;
const CAPTION_FONT = 88;

export interface VisualDrop {
  chapter: number;
  segment: number;
  kind: string;
  reason: string;
}

/**
 * 원문 대조 정규화 — 통과한 그래픽만 남기고 나머지는 frame.visual 을 지운다.
 *
 * 지워져도 대본은 멀쩡하다. 그 문장은 기존 자료 프레임(문장 확대)으로 나간다.
 * "그래픽 개수를 채우려고 사실을 추론"하는 것보다 폐기가 언제나 낫다.
 *
 * sources 가 스코프에 있는 유일한 지점이라 writeLongform 안에서 불러야 한다.
 */
export function normalizeVisuals(
  script: LongformScript,
  sources: SourceDoc[],
  probeTitle: string,
): VisualDrop[] {
  const drops: VisualDrop[] = [];
  const total = script.chapters.length;

  script.chapters.forEach((chapter, ci) => {
    chapter.segments.forEach((seg, si) => {
      const v = seg.frame?.visual;
      if (!v) return;
      const drop = (reason: string) => {
        drops.push({ chapter: ci, segment: si, kind: String(v.kind), reason });
        delete seg.frame!.visual;
      };

      if (!chapterAllowed(ci, total)) return drop("첫·마지막 챕터에는 그래픽을 두지 않는다");
      if (v.kind !== "quantity") return drop(`지원하지 않는 종류(${v.kind})`);

      const claims = v.claims ?? [];
      if (claims.length < 1 || claims.length > 2) return drop(`수치는 1~2개여야 하는데 ${claims.length}개`);

      const resolved: ResolvedVisual["claims"] = [];
      for (const c of claims) {
        if (typeof c.value !== "number" || !Number.isFinite(c.value)) return drop("value 가 숫자가 아님");
        if (c.value < 0 || c.value > 9999) return drop(`value 범위 밖(${c.value})`);
        const span = resolveSpan(c.source?.quote ?? "", sources);
        if (!span) return drop("인용이 원문에 없음");
        if (!numberInQuote(c.value, c.unit, span.quote)) return drop(`${c.value} 가 인용에 없음`);
        if (!textBackedBy(c.text ?? "", span.quote, 0.5)) return drop("화면 글자가 인용에서 나오지 않음");
        if (!negParity(c.text ?? "", span.quote)) return drop("부정 표현이 인용과 어긋남");
        if (nameLeak(c.text ?? "", sources, probeTitle)) return drop("실명·지명이 새어 들어옴");
        const role = (c.role ?? "").trim();
        if (!ROLE_OK.test(role)) return drop(`역할어가 허용 목록 밖(${role || "없음"})`);
        const unit = (c.unit ?? "").trim();
        if (unit.length > 3) return drop(`단위가 3자를 넘음(${unit})`);
        const ap = approxRule(span.quote);
        if (ap.discard) return drop("원문이 '수십·수백' 같은 막연한 수");
        if (!fits(role, NAME_FONT, 620)) return drop("역할어가 화면 폭을 넘음");
        resolved.push({
          text: (c.text ?? "").trim(),
          value: c.value,
          unit,
          role,
          approx: ap.approx,
          confidence: forceConfidence(span, sources),
          quote: span.quote,
        });
      }

      // 두 수를 나란히 놓으려면 **같은 인용**에서 나와야 한다.
      // 무관한 두 수를 붙여 놓으면 원문에 없는 비교를 만들어내는 것이다.
      let mode: VisualQuantityMode = resolved.length === 1 ? "single" : "pair";
      if (resolved.length === 2) {
        if (resolved[0].quote !== resolved[1].quote) mode = "pair-nobar";
        else if (resolved[0].unit !== resolved[1].unit) mode = "pair-nobar";
        else {
          const [a, b] = resolved.map((r) => r.value);
          if (Math.min(a, b) / Math.max(a, b) < 1 / 60) mode = "pair-nobar";
        }
      }
      if (mode === "single") {
        const cap = resolved[0].text;
        if (!fits(cap, CAPTION_FONT, 1584)) return drop("설명 문구가 한 줄에 안 들어감");
      }
      // 숫자줄 전체 폭 검사 (숫자 + 단위 + 역할어)
      for (const r of resolved) {
        const w =
          String(r.value).length * NUM_FONT * 0.55 +
          (r.approx ? 96 * 1 : 0) +
          20 + r.unit.length * UNIT_FONT +
          32 + r.role.length * NAME_FONT;
        if (w > MAX_BAR_W + 120) return drop("숫자줄이 화면 폭을 넘음");
      }

      const title = (v.title ?? "").trim();
      if (title && (title.length > 12 || nameLeak(title, sources, probeTitle))) {
        return drop("제목이 길거나 실명이 들어감");
      }

      // 느슨한 슬롯에 확정값을 얹는다 — 이 지점 이후로는 ResolvedVisual 로만 읽는다
      (seg.frame as { visual?: unknown }).visual = {
        kind: "quantity", title, mode, claims: resolved, buildFrames: 44,
      } satisfies ResolvedVisual;
    });
  });

  return drops;
}

/**
 * 나레이션이 끝난 뒤 — 컷 길이가 확정돼야 판정할 수 있는 것.
 * 조립이 끝나고도 읽을 시간이 남지 않으면 그래픽을 버린다.
 * 못 읽는 그래픽은 없느니만 못하다(화면만 바쁘고 정보는 전달 안 됨).
 */
export function dropUnreadableVisuals(
  chapters: Array<{ segments: Array<{ durationInSeconds: number; frame?: { visual?: ResolvedVisual } }> }>,
  fps = 30,
): number {
  let dropped = 0;
  for (const c of chapters) {
    for (const seg of c.segments) {
      const v = seg.frame?.visual;
      if (!v) continue;
      const frames = Math.max(1, Math.round(seg.durationInSeconds * fps));
      if (!readable(frames, v.buildFrames)) {
        delete seg.frame!.visual;
        dropped++;
      }
    }
  }
  return dropped;
}

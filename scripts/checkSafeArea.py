#!/usr/bin/env python3
"""
유튜브 자막(CC) 안전선 검사.

롱폼 스틸(scripts/longformStill.mts 산출물)에서 '읽을 글자'가 안전선(y=812)
아래로 내려갔는지 픽셀로 확인한다. 사람이 눈으로 보고 넘어가면 긴 문장이
들어온 회차에서만 침범하는 경우를 놓치기 때문에 자동으로 잰다.

  python3 scripts/checkSafeArea.py scratchpad

안전선 값은 src/remotion/LongformDoc.tsx 의 SAFE_BOTTOM 과 맞춰야 한다.
"""
import sys
import glob
import os

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow 가 필요합니다: pip install pillow")

SAFE_LINE = 1080 - 268  # = 812, LongformDoc.tsx 의 SAFE_BOTTOM
# 글자는 밝고(≥200) 한 행에 여러 개가 몰려 있다. 사진의 하이라이트 한두 점과
# 구분하려고 '한 행에 8개 이상'을 조건으로 둔다.
BRIGHT = 200
MIN_RUN = 8


def lowest_text_row(path: str) -> int | None:
    im = Image.open(path).convert("L")
    w, h = im.size
    px = im.load()
    for y in range(h - 1, -1, -1):
        if sum(1 for x in range(0, w, 2) if px[x, y] >= BRIGHT) >= MIN_RUN:
            return y
    return None


def main() -> int:
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "scratchpad"
    files = sorted(glob.glob(os.path.join(out_dir, "lf-*.png")))
    # 썸네일은 1280x720 이고 플레이어 안에서 재생되지 않으므로 검사 대상이 아니다
    files = [f for f in files if "thumb" not in os.path.basename(f)]
    if not files:
        sys.exit(f"{out_dir} 에 lf-*.png 가 없습니다. 먼저 스틸을 렌더하세요.")

    bad = 0
    for f in files:
        y = lowest_text_row(f)
        ok = y is None or y <= SAFE_LINE
        if not ok:
            bad += 1
        print(f"{os.path.basename(f):24s} 글자 최하단 y={str(y):>5s}  {'OK' if ok else '침범'}")

    print(f"\n안전선 y={SAFE_LINE} / 검사 {len(files)}장 / 침범 {bad}장")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Нарезает спрайт-лист 4x4 на выровненные кадры с прозрачным фоном.

Использование: python tools/slice_sprites.py assets/sheet.webp app/renderer/frames [cols] [rows]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ALPHA_CUT = 40      # всё, что прозрачнее, считаем фоном (артефакты webp)
ALPHA_SOLID = 240   # всё, что плотнее, делаем полностью непрозрачным
MAX_SHIFT = 16      # поиск смещения для выравнивания кадров, px


def split_points(profile: np.ndarray, count: int) -> list[int]:
    """Ищет между ячейками линию с минимальным количеством «чернил»."""
    size = len(profile)
    step = size / count
    points = [0]
    for i in range(1, count):
        center = int(step * i)
        lo, hi = center - int(step * 0.15), center + int(step * 0.15)
        points.append(lo + int(np.argmin(profile[lo:hi])))
    points.append(size)
    return points


def clean_alpha(cell: np.ndarray) -> np.ndarray:
    """Чистит полупрозрачный шум и обрезает ячейку по содержимому."""
    alpha = cell[:, :, 3].astype(np.int32)
    alpha[alpha < ALPHA_CUT] = 0
    alpha[alpha >= ALPHA_SOLID] = 255
    out = cell.copy()
    out[:, :, 3] = alpha
    ys, xs = np.where(alpha > 0)
    return out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def best_shift(ref_mask: np.ndarray, mask: np.ndarray) -> tuple[int, int]:
    """Сдвиг (dy, dx), при котором тело (нижняя часть) лучше всего совпадает с эталоном."""
    h = ref_mask.shape[0]
    body = slice(int(h * 0.55), h - MAX_SHIFT)
    ref = ref_mask[body, MAX_SHIFT:-MAX_SHIFT]
    best, best_score = (0, 0), -1.0
    for dy in range(-MAX_SHIFT, MAX_SHIFT + 1):
        for dx in range(-MAX_SHIFT, MAX_SHIFT + 1):
            cand = mask[body.start - dy:body.stop - dy, MAX_SHIFT - dx:mask.shape[1] - MAX_SHIFT - dx]
            score = (ref & cand).sum() / max(1, (ref | cand).sum())
            if score > best_score:
                best, best_score = (dy, dx), score
    return best


def main() -> None:
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    rows = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    dst.mkdir(parents=True, exist_ok=True)

    sheet = np.array(Image.open(src).convert("RGBA"))
    ink = sheet[:, :, 3] > ALPHA_CUT
    xs = split_points(ink.sum(0), cols)

    # Ячейки одинакового размера, чтобы потом выравнивать сдвигом
    cells = []
    for c in range(cols):
        col_ink = ink[:, xs[c]:xs[c + 1]]
        ys = split_points(col_ink.sum(1), rows)
        for r in range(rows):
            cells.append(clean_alpha(sheet[ys[r]:ys[r + 1], xs[c]:xs[c + 1]]))
    # cells сейчас по колонкам — переставим в порядок «строка за строкой»
    cells = [cells[c * rows + r] for r in range(rows) for c in range(cols)]

    size_h = max(cell.shape[0] for cell in cells) + MAX_SHIFT * 2
    size_w = max(cell.shape[1] for cell in cells) + MAX_SHIFT * 2
    canvases = []
    for cell in cells:
        canvas = np.zeros((size_h, size_w, 4), np.uint8)
        # Начальное приближение: прижимаем к низу и центрируем по горизонтали
        oy = size_h - MAX_SHIFT - cell.shape[0]
        ox = (size_w - cell.shape[1]) // 2
        canvas[oy:oy + cell.shape[0], ox:ox + cell.shape[1]] = cell
        canvases.append(canvas)

    ref_mask = canvases[0][:, :, 3] > 0
    aligned = [canvases[0]]
    shifts = [(0, 0)]
    for canvas in canvases[1:]:
        dy, dx = best_shift(ref_mask, canvas[:, :, 3] > 0)
        aligned.append(np.roll(canvas, (dy, dx), axis=(0, 1)))
        shifts.append((dy, dx))

    union = np.zeros((size_h, size_w), bool)
    for frame in aligned:
        union |= frame[:, :, 3] > 0
    ys, xs_ = np.where(union)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs_.min(), xs_.max() + 1

    for i, frame in enumerate(aligned):
        Image.fromarray(frame[y0:y1, x0:x1]).save(dst / f"frame_{i:02d}.png")

    meta = {"count": len(aligned), "width": int(x1 - x0), "height": int(y1 - y0), "shifts": shifts}
    (dst / "frames.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta))


if __name__ == "__main__":
    main()

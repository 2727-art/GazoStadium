"""お貢ぎ牧場の有料アイコン（36〜42・43〜48）を、ユーザーの元画像から作る。

使い方（リポジトリのルートで）:
  python tools/tribute-avatars/premium-icons.py 36 <36の元画像> <37> <38> <39> <40> <41> <42>
  python tools/tribute-avatars/premium-icons.py 43 <43の元画像> <44> <45> <46> <47> <48>

最初の番号から順に、渡した枚数だけ作り直す（ほかの番号の絵と記録はそのまま残す）。
絵は描き直さない。顔に少し寄せて切り抜き、色を整え、四隅を絵の色で沈め、左上に光と髪の上のきらめきを重ねる。
金の縁は画面（tribute.css）とシェア画像（tribute-share.mjs）が描くので、絵には入れない。
50〜76px で並べても顔ときらめきが読めるように、白っぽい絵ほど少し濃くする。暗い絵は、光を弱めて暗さを残す。
書き出すのは 256×256 の WebP（20KB 未満）と、記録の JSON・見本の PNG（全部の有料アイコン）。
"""

import hashlib
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
WORK = 1024
SIZE = 256
CROP = 900
BUDGET = 20_000
RECORD = ROOT / "functions/docs/TRIBUTE_PREMIUM_ICONS_ASSETS.json"
PREVIEW = ROOT / "functions/docs/tribute-premium-icons-preview.png"

# 切り抜きの中心（1024×1024 の元画像での顔の中心）と、四隅を沈める色・きらめきの色。
# sheen は左上の光の強さ（1 が 36〜42 と同じ）。暗い絵は弱めて、夜や影の色を残す。
ICONS = [
    {"id": 36, "center": (520, 560), "key": (255, 140, 180)},  # 桜色
    {"id": 37, "center": (520, 540), "key": (255, 150, 140)},  # 珊瑚色
    {"id": 38, "center": (560, 540), "key": (235, 180, 130)},  # シャンパン
    {"id": 39, "center": (580, 560), "key": (170, 200, 120)},  # 抹茶
    {"id": 40, "center": (520, 540), "key": (255, 170, 200)},  # 白桃
    {"id": 41, "center": (500, 480), "key": (180, 140, 255)},  # 藤色
    {"id": 42, "center": (520, 520), "key": (150, 175, 255)},  # 空色
    {"id": 43, "center": (500, 470), "key": (240, 185, 160)},  # ミルクティー
    {"id": 44, "center": (520, 500), "key": (130, 150, 255)},  # 瑠璃
    {"id": 45, "center": (450, 470), "key": (255, 190, 90), "sheen": 0.45},  # 琥珀
    {"id": 46, "center": (560, 470), "key": (255, 80, 210), "sheen": 0.2},  # ネオン
    {"id": 47, "center": (520, 470), "key": (230, 50, 70), "sheen": 0.35},  # 深紅
    {"id": 48, "center": (512, 460), "key": (255, 70, 140), "sheen": 0.35},  # ルージュ
]
BY_ID = {icon["id"]: icon for icon in ICONS}
# きらめきの位置（0〜1）と大きさ。顔にかからない髪と背景の上に置く。
SPARKLES = [(0.15, 0.15, 1.0), (0.86, 0.11, 0.55), (0.9, 0.8, 0.75), (0.09, 0.87, 0.45), (0.76, 0.28, 0.35)]


def to_array(image):
    return np.asarray(image.convert("RGB")).astype(np.float32) / 255.0


def to_image(array):
    return Image.fromarray((np.clip(array, 0, 1) * 255 + 0.5).astype(np.uint8))


def screen(base, layer):
    return 1 - (1 - base) * (1 - layer)


def grade(a, key, sheen_scale):
    a = a + 0.05 * np.sin((a - 0.5) * math.pi)
    a = 0.5 + (a - 0.5) * 1.06
    grey = a.mean(axis=2, keepdims=True)
    a = grey + (a - grey) * 1.08
    mean = float(a.mean())
    # 白っぽい絵ほど濃くする（平均 0.78 以下は変えない）。
    a = np.clip(a, 0, 1) ** (1 + np.clip((mean - 0.78) / 0.18, 0, 1) * 0.38)
    a = to_array(to_image(a).filter(ImageFilter.UnsharpMask(radius=28, percent=22, threshold=0)))
    yy, xx = np.mgrid[0:WORK, 0:WORK].astype(np.float32) / (WORK - 1)
    edge = np.clip((np.maximum(np.abs(xx - 0.5), np.abs(yy - 0.5)) * 2 - 0.62) / 0.38, 0, 1) ** 1.6
    tint = np.array(key, np.float32) / 255.0
    a = a * (1 - edge[..., None] * (1 - tint * 0.78) * 0.55)
    sheen = np.clip(1 - (xx + yy) / 0.9, 0, 1) ** 2 * 0.22 * np.clip((0.95 - mean) / 0.2, 0, 1) * sheen_scale
    return screen(a, sheen[..., None])


def star(draw, cx, cy, r):
    t = r * 0.11
    draw.polygon([(cx, cy - r), (cx + t, cy - t), (cx + r, cy), (cx + t, cy + t), (cx, cy + r), (cx - t, cy + t), (cx - r, cy), (cx - t, cy - t)], fill=255)
    s, t2 = r * 0.42, r * 0.06
    draw.polygon([(cx - s, cy - s), (cx + t2, cy - t2), (cx + s, cy + s), (cx - t2, cy + t2)], fill=255)
    draw.polygon([(cx + s, cy - s), (cx + t2, cy + t2), (cx - s, cy + s), (cx - t2, cy - t2)], fill=255)


def sparkle(a, key):
    halo = Image.new("L", (WORK, WORK), 0)
    core = Image.new("L", (WORK, WORK), 0)
    halo_draw, core_draw = ImageDraw.Draw(halo), ImageDraw.Draw(core)
    for x, y, scale in SPARKLES:
        cx, cy, r = x * WORK, y * WORK, 70 * scale
        halo_draw.ellipse((cx - r * 0.55, cy - r * 0.55, cx + r * 0.55, cy + r * 0.55), fill=255)
        star(core_draw, cx, cy, r)
    layer = lambda image, blur: np.asarray(image.filter(ImageFilter.GaussianBlur(blur))).astype(np.float32)[..., None] / 255
    tint = np.array(key, np.float32) / 255.0
    a = screen(a, layer(halo, 22) * 0.55 * (0.55 + 0.45 * tint))
    a = screen(a, layer(core, 5) * 0.8 * (0.6 + 0.4 * tint))
    return screen(a, layer(core, 1.2))


def crop_box(center):
    half = CROP // 2
    left = max(0, min(center[0] - half, WORK - CROP))
    top = max(0, min(center[1] - half, WORK - CROP))
    return (left, top, left + CROP, top + CROP)


def encode(image):
    for quality in range(90, 58, -2):
        buffer = io.BytesIO()
        image.save(buffer, "WEBP", quality=quality, method=6)
        if buffer.tell() < BUDGET:
            return buffer.getvalue(), quality
    raise SystemExit("アイコンが 20KB に収まりません。")


def make(icon, source):
    raw = source.read_bytes()
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    if image.size != (WORK, WORK):
        raise SystemExit(f"{source.name} は {WORK}×{WORK} ではありません。")
    box = crop_box(icon["center"])
    a = to_array(image.crop(box).resize((WORK, WORK), Image.LANCZOS))
    a = sparkle(grade(a, icon["key"], icon.get("sheen", 1.0)), icon["key"])
    out = to_image(a).resize((SIZE, SIZE), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=0.8, percent=60, threshold=1))
    data, quality = encode(out)
    file = f"assets/tribute-avatars/avatar-{icon['id']}.webp"
    (ROOT / file).write_bytes(data)
    record = {
        "id": icon["id"],
        "file": file,
        "sourceFile": source.name,
        "sourceSha256": hashlib.sha256(raw).hexdigest(),
        "crop": {"left": box[0], "top": box[1], "width": CROP, "height": CROP},
        "width": SIZE,
        "height": SIZE,
        "quality": quality,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    if "sheen" in icon:
        record["sheen"] = icon["sheen"]
    return record


def preview_sheet(records):
    per_row = 7
    rows = math.ceil(len(records) / per_row)
    sheet = Image.new("RGB", (16 + per_row * 176, 16 + rows * 176), (34, 28, 43))
    for index, record in enumerate(records):
        tile = Image.open(ROOT / record["file"]).convert("RGB").resize((160, 160), Image.LANCZOS)
        sheet.paste(tile, (16 + (index % per_row) * 176, 16 + (index // per_row) * 176))
    sheet.save(PREVIEW)


def main():
    if len(sys.argv) < 3 or not sys.argv[1].isdigit():
        raise SystemExit("最初の番号と、その番号から順の元画像を渡してください（例: 43 a.webp b.webp …）。")
    first = int(sys.argv[1])
    sources = [Path(path) for path in sys.argv[2:]]
    ids = list(range(first, first + len(sources)))
    missing = [id for id in ids if id not in BY_ID]
    if missing:
        raise SystemExit(f"番号 {missing} の切り抜きと色が ICONS にありません。")
    made = [make(BY_ID[id], source) for id, source in zip(ids, sources)]
    previous = json.loads(RECORD.read_text(encoding="utf-8")) if RECORD.exists() else {"icons": []}
    records = sorted([entry for entry in previous["icons"] if entry["id"] not in ids] + made, key=lambda entry: entry["id"])
    preview_sheet(records)
    record = {
        "method": "Crop, colour grade, edge tint, sheen and sparkle overlay, resize, WebP encoding. No generative redraw. The gold frame is drawn by CSS and canvas, not baked in.",
        "icons": records,
    }
    RECORD.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps([{"id": r["id"], "bytes": r["bytes"], "quality": r["quality"]} for r in made]))


main()

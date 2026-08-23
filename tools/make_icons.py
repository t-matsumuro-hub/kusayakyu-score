"""アプリアイコンを生成する。依存は Pillow のみ。

    python tools/make_icons.py

icons/ に icon-180 / 192 / 512 / maskable-512 を出力する。
"""
from PIL import Image, ImageDraw
import math
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
BG = (15, 81, 50)          # ダークグリーン（テーマ色）
BALL = (250, 250, 248)
SEAM = (198, 40, 40)


def draw_ball(size, pad_ratio, bg):
    """野球ボールを描いた正方形アイコンを返す。"""
    s = size * 4  # 4倍で描いて縮小（簡易アンチエイリアス）
    img = Image.new("RGBA", (s, s), bg)
    d = ImageDraw.Draw(img)

    pad = int(s * pad_ratio)
    box = (pad, pad, s - pad, s - pad)
    d.ellipse(box, fill=BALL)

    r = (box[2] - box[0]) / 2
    cx = cy = s / 2
    lw = max(2, int(r * 0.09))

    # 左右の縫い目。中心をずらした大きな円の一部を描く。
    # 円弧がボール内に収まる角度範囲を解析的に求めてから描く。
    off = r * 1.55   # 弧を描く円の中心のずれ
    rr = r * 1.25    # 弧を描く円の半径
    # 弧を描く円とボール輪郭の交点の角度。ボール内側になるのは mid を挟んだ外側寄りの範囲
    cos_t = (r * r - off * off - rr * rr) / (2 * off * rr)
    boundary = math.degrees(math.acos(max(-1.0, min(1.0, cos_t))))
    half = (180.0 - boundary) * 0.94  # 端がボール輪郭に接しないよう少し内側で止める

    for sign in (-1, 1):
        ax = cx + sign * off
        # 弧を描く円の中心から見て、ボール中心を向く方向が弧の中央
        mid = 180.0 if sign > 0 else 0.0
        start, end = mid - half, mid + half
        arc_box = (ax - rr, cy - rr, ax + rr, cy + rr)
        d.arc(arc_box, start=start, end=end, fill=SEAM, width=lw)

        # 縫い目のステッチを弧に直交させて並べる
        n = 8
        stitch = r * 0.10
        for i in range(n):
            t = math.radians(start + (end - start) * (i + 0.5) / n)
            px = ax + rr * math.cos(t)
            py = cy + rr * math.sin(t)
            dx, dy = math.cos(t), math.sin(t)
            d.line((px - dx * stitch, py - dy * stitch,
                    px + dx * stitch, py + dy * stitch),
                   fill=SEAM, width=max(2, int(lw * 0.6)))

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (180, 192, 512):
        # iOS は角丸を自動で付けるため、背景は不透明で全面塗り
        draw_ball(size, 0.16, BG).convert("RGB").save(os.path.join(OUT, f"icon-{size}.png"))
    # maskable は安全領域（中央80%）に収まるよう内側に寄せる
    draw_ball(512, 0.26, BG).convert("RGB").save(os.path.join(OUT, "icon-maskable-512.png"))
    print("wrote:", ", ".join(sorted(os.listdir(OUT))))


if __name__ == "__main__":
    main()

"""Generate a 1-minute synthetic test video using Pillow + ffmpeg."""

import os
import math
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFont

OUTPUT = "SP_1001_20260417.mp4"
FPS = 24
DURATION = 60
WIDTH, HEIGHT = 1280, 720
TOTAL_FRAMES = FPS * DURATION

STORE_SECTIONS = [
    {
        "name": "Entrada - Vitrines e Manequins",
        "duration": (0, 10),
        "fixtures": [
            {"type": "MANEQUIM", "x": 150, "y": 150, "w": 80, "h": 280},
            {"type": "MANEQUIM", "x": 320, "y": 150, "w": 80, "h": 280},
            {"type": "DISPLAY", "x": 520, "y": 220, "w": 220, "h": 200},
            {"type": "BALCAO", "x": 860, "y": 320, "w": 300, "h": 120},
        ],
    },
    {
        "name": "Corredor 1 - Roupas Femininas",
        "duration": (10, 20),
        "fixtures": [
            {"type": "ARARA", "x": 80, "y": 160, "w": 260, "h": 200},
            {"type": "ARARA", "x": 420, "y": 160, "w": 260, "h": 200},
            {"type": "ARARA", "x": 780, "y": 160, "w": 260, "h": 200},
            {"type": "CABIDEIRO_PAREDE", "x": 80, "y": 60, "w": 350, "h": 60},
            {"type": "MESA", "x": 500, "y": 430, "w": 220, "h": 160},
        ],
    },
    {
        "name": "Corredor 2 - Roupas Masculinas",
        "duration": (20, 30),
        "fixtures": [
            {"type": "ARARA", "x": 100, "y": 180, "w": 240, "h": 200},
            {"type": "GONDOLA", "x": 460, "y": 120, "w": 160, "h": 340},
            {"type": "GONDOLA", "x": 720, "y": 120, "w": 160, "h": 340},
            {"type": "MANEQUIM", "x": 1000, "y": 160, "w": 80, "h": 280},
            {"type": "MESA", "x": 100, "y": 440, "w": 200, "h": 140},
        ],
    },
    {
        "name": "Corredor 3 - Calcados e Acessorios",
        "duration": (30, 40),
        "fixtures": [
            {"type": "GONDOLA", "x": 60, "y": 100, "w": 160, "h": 380},
            {"type": "GONDOLA", "x": 300, "y": 100, "w": 160, "h": 380},
            {"type": "GONDOLA", "x": 540, "y": 100, "w": 160, "h": 380},
            {"type": "PRATELEIRA", "x": 800, "y": 80, "w": 380, "h": 50},
            {"type": "PRATELEIRA", "x": 800, "y": 180, "w": 380, "h": 50},
            {"type": "PRATELEIRA", "x": 800, "y": 280, "w": 380, "h": 50},
            {"type": "DISPLAY", "x": 820, "y": 400, "w": 200, "h": 180},
        ],
    },
    {
        "name": "Corredor 4 - Promocoes",
        "duration": (40, 50),
        "fixtures": [
            {"type": "CESTAO", "x": 100, "y": 200, "w": 220, "h": 200},
            {"type": "CESTAO", "x": 400, "y": 200, "w": 220, "h": 200},
            {"type": "CESTAO", "x": 700, "y": 200, "w": 220, "h": 200},
            {"type": "DISPLAY", "x": 1000, "y": 160, "w": 200, "h": 240},
            {"type": "GONDOLA", "x": 100, "y": 480, "w": 320, "h": 140},
        ],
    },
    {
        "name": "Area de Checkout",
        "duration": (50, 60),
        "fixtures": [
            {"type": "CHECKOUT", "x": 60, "y": 260, "w": 180, "h": 140},
            {"type": "CHECKOUT", "x": 300, "y": 260, "w": 180, "h": 140},
            {"type": "CHECKOUT", "x": 540, "y": 260, "w": 180, "h": 140},
            {"type": "CHECKOUT", "x": 780, "y": 260, "w": 180, "h": 140},
            {"type": "GONDOLA", "x": 160, "y": 80, "w": 120, "h": 150},
            {"type": "GONDOLA", "x": 440, "y": 80, "w": 120, "h": 150},
            {"type": "DISPLAY", "x": 1020, "y": 120, "w": 180, "h": 200},
        ],
    },
]

COLORS = {
    "ARARA": ("#D946EF", "#FCEAFF"),
    "GONDOLA": ("#2563EB", "#EFF6FF"),
    "CESTAO": ("#F59E0B", "#FFFBEB"),
    "PRATELEIRA": ("#10B981", "#ECFDF5"),
    "BALCAO": ("#8B5CF6", "#F5F3FF"),
    "DISPLAY": ("#EF4444", "#FEF2F2"),
    "CHECKOUT": ("#6366F1", "#EEF2FF"),
    "MANEQUIM": ("#14B8A6", "#F0FDFA"),
    "MESA": ("#F97316", "#FFF7ED"),
    "CABIDEIRO_PAREDE": ("#84CC16", "#F7FEE7"),
}

OCCUPANCY = ["CHEIO", "CHEIO", "PARCIAL", "CHEIO", "PARCIAL", "VAZIO", "CHEIO", "PARCIAL"]


def draw_fixture(draw, f, idx, t):
    x, y, w, h = f["x"], f["y"], f["w"], f["h"]
    ftype = f["type"]
    border_color, fill_color = COLORS.get(ftype, ("#666", "#eee"))
    occ = OCCUPANCY[idx % len(OCCUPANCY)]

    # Slight movement for realism
    ox = int(math.sin(t * 0.4 + idx) * 8)
    oy = int(math.cos(t * 0.3 + idx * 0.7) * 4)
    x += ox
    y += oy

    # Main fixture body
    draw.rounded_rectangle([x, y, x + w, y + h], radius=8, fill=fill_color, outline=border_color, width=3)

    # Type-specific details
    if ftype == "GONDOLA":
        n_shelves = 4
        for i in range(1, n_shelves):
            sy = y + i * h // n_shelves
            draw.line([(x + 5, sy), (x + w - 5, sy)], fill=border_color, width=2)
            if occ != "VAZIO":
                items = 5 if occ == "CHEIO" else 3
                for j in range(items):
                    px = x + 8 + j * (w - 16) // items
                    colors = ["#EF4444", "#3B82F6", "#10B981", "#F59E0B", "#EC4899"]
                    draw.rectangle([px, sy - h // n_shelves + 8, px + (w - 20) // items, sy - 4], fill=colors[j % 5])

    elif ftype == "ARARA":
        # Circular bar
        draw.ellipse([x + 20, y + 20, x + w - 20, y + 60], outline=border_color, width=2)
        # Pole
        draw.line([(x + w // 2, y + 60), (x + w // 2, y + h - 20)], fill="#888", width=4)
        # Clothes
        if occ != "VAZIO":
            n = 8 if occ == "CHEIO" else 4
            for i in range(n):
                px = x + 25 + i * (w - 50) // n
                colors = ["#EF4444", "#3B82F6", "#10B981", "#F59E0B"]
                draw.rectangle([px, y + 65, px + 18, y + 140], fill=colors[i % 4])

    elif ftype == "CESTAO":
        # Trapezoid shape
        draw.polygon([(x + 15, y), (x + w - 15, y), (x + w, y + h), (x, y + h)], fill=fill_color, outline=border_color)
        if occ != "VAZIO":
            n = 10 if occ == "CHEIO" else 4
            for i in range(n):
                cx = x + 30 + (i % 4) * (w - 60) // 4
                cy = y + 30 + (i // 4) * 50
                draw.ellipse([cx - 12, cy - 12, cx + 12, cy + 12], fill=["#FCD34D", "#93C5FD", "#FCA5A5"][i % 3])
        # PROMO banner
        draw.rectangle([x + w // 4, y - 30, x + 3 * w // 4, y - 2], fill="#EF4444")
        draw.text((x + w // 4 + 8, y - 28), "PROMO", fill="white")

    elif ftype == "CHECKOUT":
        draw.rectangle([x + 10, y + 10, x + 60, y + 50], fill="#1F2937")  # register
        draw.rectangle([x + 15, y + 15, x + 55, y + 45], fill="#60A5FA")  # screen
        draw.rectangle([x + 70, y + h - 35, x + w - 10, y + h - 10], fill="#374151")  # belt
        # Number
        draw.ellipse([x + w // 2 - 15, y - 25, x + w // 2 + 15, y + 5], fill="#10B981")

    elif ftype == "MANEQUIM":
        cx = x + w // 2
        draw.ellipse([cx - 16, y + 5, cx + 16, y + 40], fill="#D4A88C")  # head
        draw.rectangle([cx - 20, y + 42, cx + 20, y + 130], fill="#3B82F6")  # torso
        draw.rectangle([cx - 12, y + 132, cx - 2, y + 240], fill="#1F2937")  # left leg
        draw.rectangle([cx + 2, y + 132, cx + 12, y + 240], fill="#1F2937")  # right leg
        draw.ellipse([cx - 22, y + 242, cx + 22, y + 260], fill="#6B7280")  # base

    elif ftype == "PRATELEIRA":
        # Items on shelf
        if occ != "VAZIO":
            n = 8 if occ == "CHEIO" else 4
            for i in range(n):
                px = x + 5 + i * (w - 10) // n
                colors = ["#EF4444", "#3B82F6", "#10B981", "#F59E0B"]
                draw.rectangle([px, y - 35, px + (w - 20) // n, y - 2], fill=colors[i % 4])

    elif ftype == "DISPLAY":
        draw.rectangle([x, y - 28, x + w, y], fill="#EF4444")
        draw.text((x + 10, y - 26), "OFERTA ESPECIAL", fill="white")
        for i in range(3):
            for j in range(2):
                px = x + 12 + i * (w - 24) // 3
                py = y + 12 + j * (h - 24) // 2
                draw.rectangle([px, py, px + 50, py + 60], fill="#FDE68A", outline="#D97706")

    elif ftype == "MESA":
        if occ != "VAZIO":
            n = 6 if occ == "CHEIO" else 3
            for i in range(n):
                px = x + 10 + (i % 3) * (w - 30) // 3
                py = y + 10 + (i // 3) * 60
                colors = ["#BFDBFE", "#FECACA", "#BBF7D0"]
                draw.rectangle([px, py, px + 55, py + 40], fill=colors[i % 3], outline="#888")

    elif ftype == "CABIDEIRO_PAREDE":
        if occ != "VAZIO":
            n = 10 if occ == "CHEIO" else 5
            for i in range(n):
                px = x + 15 + i * (w - 30) // n
                colors = ["#EF4444", "#3B82F6", "#10B981"]
                draw.rectangle([px, y + h + 5, px + 20, y + h + 80], fill=colors[i % 3])

    # Label
    label = f"{ftype}"
    draw.rectangle([x, y - 18 if ftype not in ("CESTAO", "DISPLAY") else y + h + 5, x + len(label) * 8 + 10, y - 2 if ftype not in ("CESTAO", "DISPLAY") else y + h + 22], fill=border_color)
    draw.text((x + 5, y - 17 if ftype not in ("CESTAO", "DISPLAY") else y + h + 6), label, fill="white")

    # Occupancy tag
    occ_colors = {"CHEIO": "#10B981", "PARCIAL": "#F59E0B", "VAZIO": "#EF4444"}
    draw.rounded_rectangle([x + w - 60, y + h - 20, x + w, y + h], radius=4, fill=occ_colors[occ])
    draw.text((x + w - 56, y + h - 18), occ, fill="white")


def generate_frame(frame_num):
    t = frame_num / FPS
    img = Image.new("RGB", (WIDTH, HEIGHT), "#E5E7EB")
    draw = ImageDraw.Draw(img)

    # Find section
    section = STORE_SECTIONS[0]
    for s in STORE_SECTIONS:
        if s["duration"][0] <= t < s["duration"][1]:
            section = s
            break

    # Floor pattern
    for x in range(0, WIDTH, 100):
        for y in range(0, HEIGHT, 100):
            if (x // 100 + y // 100) % 2 == 0:
                draw.rectangle([x, y, x + 100, y + 100], fill="#DDD6CF")

    # Ceiling area
    draw.rectangle([0, 0, WIDTH, 80], fill="#F1F5F9")
    for lx in range(80, WIDTH, 200):
        draw.rectangle([lx, 15, lx + 100, 30], fill="#FEFCE8", outline="#FDE68A")

    # Draw all fixtures
    for idx, f in enumerate(section["fixtures"]):
        draw_fixture(draw, f, idx, t)

    # Section title bar
    draw.rectangle([0, HEIGHT - 55, WIDTH, HEIGHT], fill="#1E293B")
    draw.text((20, HEIGHT - 45), section["name"], fill="white")
    draw.text((20, HEIGHT - 25), f"Loja Americanas SP-1001 | Secao {STORE_SECTIONS.index(section) + 1}/{len(STORE_SECTIONS)}", fill="#94A3B8")

    # Timer
    draw.rectangle([WIDTH - 200, 0, WIDTH, 40], fill="#1E293B")
    draw.text((WIDTH - 190, 5), f"REC", fill="#EF4444")
    draw.text((WIDTH - 190, 20), f"{int(t // 60):02d}:{int(t % 60):02d} / 01:00", fill="white")

    # Fixture count for section
    draw.rectangle([WIDTH - 200, 45, WIDTH, 75], fill="#0F172ACC")
    draw.text((WIDTH - 190, 50), f"{len(section['fixtures'])} expositores", fill="#60A5FA")

    return img


def main():
    tmpdir = tempfile.mkdtemp()
    print(f"Generating {DURATION}s test video at {FPS}fps...")
    print(f"Temp frames: {tmpdir}")

    for i in range(TOTAL_FRAMES):
        img = generate_frame(i)
        img.save(os.path.join(tmpdir, f"frame_{i:06d}.png"))
        if i % (FPS * 10) == 0:
            print(f"  {i // FPS}s / {DURATION}s ({i}/{TOTAL_FRAMES} frames)")

    print("Encoding video with ffmpeg...")
    subprocess.run([
        "ffmpeg", "-y", "-framerate", str(FPS),
        "-i", os.path.join(tmpdir, "frame_%06d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-preset", "fast", "-crf", "23",
        "-movflags", "+faststart",
        OUTPUT,
    ], capture_output=True, check=True)

    # Cleanup frames
    for f in os.listdir(tmpdir):
        os.unlink(os.path.join(tmpdir, f))
    os.rmdir(tmpdir)

    size_mb = os.path.getsize(OUTPUT) / 1024 / 1024
    print(f"\nVideo gerado: {OUTPUT} ({size_mb:.1f} MB)")
    print(f"Formato: {WIDTH}x{HEIGHT} @ {FPS}fps, {DURATION}s")

    total_fixtures = sum(len(s["fixtures"]) for s in STORE_SECTIONS)
    print(f"\nTotal de expositores no video: {total_fixtures}")
    for s in STORE_SECTIONS:
        types = {}
        for f in s["fixtures"]:
            types[f["type"]] = types.get(f["type"], 0) + 1
        desc = ", ".join(f"{v}x {k}" for k, v in types.items())
        print(f"  [{s['duration'][0]}-{s['duration'][1]}s] {s['name']}: {desc}")


if __name__ == "__main__":
    main()

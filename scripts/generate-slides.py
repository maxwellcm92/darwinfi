#!/usr/bin/env python3
"""
DarwinFi Demo Title Card Generator
Uses ImageMagick to create 1920x1080 title cards matching the dapp aesthetic.
"""

import os
import subprocess
import sys

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "demo-output", "slides")

# Colors matching dapp theme
BG_COLOR = "#0a0a0a"
TEAL = "#14b8a6"
WHITE = "#f0f0f0"
GRAY = "#888888"

# Title cards to generate
CARDS = [
    {
        "name": "opening",
        "lines": [
            {"text": "DarwinFi", "color": TEAL, "size": 120, "y": 380},
            {"text": "A self-evolving financial organism", "color": WHITE, "size": 48, "y": 520},
            {"text": "Survival of the fittest, on-chain.", "color": GRAY, "size": 36, "y": 600},
        ],
    },
    {
        "name": "scene-vault",
        "lines": [
            {"text": "The Vault", "color": TEAL, "size": 96, "y": 460},
            {"text": "ERC-4626  |  Base L2  |  USDC", "color": GRAY, "size": 36, "y": 580},
        ],
    },
    {
        "name": "scene-trading",
        "lines": [
            {"text": "Live Trading", "color": TEAL, "size": 96, "y": 460},
            {"text": "Real capital. Real swaps. On-chain.", "color": GRAY, "size": 36, "y": 580},
        ],
    },
    {
        "name": "scene-evolution",
        "lines": [
            {"text": "Tournament & Evolution", "color": TEAL, "size": 80, "y": 460},
            {"text": "16 strategies. Darwinian selection.", "color": GRAY, "size": 36, "y": 580},
        ],
    },
    {
        "name": "closing",
        "lines": [
            {"text": "DarwinFi", "color": TEAL, "size": 96, "y": 300},
            {"text": "Vault: 0x4a55DEEC24C6b5c1aa6301b43b4D9680c10491d7", "color": GRAY, "size": 28, "y": 440},
            {"text": "https://corduroycloud.com/darwinfi/", "color": WHITE, "size": 36, "y": 520},
            {"text": "Built with", "color": GRAY, "size": 28, "y": 640},
            {"text": "Base  |  Uniswap V3  |  Lit Protocol  |  Venice AI  |  Claude Code", "color": TEAL, "size": 32, "y": 700},
        ],
    },
]


def generate_card(card: dict) -> str:
    """Generate a single title card PNG using ImageMagick convert."""
    output_path = os.path.join(OUTPUT_DIR, f"{card['name']}.png")

    # Build the convert command
    cmd = [
        "convert",
        "-size", "1920x1080",
        f"xc:{BG_COLOR}",
    ]

    for line in card["lines"]:
        cmd.extend([
            "-font", "Liberation-Sans-Bold",
            "-pointsize", str(line["size"]),
            "-fill", line["color"],
            "-gravity", "North",
            "-annotate", f"+0+{line['y']}", line["text"],
        ])

    cmd.append(output_path)

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # Try fallback font
        cmd_fallback = []
        for arg in cmd[:-1]:
            if arg == "Liberation-Sans-Bold":
                cmd_fallback.append("DejaVu-Sans-Bold")
            else:
                cmd_fallback.append(arg)
        cmd_fallback.append(output_path)
        result = subprocess.run(cmd_fallback, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"  ERROR: {result.stderr.strip()}")
            return ""

    size_kb = os.path.getsize(output_path) / 1024
    print(f"  {card['name']}.png ({size_kb:.1f} KB)")
    return output_path


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Check ImageMagick is available
    try:
        subprocess.run(["convert", "--version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("ERROR: ImageMagick 'convert' not found. Install with: sudo apt install imagemagick")
        sys.exit(1)

    print("Generating title cards (1920x1080)...\n")

    generated = []
    for card in CARDS:
        path = generate_card(card)
        if path:
            generated.append(path)

    print(f"\nGenerated {len(generated)}/{len(CARDS)} title cards in: {OUTPUT_DIR}")

    # Also generate 3-second video clips from each card
    print("\nConverting to 3-second video clips...")
    clips_dir = os.path.join(OUTPUT_DIR, "clips")
    os.makedirs(clips_dir, exist_ok=True)

    for path in generated:
        name = os.path.splitext(os.path.basename(path))[0]
        clip_path = os.path.join(clips_dir, f"{name}.mp4")
        cmd = [
            "ffmpeg", "-y",
            "-loop", "1",
            "-i", path,
            "-c:v", "libx264",
            "-t", "3",
            "-pix_fmt", "yuv420p",
            "-vf", "scale=1920:1080",
            "-r", "30",
            clip_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            size_kb = os.path.getsize(clip_path) / 1024
            print(f"  {name}.mp4 ({size_kb:.1f} KB)")
        else:
            print(f"  ERROR creating {name}.mp4: {result.stderr[:200]}")

    print(f"\nVideo clips in: {clips_dir}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
DarwinFi Demo Infographic Slide Generator (v2)
Uses ImageMagick to create 1920x1080 infographic slides.
3 data-rich infographics + 1 closing card (no interstitial title cards).
"""

import os
import subprocess
import sys

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "demo-output", "slides")

# Colors matching dapp theme
BG_COLOR = "#0a0a0a"
TEAL = "#14b8a6"
PURPLE = "#a855f7"
ORANGE = "#f97316"
GOLD = "#eab308"
RED = "#ef4444"
WHITE = "#f0f0f0"
GRAY = "#888888"
GREEN = "#22c55e"

# Slide durations in seconds (infographics get longer than old 3s title cards)
DURATIONS = {
    "tournament": 20,
    "evolution": 20,
    "instinct": 15,
    "closing": 3,
}

# Font (try Liberation Sans Bold, fallback to DejaVu Sans Bold)
FONT = "Liberation-Sans-Bold"
FONT_FALLBACK = "DejaVu-Sans-Bold"


def generate_tournament_slide(output_path: str) -> bool:
    """Darwinian Tournament infographic with fitness formula bars."""
    cmd = [
        "convert",
        "-size", "1920x1080",
        f"xc:{BG_COLOR}",
        # Header
        "-font", FONT, "-pointsize", "72", "-fill", TEAL,
        "-gravity", "North", "-annotate", "+0+60", "DARWINIAN TOURNAMENT",
        # Subtitle
        "-pointsize", "36", "-fill", WHITE,
        "-annotate", "+0+160", "16 strategies enter. Only the fittest trade live.",
        # Fitness formula header
        "-pointsize", "28", "-fill", GRAY,
        "-annotate", "+0+240", "FITNESS FORMULA",
        # PnL bar (35%) - teal
        "-fill", TEAL,
        "-draw", f"rectangle 460,310 1110,360",
        "-fill", WHITE, "-pointsize", "26",
        "-gravity", "NorthWest", "-annotate", "+310+318", "PnL",
        "-gravity", "NorthEast", "-annotate", "+680+318", "35%",
        # Sharpe bar (25%) - purple
        "-fill", PURPLE,
        "-draw", f"rectangle 460,390 995,440",
        "-fill", WHITE, "-pointsize", "26",
        "-gravity", "NorthWest", "-annotate", "+310+398", "Sharpe Ratio",
        "-gravity", "NorthEast", "-annotate", "+795+398", "25%",
        # Consistency bar (20%) - gold
        "-fill", GOLD,
        "-draw", f"rectangle 460,470 925,520",
        "-fill", WHITE, "-pointsize", "26",
        "-gravity", "NorthWest", "-annotate", "+310+478", "Consistency",
        "-gravity", "NorthEast", "-annotate", "+865+478", "20%",
        # Win Rate bar (15%) - white
        "-fill", WHITE,
        "-draw", f"rectangle 460,550 850,600",
        "-fill", BG_COLOR, "-pointsize", "26",
        "-gravity", "NorthWest", "-annotate", "+310+558", "Win Rate",
        "-fill", WHITE,
        "-gravity", "NorthEast", "-annotate", "+940+558", "15%",
        # Drawdown bar (-5%) - red
        "-fill", RED,
        "-draw", f"rectangle 460,630 780,680",
        "-fill", WHITE, "-pointsize", "26",
        "-gravity", "NorthWest", "-annotate", "+310+638", "Drawdown Penalty",
        "-gravity", "NorthEast", "-annotate", "+1010+638", "-5%",
        # Footnotes
        "-gravity", "North",
        "-fill", GRAY, "-pointsize", "24",
        "-annotate", "+0+780", "Drawdown is penalized exponentially.",
        "-fill", GRAY,
        "-annotate", "+0+820", "A 20% drawdown costs 4x more than 10%.",
        output_path,
    ]
    return _run_convert(cmd, output_path)


def generate_evolution_slide(output_path: str) -> bool:
    """Self-Evolution pipeline infographic."""
    cmd = [
        "convert",
        "-size", "1920x1080",
        f"xc:{BG_COLOR}",
        # Header
        "-font", FONT, "-pointsize", "72", "-fill", ORANGE,
        "-gravity", "North", "-annotate", "+0+60", "SELF-EVOLUTION",
        # Subtitle
        "-pointsize", "36", "-fill", WHITE,
        "-annotate", "+0+160", "Every 4 hours. Automated. Autonomous.",
        # Pipeline boxes (horizontal flow)
        # Box 1: AI Proposes (orange)
        "-fill", ORANGE, "-draw", "roundrectangle 80,340 330,430 15,15",
        "-fill", BG_COLOR, "-pointsize", "22",
        "-gravity", "NorthWest", "-annotate", "+120+370", "AI Proposes",
        # Arrow 1
        "-fill", GRAY, "-pointsize", "36",
        "-gravity", "NorthWest", "-annotate", "+345+365", "->",
        # Box 2: Sandbox (purple)
        "-fill", PURPLE, "-draw", "roundrectangle 400,340 600,430 15,15",
        "-fill", WHITE, "-pointsize", "22",
        "-gravity", "NorthWest", "-annotate", "+445+370", "Sandbox",
        # Arrow 2
        "-fill", GRAY, "-pointsize", "36",
        "-gravity", "NorthWest", "-annotate", "+615+365", "->",
        # Box 3: 423 Tests (teal)
        "-fill", TEAL, "-draw", "roundrectangle 670,340 890,430 15,15",
        "-fill", BG_COLOR, "-pointsize", "22",
        "-gravity", "NorthWest", "-annotate", "+715+370", "423 Tests",
        # Arrow 3
        "-fill", GRAY, "-pointsize", "36",
        "-gravity", "NorthWest", "-annotate", "+905+365", "->",
        # Box 4: Canary Deploy (gold)
        "-fill", GOLD, "-draw", "roundrectangle 960,340 1220,430 15,15",
        "-fill", BG_COLOR, "-pointsize", "22",
        "-gravity", "NorthWest", "-annotate", "+990+370", "Canary Deploy",
        # Arrow 4
        "-fill", GRAY, "-pointsize", "36",
        "-gravity", "NorthWest", "-annotate", "+1235+365", "->",
        # Box 5: Promote (green)
        "-fill", GREEN, "-draw", "roundrectangle 1290,340 1490,430 15,15",
        "-fill", BG_COLOR, "-pointsize", "22",
        "-gravity", "NorthWest", "-annotate", "+1335+370", "Promote",
        # Arrow 5
        "-fill", GRAY, "-pointsize", "36",
        "-gravity", "NorthWest", "-annotate", "+1505+365", "->",
        # Box 6: IPFS Pin (white outline)
        "-fill", WHITE, "-draw", "roundrectangle 1560,340 1790,430 15,15",
        "-fill", BG_COLOR, "-pointsize", "22",
        "-gravity", "NorthWest", "-annotate", "+1615+370", "IPFS Pin",
        # Footnotes
        "-gravity", "North",
        "-fill", GRAY, "-pointsize", "26",
        "-annotate", "+0+560", "Failed mutations are killed. Winning genomes are permanent.",
        "-fill", GRAY, "-pointsize", "24",
        "-annotate", "+0+610", "Venice AI generates mutations. Git worktrees isolate them.",
        output_path,
    ]
    return _run_convert(cmd, output_path)


def generate_instinct_slide(output_path: str) -> bool:
    """Instinct Brain diagram with 3 models -> calibration -> trade signal."""
    cmd = [
        "convert",
        "-size", "1920x1080",
        f"xc:{BG_COLOR}",
        # Header
        "-font", FONT, "-pointsize", "72", "-fill", GOLD,
        "-gravity", "North", "-annotate", "+0+60", "INSTINCT BRAIN",
        # Subtitle
        "-pointsize", "36", "-fill", WHITE,
        "-annotate", "+0+160", "Multi-model consensus. Calibrated trust.",
        # Model A box
        "-fill", TEAL, "-draw", "roundrectangle 300,340 580,420 15,15",
        "-fill", BG_COLOR, "-pointsize", "24",
        "-gravity", "NorthWest", "-annotate", "+380+365", "Model A",
        # Model B box
        "-fill", PURPLE, "-draw", "roundrectangle 300,450 580,530 15,15",
        "-fill", WHITE, "-pointsize", "24",
        "-gravity", "NorthWest", "-annotate", "+380+475", "Model B",
        # Model C box
        "-fill", ORANGE, "-draw", "roundrectangle 300,560 580,640 15,15",
        "-fill", BG_COLOR, "-pointsize", "24",
        "-gravity", "NorthWest", "-annotate", "+380+585", "Model C",
        # Arrows from models to calibration
        "-fill", GRAY, "-pointsize", "36",
        "-gravity", "NorthWest",
        "-annotate", "+600+365", "->",
        "-annotate", "+600+475", "->",
        "-annotate", "+600+585", "->",
        # Calibration Engine box (larger, centered)
        "-fill", GOLD, "-draw", "roundrectangle 700,420 1020,550 15,15",
        "-fill", BG_COLOR, "-pointsize", "22",
        "-gravity", "NorthWest", "-annotate", "+730+465", "Calibration",
        "-annotate", "+755+495", "Engine",
        # Arrow to trade signal
        "-fill", GRAY, "-pointsize", "36",
        "-gravity", "NorthWest", "-annotate", "+1040+465", "->",
        # Trade Signal box
        "-fill", GREEN, "-draw", "roundrectangle 1140,440 1420,530 15,15",
        "-fill", BG_COLOR, "-pointsize", "24",
        "-gravity", "NorthWest", "-annotate", "+1170+470", "TRADE SIGNAL",
        # Footnotes
        "-gravity", "North",
        "-fill", GRAY, "-pointsize", "26",
        "-annotate", "+0+740", "Claims 80% confidence but wins 50%? Recalibrated to 50%.",
        "-fill", TEAL, "-pointsize", "28",
        "-annotate", "+0+790", "I learn who to trust.",
        output_path,
    ]
    return _run_convert(cmd, output_path)


def generate_closing_slide(output_path: str) -> bool:
    """End card with logo, vault address, URLs, sponsors."""
    cmd = [
        "convert",
        "-size", "1920x1080",
        f"xc:{BG_COLOR}",
        "-font", FONT,
        # Logo
        "-pointsize", "96", "-fill", TEAL,
        "-gravity", "North", "-annotate", "+0+260", "DarwinFi",
        # Showcase URL
        "-pointsize", "36", "-fill", WHITE,
        "-annotate", "+0+400", "darwinfi.corduroycloud.com",
        # Vault address
        "-pointsize", "28", "-fill", GRAY,
        "-annotate", "+0+480", "Vault: 0x4a55DEEC24C6b5c1aa6301b43b4D9680c10491d7",
        # Built with
        "-pointsize", "28", "-fill", GRAY,
        "-annotate", "+0+600", "Built with",
        "-pointsize", "32", "-fill", TEAL,
        "-annotate", "+0+660", "Base  |  Uniswap V3  |  Lit Protocol  |  Venice AI  |  Storacha  |  ENS  |  Claude Code",
        output_path,
    ]
    return _run_convert(cmd, output_path)


def _run_convert(cmd: list, output_path: str) -> bool:
    """Run ImageMagick convert with font fallback."""
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # Try fallback font
        cmd_fallback = [
            FONT_FALLBACK if arg == FONT else arg
            for arg in cmd
        ]
        result = subprocess.run(cmd_fallback, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"  ERROR: {result.stderr.strip()[:200]}")
            return False

    size_kb = os.path.getsize(output_path) / 1024
    name = os.path.basename(output_path)
    print(f"  {name} ({size_kb:.1f} KB)")
    return True


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Check ImageMagick is available
    try:
        subprocess.run(["convert", "--version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("ERROR: ImageMagick 'convert' not found. Install with: sudo apt install imagemagick")
        sys.exit(1)

    print("Generating infographic slides (1920x1080)...\n")

    generators = {
        "tournament": generate_tournament_slide,
        "evolution": generate_evolution_slide,
        "instinct": generate_instinct_slide,
        "closing": generate_closing_slide,
    }

    generated = []
    for name, gen_fn in generators.items():
        output_path = os.path.join(OUTPUT_DIR, f"{name}.png")
        if gen_fn(output_path):
            generated.append((name, output_path))

    print(f"\nGenerated {len(generated)}/{len(generators)} slides in: {OUTPUT_DIR}")

    # Convert to video clips with appropriate durations
    print("\nConverting to video clips...")
    clips_dir = os.path.join(OUTPUT_DIR, "clips")
    os.makedirs(clips_dir, exist_ok=True)

    for name, png_path in generated:
        duration = DURATIONS.get(name, 3)
        clip_path = os.path.join(clips_dir, f"{name}.mp4")
        cmd = [
            "ffmpeg", "-y",
            "-loop", "1",
            "-i", png_path,
            "-c:v", "libx264",
            "-t", str(duration),
            "-pix_fmt", "yuv420p",
            "-vf", "scale=1920:1080",
            "-r", "30",
            clip_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            size_kb = os.path.getsize(clip_path) / 1024
            print(f"  {name}.mp4 ({duration}s, {size_kb:.1f} KB)")
        else:
            print(f"  ERROR creating {name}.mp4: {result.stderr[:200]}")

    print(f"\nVideo clips in: {clips_dir}")


if __name__ == "__main__":
    main()

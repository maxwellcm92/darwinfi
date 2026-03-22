#!/usr/bin/env bash
#
# DarwinFi 30-Second Rough Draft Video
# Self-contained: TTS + title cards + screen recording + compositing
#
# Requires: ELEVENLABS_API_KEY env var, ffmpeg, ImageMagick, Node.js + Playwright
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WORK_DIR="$PROJECT_DIR/demo-output/rough-draft"
DAPP_URL="https://corduroycloud.com/darwinfi/"
STATIC_DIR="/opt/n8n/static"
FINAL_NAME="darwinfi-rough-draft.mp4"

# Narration text (~420 chars, Scene 1 from demo-script.md)
NARRATION="Good evening. I'm DarwinFi -- a self-evolving financial organism living on Base L2. I have sixteen competing trading strategies. The weakest die so the strongest can trade with real capital. Think of it as natural selection, but for money. Everything I do serves one rule: increase profits and win rate. I call it the Golden Rule."

echo "============================================"
echo "  DarwinFi - 30s Rough Draft Generator"
echo "============================================"
echo ""

# --- Preflight ---
if [ -z "${ELEVENLABS_API_KEY:-}" ]; then
    echo "ERROR: ELEVENLABS_API_KEY not set"
    exit 1
fi
command -v ffmpeg >/dev/null 2>&1 || { echo "ERROR: ffmpeg not found"; exit 1; }
command -v convert >/dev/null 2>&1 || { echo "ERROR: ImageMagick not found"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: node not found"; exit 1; }
echo "Dependencies: OK"
echo ""

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

# =============================================
# STEP 1: Generate TTS narration via ElevenLabs
# =============================================
echo "--- Step 1/6: Generating TTS narration ---"

# Resolve Daniel voice ID
VOICE_ID=$(curl -s "https://api.elevenlabs.io/v1/voices" \
    -H "xi-api-key: $ELEVENLABS_API_KEY" \
    | python3 -c "
import sys, json
data = json.load(sys.stdin)
for v in data.get('voices', []):
    if v['name'].lower().startswith('daniel'):
        print(v['voice_id'])
        break
")

if [ -z "$VOICE_ID" ]; then
    echo "ERROR: Could not find Daniel voice"
    exit 1
fi
echo "  Voice ID: $VOICE_ID"

# Generate audio
NARRATION_MP3="$WORK_DIR/narration.mp3"
export NARRATION_TEXT="$NARRATION"
PAYLOAD=$(python3 -c "
import json, os
print(json.dumps({
    'text': os.environ['NARRATION_TEXT'],
    'model_id': 'eleven_multilingual_v2',
    'voice_settings': {
        'stability': 0.6,
        'similarity_boost': 0.8,
        'style': 0.4,
        'use_speaker_boost': True
    }
}))
")

curl -s "https://api.elevenlabs.io/v1/text-to-speech/$VOICE_ID" \
    -H "xi-api-key: $ELEVENLABS_API_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept: audio/mpeg" \
    -d "$PAYLOAD" \
    -o "$NARRATION_MP3"

NARRATION_SIZE=$(du -h "$NARRATION_MP3" | cut -f1)
NARRATION_DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$NARRATION_MP3" 2>/dev/null)
echo "  Narration: $NARRATION_SIZE (${NARRATION_DURATION}s)"
echo ""

# =============================================
# STEP 2: Generate title cards via ImageMagick
# =============================================
echo "--- Step 2/6: Generating title cards ---"

OPENING_PNG="$WORK_DIR/opening.png"
CLOSING_PNG="$WORK_DIR/closing.png"

# Opening: "DarwinFi / A self-evolving financial organism"
convert -size 1920x1080 "xc:#0a0a0a" \
    -font "DejaVu-Sans-Bold" \
    -pointsize 120 -fill "#14b8a6" -gravity North -annotate +0+380 "DarwinFi" \
    -pointsize 42 -fill "#f0f0f0" -gravity North -annotate +0+530 "A self-evolving financial organism" \
    -pointsize 28 -fill "#888888" -gravity North -annotate +0+610 "Survival of the fittest, on-chain." \
    "$OPENING_PNG"
echo "  opening.png"

# Closing: vault address + URL + sponsors
convert -size 1920x1080 "xc:#0a0a0a" \
    -font "DejaVu-Sans-Bold" \
    -pointsize 96 -fill "#14b8a6" -gravity North -annotate +0+300 "DarwinFi" \
    -pointsize 24 -fill "#888888" -gravity North -annotate +0+440 "Vault: 0x4a55DEEC24C6b5c1aa6301b43b4D9680c10491d7" \
    -pointsize 32 -fill "#f0f0f0" -gravity North -annotate +0+510 "https://corduroycloud.com/darwinfi/" \
    -pointsize 24 -fill "#888888" -gravity North -annotate +0+620 "Built with" \
    -pointsize 28 -fill "#14b8a6" -gravity North -annotate +0+670 "Base | Uniswap V3 | Lit Protocol | Venice AI | Claude Code" \
    "$CLOSING_PNG"
echo "  closing.png"
echo ""

# =============================================
# STEP 3: Convert title cards to 3s video clips
# =============================================
echo "--- Step 3/6: Converting title cards to video ---"

OPENING_MP4="$WORK_DIR/opening.mp4"
CLOSING_MP4="$WORK_DIR/closing.mp4"

ffmpeg -y -loop 1 -i "$OPENING_PNG" \
    -c:v libx264 -t 3 -pix_fmt yuv420p -vf "scale=1920:1080" -r 30 \
    "$OPENING_MP4" 2>/dev/null
echo "  opening.mp4 (3s)"

ffmpeg -y -loop 1 -i "$CLOSING_PNG" \
    -c:v libx264 -t 3 -pix_fmt yuv420p -vf "scale=1920:1080" -r 30 \
    "$CLOSING_MP4" 2>/dev/null
echo "  closing.mp4 (3s)"
echo ""

# =============================================
# STEP 4: Screen-record DApp via Playwright
# =============================================
echo "--- Step 4/6: Recording DApp screens ---"

RECORDER_JS="$WORK_DIR/recorder.cjs"
cat > "$RECORDER_JS" << 'PLAYWRIGHT_SCRIPT'
const { chromium } = require("/opt/murphy/_system/browser-automation/node_modules/playwright");
const { mkdirSync } = require("fs");
const { join } = require("path");

const WORK_DIR = process.argv[2];
const DAPP_URL = "https://corduroycloud.com/darwinfi/";
const VP = { width: 1920, height: 1080 };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function recordScene(browser, name, url, scrollSteps) {
    const videoDir = join(WORK_DIR, "vid-" + name);
    mkdirSync(videoDir, { recursive: true });

    const context = await browser.newContext({
        viewport: VP,
        recordVideo: { dir: videoDir, size: VP },
        colorScheme: "dark",
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await sleep(3000);

    for (const [y, waitMs] of scrollSteps) {
        await page.evaluate((scrollY) => {
            window.scrollTo({ top: scrollY, behavior: "smooth" });
        }, y);
        await sleep(waitMs);
    }

    const videoPath = await page.video().path();
    await context.close();
    console.log("  " + name + ": " + videoPath);
    return videoPath;
}

(async () => {
    const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
        // Scene: Dashboard (~12s) - hero, scroll through vault stats
        await recordScene(browser, "dashboard", DAPP_URL, [
            [0, 3000],      // stay at top, show hero
            [400, 3000],    // scroll to vault stats
            [800, 3000],    // scroll further
        ]);

        // Scene: Instinct (~12s) - predictions and signals
        await recordScene(browser, "instinct", DAPP_URL + "advanced?tab=instinct", [
            [0, 3000],      // show predictions header
            [400, 3000],    // scroll through signals
            [800, 3000],    // more content
        ]);
    } finally {
        await browser.close();
    }
    console.log("  Recordings complete.");
})();
PLAYWRIGHT_SCRIPT

cd "$PROJECT_DIR"
node "$RECORDER_JS" "$WORK_DIR"
echo ""

# Find and convert the webm recordings to mp4
echo "--- Step 5/6: Normalizing and concatenating ---"

DASHBOARD_WEBM=$(find "$WORK_DIR/vid-dashboard" -name "*.webm" | head -1)
INSTINCT_WEBM=$(find "$WORK_DIR/vid-instinct" -name "*.webm" | head -1)

if [ -z "$DASHBOARD_WEBM" ] || [ -z "$INSTINCT_WEBM" ]; then
    echo "ERROR: Screen recordings not found"
    ls -la "$WORK_DIR/vid-dashboard/" "$WORK_DIR/vid-instinct/" 2>/dev/null
    exit 1
fi

DASHBOARD_MP4="$WORK_DIR/dashboard.mp4"
INSTINCT_MP4="$WORK_DIR/instinct.mp4"

# Normalize all clips: 1920x1080 h264 yuv420p 30fps, trim recordings to ~12s
ffmpeg -y -i "$DASHBOARD_WEBM" \
    -c:v libx264 -preset fast -crf 20 \
    -pix_fmt yuv420p -r 30 \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black" \
    -t 12 -an \
    "$DASHBOARD_MP4" 2>/dev/null
echo "  dashboard.mp4 (12s)"

ffmpeg -y -i "$INSTINCT_WEBM" \
    -c:v libx264 -preset fast -crf 20 \
    -pix_fmt yuv420p -r 30 \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black" \
    -t 12 -an \
    "$INSTINCT_MP4" 2>/dev/null
echo "  instinct.mp4 (12s)"

# Re-normalize title cards (ensure matching params for concat)
NORM_OPENING="$WORK_DIR/norm-opening.mp4"
NORM_CLOSING="$WORK_DIR/norm-closing.mp4"

ffmpeg -y -i "$OPENING_MP4" \
    -c:v libx264 -preset fast -crf 20 \
    -pix_fmt yuv420p -r 30 -an \
    "$NORM_OPENING" 2>/dev/null

ffmpeg -y -i "$CLOSING_MP4" \
    -c:v libx264 -preset fast -crf 20 \
    -pix_fmt yuv420p -r 30 -an \
    "$NORM_CLOSING" 2>/dev/null

# Build concat list: opening (3s) + dashboard (12s) + instinct (12s) + closing (3s) = ~30s
CONCAT_LIST="$WORK_DIR/concat.txt"
cat > "$CONCAT_LIST" << EOF
file '$(realpath "$NORM_OPENING")'
file '$(realpath "$DASHBOARD_MP4")'
file '$(realpath "$INSTINCT_MP4")'
file '$(realpath "$NORM_CLOSING")'
EOF

CONCAT_VIDEO="$WORK_DIR/concat-video.mp4"
ffmpeg -y -f concat -safe 0 -i "$CONCAT_LIST" \
    -c:v libx264 -preset fast -crf 20 \
    -pix_fmt yuv420p -r 30 \
    "$CONCAT_VIDEO" 2>/dev/null
echo "  Concatenated video ready"
echo ""

# =============================================
# STEP 6: Overlay narration audio
# =============================================
echo "--- Step 6/6: Overlaying narration ---"

FINAL_VIDEO="$WORK_DIR/$FINAL_NAME"

# Narration starts immediately (over the opening title card)
ffmpeg -y \
    -i "$CONCAT_VIDEO" \
    -i "$NARRATION_MP3" \
    -map 0:v:0 -map 1:a:0 \
    -c:v copy \
    -c:a aac -b:a 192k \
    -shortest \
    "$FINAL_VIDEO" 2>/dev/null

# Copy to static serving directory
cp "$FINAL_VIDEO" "$STATIC_DIR/$FINAL_NAME"

echo ""
echo "============================================"
echo "  Rough Draft Complete"
echo "============================================"
FINAL_SIZE=$(du -h "$FINAL_VIDEO" | cut -f1)
FINAL_DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$FINAL_VIDEO" 2>/dev/null | cut -d. -f1)
echo "  File: $FINAL_VIDEO"
echo "  Size: $FINAL_SIZE"
echo "  Duration: ${FINAL_DURATION}s"
echo ""
echo "  Download: https://corduroycloud.com/murphy-static/$FINAL_NAME"
echo ""

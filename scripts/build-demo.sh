#!/usr/bin/env bash
#
# DarwinFi Demo Video - Full Build Pipeline
# Orchestrates: narration -> screen recording -> title cards -> compositing
#
# Usage:
#   ./build-demo.sh              # Run full pipeline
#   ./build-demo.sh --skip-tts   # Skip narration (use existing audio)
#   ./build-demo.sh --skip-record # Skip screen recording (use existing recordings)
#   ./build-demo.sh --slides-only # Only generate title cards
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_DIR/demo-output"

SKIP_TTS=false
SKIP_RECORD=false
SLIDES_ONLY=false

for arg in "$@"; do
    case "$arg" in
        --skip-tts) SKIP_TTS=true ;;
        --skip-record) SKIP_RECORD=true ;;
        --slides-only) SLIDES_ONLY=true ;;
        --help|-h)
            echo "Usage: $0 [--skip-tts] [--skip-record] [--slides-only]"
            exit 0
            ;;
    esac
done

echo "============================================"
echo "  DarwinFi Demo Video - Build Pipeline"
echo "============================================"
echo ""
echo "Output directory: $OUTPUT_DIR"
echo "Skip TTS: $SKIP_TTS"
echo "Skip recording: $SKIP_RECORD"
echo ""

mkdir -p "$OUTPUT_DIR"

# --- Step 1: Check dependencies ---
echo "--- Checking dependencies ---"
command -v ffmpeg >/dev/null 2>&1 || { echo "ERROR: ffmpeg not found"; exit 1; }
command -v convert >/dev/null 2>&1 || { echo "ERROR: ImageMagick not found"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not found"; exit 1; }
echo "  ffmpeg: OK"
echo "  ImageMagick: OK"
echo "  python3: OK"

if [ "$SKIP_TTS" = false ] && [ "$SLIDES_ONLY" = false ]; then
    if [ -z "${ELEVENLABS_API_KEY:-}" ]; then
        echo ""
        echo "WARNING: ELEVENLABS_API_KEY not set."
        echo "  Set it with: export ELEVENLABS_API_KEY=your_key_here"
        echo "  Or run with --skip-tts to use existing audio files."
        echo ""
        read -p "Continue without TTS? (y/N) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
        SKIP_TTS=true
    fi
fi

if [ "$SKIP_RECORD" = false ] && [ "$SLIDES_ONLY" = false ]; then
    command -v npx >/dev/null 2>&1 || { echo "ERROR: npx not found (need Node.js)"; exit 1; }
    echo "  Node.js/npx: OK"
fi

echo ""

# --- Step 2: Generate narration ---
if [ "$SKIP_TTS" = false ] && [ "$SLIDES_ONLY" = false ]; then
    echo "============================================"
    echo "  Step 1/4: Generating Voice Narration"
    echo "============================================"
    python3 "$SCRIPT_DIR/generate-narration.py"
    echo ""
else
    echo "--- Skipping TTS (--skip-tts or no API key) ---"
    echo ""
fi

# --- Step 3: Record screen ---
if [ "$SKIP_RECORD" = false ] && [ "$SLIDES_ONLY" = false ]; then
    echo "============================================"
    echo "  Step 2/4: Recording Screen Demos"
    echo "============================================"
    cd "$PROJECT_DIR"
    npx ts-node "$SCRIPT_DIR/record-demo.ts"
    cd "$SCRIPT_DIR"
    echo ""
else
    echo "--- Skipping screen recording ---"
    echo ""
fi

# --- Step 4: Generate title cards ---
echo "============================================"
echo "  Step 3/4: Generating Title Cards"
echo "============================================"
python3 "$SCRIPT_DIR/generate-slides.py"
echo ""

if [ "$SLIDES_ONLY" = true ]; then
    echo "--- Slides only mode, stopping here ---"
    exit 0
fi

# --- Step 5: Compose final video ---
echo "============================================"
echo "  Step 4/4: Compositing Final Video"
echo "============================================"
bash "$SCRIPT_DIR/compose-video.sh"
echo ""

echo "============================================"
echo "  Pipeline Complete"
echo "============================================"
echo ""
echo "Final video: $OUTPUT_DIR/darwinfi-demo.mp4"
echo ""
echo "Next steps:"
echo "  1. Review the video: mpv $OUTPUT_DIR/darwinfi-demo.mp4"
echo "  2. Upload to YouTube (unlisted)"
echo "  3. Embed in Devfolio submission"

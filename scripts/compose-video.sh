#!/usr/bin/env bash
#
# DarwinFi Demo Video Compositor
# Combines title cards, screen recordings, and narration into final demo video.
# Requires: ffmpeg
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$SCRIPT_DIR/../demo-output"
SLIDES_DIR="$BASE_DIR/slides/clips"
RECORDINGS_DIR="$BASE_DIR/recordings"
AUDIO_DIR="$BASE_DIR/audio"
OUTPUT="$BASE_DIR/darwinfi-demo.mp4"
CONCAT_LIST="$BASE_DIR/concat-list.txt"

echo "=== DarwinFi Demo Video Compositor ==="
echo "Base dir: $BASE_DIR"
echo ""

# Verify required files exist
check_file() {
    if [ ! -f "$1" ]; then
        echo "ERROR: Missing required file: $1"
        echo "  Run the prerequisite script first."
        exit 1
    fi
}

# --- Step 1: Verify all inputs ---
echo "Checking inputs..."

# Title card clips
check_file "$SLIDES_DIR/opening.mp4"
check_file "$SLIDES_DIR/scene-vault.mp4"
check_file "$SLIDES_DIR/scene-trading.mp4"
check_file "$SLIDES_DIR/scene-evolution.mp4"
check_file "$SLIDES_DIR/closing.mp4"

# Screen recordings (convert webm to mp4 if needed)
for scene in intro vault trading tournament outro; do
    src="$RECORDINGS_DIR/$scene.webm"
    dst="$RECORDINGS_DIR/$scene.mp4"
    if [ -f "$src" ] && [ ! -f "$dst" ]; then
        echo "  Converting $scene.webm -> mp4..."
        ffmpeg -y -i "$src" \
            -c:v libx264 -preset fast -crf 20 \
            -pix_fmt yuv420p -r 30 \
            -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black" \
            "$dst" 2>/dev/null
    fi
    check_file "$dst"
done

# Audio
check_file "$AUDIO_DIR/full-narration.mp3"

echo "  All inputs verified."
echo ""

# --- Step 2: Normalize all video clips to consistent format ---
echo "Normalizing video clips..."
NORM_DIR="$BASE_DIR/normalized"
mkdir -p "$NORM_DIR"

normalize_clip() {
    local input="$1"
    local output="$2"
    ffmpeg -y -i "$input" \
        -c:v libx264 -preset fast -crf 20 \
        -pix_fmt yuv420p -r 30 \
        -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black" \
        -an \
        "$output" 2>/dev/null
    echo "  $(basename "$output")"
}

# Normalize all clips
normalize_clip "$SLIDES_DIR/opening.mp4" "$NORM_DIR/01-opening.mp4"
normalize_clip "$RECORDINGS_DIR/intro.mp4" "$NORM_DIR/02-intro.mp4"
normalize_clip "$SLIDES_DIR/scene-vault.mp4" "$NORM_DIR/03-vault-title.mp4"
normalize_clip "$RECORDINGS_DIR/vault.mp4" "$NORM_DIR/04-vault.mp4"
normalize_clip "$SLIDES_DIR/scene-trading.mp4" "$NORM_DIR/05-trading-title.mp4"
normalize_clip "$RECORDINGS_DIR/trading.mp4" "$NORM_DIR/06-trading.mp4"
normalize_clip "$SLIDES_DIR/scene-evolution.mp4" "$NORM_DIR/07-evolution-title.mp4"
normalize_clip "$RECORDINGS_DIR/tournament.mp4" "$NORM_DIR/08-tournament.mp4"
normalize_clip "$RECORDINGS_DIR/outro.mp4" "$NORM_DIR/09-outro.mp4"
normalize_clip "$SLIDES_DIR/closing.mp4" "$NORM_DIR/10-closing.mp4"

echo ""

# --- Step 3: Build concat list ---
echo "Building concat list..."
> "$CONCAT_LIST"
for clip in "$NORM_DIR"/*.mp4; do
    echo "file '$(realpath "$clip")'" >> "$CONCAT_LIST"
done
echo "  $(wc -l < "$CONCAT_LIST") clips in sequence"
echo ""

# --- Step 4: Concatenate all video clips ---
echo "Concatenating video..."
CONCAT_VIDEO="$BASE_DIR/concat-video.mp4"
ffmpeg -y -f concat -safe 0 -i "$CONCAT_LIST" \
    -c:v libx264 -preset fast -crf 20 \
    -pix_fmt yuv420p -r 30 \
    "$CONCAT_VIDEO" 2>/dev/null
echo "  Concatenated: $(du -h "$CONCAT_VIDEO" | cut -f1)"
echo ""

# --- Step 5: Overlay narration audio ---
echo "Overlaying narration audio..."
ffmpeg -y \
    -i "$CONCAT_VIDEO" \
    -i "$AUDIO_DIR/full-narration.mp3" \
    -c:v copy \
    -c:a aac -b:a 192k \
    -map 0:v:0 -map 1:a:0 \
    -shortest \
    "$OUTPUT" 2>/dev/null

echo ""
echo "=== Build Complete ==="
OUTPUT_SIZE=$(du -h "$OUTPUT" | cut -f1)
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUTPUT" 2>/dev/null | cut -d. -f1)
echo "  Output: $OUTPUT"
echo "  Size: $OUTPUT_SIZE"
echo "  Duration: ${DURATION}s"
echo ""
echo "Play with: mpv '$OUTPUT'"
echo "Upload to YouTube (unlisted) for Devfolio submission."

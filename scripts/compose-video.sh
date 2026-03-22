#!/usr/bin/env bash
#
# DarwinFi Demo Video Compositor
# Combines Maxwell's intro, title cards, screen recordings, and narration
# into final demo video.
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

# Maxwell's intro clip (recorded separately by Maxwell)
MAXWELL_INTRO="$BASE_DIR/maxwell-intro.mp4"

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

# Maxwell's intro (optional -- compositor works without it)
HAS_MAXWELL_INTRO=false
if [ -f "$MAXWELL_INTRO" ]; then
    HAS_MAXWELL_INTRO=true
    echo "  Maxwell's intro: found"
else
    echo "  Maxwell's intro: NOT FOUND (will skip -- add maxwell-intro.mp4 to demo-output/)"
fi

# Title card clips
check_file "$SLIDES_DIR/opening.mp4"
check_file "$SLIDES_DIR/scene-vault.mp4"
check_file "$SLIDES_DIR/scene-trading.mp4"
check_file "$SLIDES_DIR/scene-evolution.mp4"
check_file "$SLIDES_DIR/closing.mp4"

# Screen recordings (convert webm to mp4 if needed)
for scene in dashboard vault instinct tournament closing; do
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

# Normalize all clips in scene order
# Sequence:
#   00 - Maxwell intro (optional)
#   01 - Opening title card ("DarwinFi")
#   02 - Dashboard recording
#   03 - Vault title card ("The Vault")
#   04 - Vault recording
#   05 - Trading title card ("Live Trading")
#   06 - Instinct recording
#   07 - Evolution title card ("Tournament & Evolution")
#   08 - Tournament recording
#   09 - Closing recording
#   10 - Closing title card

CLIP_INDEX=0

if [ "$HAS_MAXWELL_INTRO" = true ]; then
    normalize_clip "$MAXWELL_INTRO" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-maxwell-intro.mp4"
    CLIP_INDEX=$((CLIP_INDEX + 1))
fi

normalize_clip "$SLIDES_DIR/opening.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-opening.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

normalize_clip "$RECORDINGS_DIR/dashboard.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-dashboard.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

normalize_clip "$SLIDES_DIR/scene-vault.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-vault-title.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

normalize_clip "$RECORDINGS_DIR/vault.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-vault.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

normalize_clip "$SLIDES_DIR/scene-trading.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-trading-title.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

normalize_clip "$RECORDINGS_DIR/instinct.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-instinct.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

normalize_clip "$SLIDES_DIR/scene-evolution.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-evolution-title.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

normalize_clip "$RECORDINGS_DIR/tournament.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-tournament.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

normalize_clip "$RECORDINGS_DIR/closing.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-closing.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

normalize_clip "$SLIDES_DIR/closing.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-closing-title.mp4"

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
# Darwin's narration starts AFTER Maxwell's intro.
# If Maxwell's intro exists, we delay the narration by the intro's duration.
echo "Overlaying narration audio..."

if [ "$HAS_MAXWELL_INTRO" = true ]; then
    # Get Maxwell intro duration to offset Darwin's narration
    INTRO_DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MAXWELL_INTRO" 2>/dev/null)
    # Add 3 seconds for the opening title card
    NARRATION_DELAY=$(echo "$INTRO_DURATION + 3" | bc)
    echo "  Maxwell intro: ${INTRO_DURATION}s -> narration delay: ${NARRATION_DELAY}s"

    ffmpeg -y \
        -i "$CONCAT_VIDEO" \
        -i "$AUDIO_DIR/full-narration.mp3" \
        -filter_complex "[1:a]adelay=${NARRATION_DELAY}s|${NARRATION_DELAY}s[delayed_audio]" \
        -map 0:v:0 -map "[delayed_audio]" \
        -c:v copy \
        -c:a aac -b:a 192k \
        -shortest \
        "$OUTPUT" 2>/dev/null
else
    # No Maxwell intro -- narration starts after the opening title card (3s)
    ffmpeg -y \
        -i "$CONCAT_VIDEO" \
        -i "$AUDIO_DIR/full-narration.mp3" \
        -filter_complex "[1:a]adelay=3s|3s[delayed_audio]" \
        -map 0:v:0 -map "[delayed_audio]" \
        -c:v copy \
        -c:a aac -b:a 192k \
        -shortest \
        "$OUTPUT" 2>/dev/null
fi

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

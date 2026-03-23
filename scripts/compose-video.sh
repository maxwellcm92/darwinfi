#!/usr/bin/env bash
#
# DarwinFi Demo Video Compositor (v2)
# Combines Maxwell's intro + webcam DApp recording, Playwright screen recordings,
# infographic slides, and narration into final demo video.
#
# Clip order:
#   00 - Maxwell intro (webcam, ~20s)
#   01 - showcase_hero recording (Playwright)
#   02 - organism recording (Playwright)
#   03 - quick_scroll_chat recording (Playwright)
#   04 - maxwell-dapp recording (Maxwell screen-records with wallet connected)
#   05 - tournament infographic slide (20s)
#   06 - evolution infographic slide (20s)
#   07 - instinct infographic slide (15s)
#   08 - closing recording (Playwright)
#   09 - closing title card (3s)
#
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

# Maxwell's manually recorded clips
MAXWELL_INTRO="$BASE_DIR/maxwell-intro.mp4"
MAXWELL_DAPP="$BASE_DIR/maxwell-dapp.mp4"

echo "=== DarwinFi Demo Video Compositor (v2) ==="
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

# Maxwell's DApp recording (optional -- compositor works without it)
HAS_MAXWELL_DAPP=false
if [ -f "$MAXWELL_DAPP" ]; then
    HAS_MAXWELL_DAPP=true
    echo "  Maxwell's DApp recording: found"
else
    echo "  Maxwell's DApp recording: NOT FOUND (will skip -- add maxwell-dapp.mp4 to demo-output/)"
fi

# Infographic slide clips
check_file "$SLIDES_DIR/tournament.mp4"
check_file "$SLIDES_DIR/evolution.mp4"
check_file "$SLIDES_DIR/instinct.mp4"
check_file "$SLIDES_DIR/closing.mp4"

# Screen recordings (convert webm to mp4 if needed)
for scene in showcase_hero organism quick_scroll_chat closing; do
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

CLIP_INDEX=0

# 00 - Maxwell intro (optional)
if [ "$HAS_MAXWELL_INTRO" = true ]; then
    normalize_clip "$MAXWELL_INTRO" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-maxwell-intro.mp4"
    CLIP_INDEX=$((CLIP_INDEX + 1))
fi

# 01 - Showcase hero (Playwright)
normalize_clip "$RECORDINGS_DIR/showcase_hero.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-showcase-hero.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

# 02 - Organism diagram (Playwright)
normalize_clip "$RECORDINGS_DIR/organism.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-organism.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

# 03 - Quick scroll + chatbot (Playwright)
normalize_clip "$RECORDINGS_DIR/quick_scroll_chat.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-quick-scroll-chat.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

# 04 - Maxwell DApp recording (optional)
if [ "$HAS_MAXWELL_DAPP" = true ]; then
    normalize_clip "$MAXWELL_DAPP" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-maxwell-dapp.mp4"
    CLIP_INDEX=$((CLIP_INDEX + 1))
fi

# 05 - Tournament infographic (20s)
normalize_clip "$SLIDES_DIR/tournament.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-tournament.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

# 06 - Evolution infographic (20s)
normalize_clip "$SLIDES_DIR/evolution.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-evolution.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

# 07 - Instinct infographic (15s)
normalize_clip "$SLIDES_DIR/instinct.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-instinct.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

# 08 - Closing (Playwright)
normalize_clip "$RECORDINGS_DIR/closing.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-closing.mp4"
CLIP_INDEX=$((CLIP_INDEX + 1))

# 09 - Closing title card (3s)
normalize_clip "$SLIDES_DIR/closing.mp4" "$NORM_DIR/$(printf '%02d' $CLIP_INDEX)-closing-card.mp4"

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
    NARRATION_DELAY="$INTRO_DURATION"
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
    # No Maxwell intro -- narration starts immediately with showcase hero
    ffmpeg -y \
        -i "$CONCAT_VIDEO" \
        -i "$AUDIO_DIR/full-narration.mp3" \
        -map 0:v:0 -map 1:a:0 \
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

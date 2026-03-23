#!/usr/bin/env bash
#
# DarwinFi Demo Video Compositor (v3)
# Per-scene audio sync: each video clip is paired with its individual scene audio.
# No more single full-narration overlay -- each scene's narration starts and ends
# within its visual clip.
#
# Scene order:
#   0 - Maxwell intro (webcam, own audio)
#   1 - showcase_hero recording + showcase_hero.mp3
#   2 - organism recording + organism.mp3
#   3 - quick_scroll_chat recording + quick_scroll_chat.mp3
#   4 - maxwell-dapp recording + dashboard_pitch.mp3
#   5 - tournament slide + tournament.mp3
#   6 - evolution slide + evolution.mp3
#   7 - instinct slide + instinct.mp3
#   8 - closing recording + closing.mp3
#   9 - closing card (silence, 3s)
#
# Requires: ffmpeg, ffprobe
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$SCRIPT_DIR/../demo-output"
SLIDES_DIR="$BASE_DIR/slides/clips"
RECORDINGS_DIR="$BASE_DIR/recordings"
AUDIO_DIR="$BASE_DIR/audio"
OUTPUT="$BASE_DIR/darwinfi-demo.mp4"
SCENE_DIR="$BASE_DIR/scenes"
CONCAT_LIST="$BASE_DIR/concat-list.txt"

# Maxwell's manually recorded clips
MAXWELL_INTRO="$BASE_DIR/maxwell-intro.mp4"
MAXWELL_DAPP="$BASE_DIR/maxwell-dapp.mp4"

echo "=== DarwinFi Demo Video Compositor (v3 - Per-Scene Sync) ==="
echo "Base dir: $BASE_DIR"
echo ""

mkdir -p "$SCENE_DIR"

# --- Helper functions ---

get_duration() {
    ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null
}

check_file() {
    if [ ! -f "$1" ]; then
        echo "ERROR: Missing required file: $1"
        exit 1
    fi
}

# Normalize a video clip to 1920x1080@30fps, no audio
normalize_video() {
    local input="$1"
    local output="$2"
    local extra_vf="${3:-}"
    local vf="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black"
    if [ -n "$extra_vf" ]; then
        vf="${extra_vf},${vf}"
    fi
    ffmpeg -y -i "$input" \
        -c:v libx264 -preset fast -crf 20 \
        -pix_fmt yuv420p -r 30 \
        -vf "$vf" \
        -an \
        "$output" 2>/dev/null
}

# Merge a video clip with its scene audio.
# If audio is longer than video, pad video with freeze-frame.
# If video is longer than audio, video plays with silence after narration.
merge_scene() {
    local scene_name="$1"
    local video="$2"
    local audio="$3"
    local output="$SCENE_DIR/${scene_name}.mp4"

    local vid_dur audio_dur
    vid_dur=$(get_duration "$video")
    audio_dur=$(get_duration "$audio")

    echo "  $scene_name: video=${vid_dur}s audio=${audio_dur}s"

    # Compare durations (integer comparison for padding)
    local vid_int audio_int pad_needed
    vid_int=$(printf "%.0f" "$vid_dur")
    audio_int=$(printf "%.0f" "$audio_dur")

    if [ "$audio_int" -gt "$vid_int" ]; then
        # Audio longer: pad video with freeze-frame
        local pad_secs
        pad_secs=$(echo "$audio_dur - $vid_dur + 0.5" | bc)
        echo "    -> Padding video by ${pad_secs}s (freeze-frame)"
        ffmpeg -y -i "$video" -i "$audio" \
            -filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=${pad_secs}[vpad]" \
            -map "[vpad]" -map 1:a:0 \
            -c:v libx264 -preset fast -crf 20 \
            -c:a aac -b:a 192k \
            -shortest \
            "$output" 2>/dev/null
    else
        # Video longer or equal: merge directly, silence after narration
        ffmpeg -y -i "$video" -i "$audio" \
            -map 0:v:0 -map 1:a:0 \
            -c:v copy \
            -c:a aac -b:a 192k \
            -shortest \
            "$output" 2>/dev/null

        # If video is significantly longer, we want the full video with silence
        if [ "$vid_int" -gt "$((audio_int + 2))" ]; then
            # Re-merge allowing full video length with audio + silence padding
            ffmpeg -y -i "$video" -i "$audio" \
                -filter_complex "[1:a]apad=whole_dur=${vid_dur}[apad]" \
                -map 0:v:0 -map "[apad]" \
                -c:v copy \
                -c:a aac -b:a 192k \
                "$output" 2>/dev/null
        fi
    fi

    local out_dur
    out_dur=$(get_duration "$output")
    echo "    -> Output: ${out_dur}s"
}

# --- Step 1: Verify inputs ---
echo "Checking inputs..."

HAS_MAXWELL_INTRO=false
if [ -f "$MAXWELL_INTRO" ]; then
    HAS_MAXWELL_INTRO=true
    echo "  Maxwell intro: found ($(get_duration "$MAXWELL_INTRO")s)"
else
    echo "  Maxwell intro: NOT FOUND (skipping)"
fi

HAS_MAXWELL_DAPP=false
if [ -f "$MAXWELL_DAPP" ]; then
    HAS_MAXWELL_DAPP=true
    echo "  Maxwell DApp: found ($(get_duration "$MAXWELL_DAPP")s)"
else
    echo "  Maxwell DApp: NOT FOUND (skipping)"
fi

# Slide clips
check_file "$SLIDES_DIR/tournament.mp4"
check_file "$SLIDES_DIR/evolution.mp4"
check_file "$SLIDES_DIR/instinct.mp4"
check_file "$SLIDES_DIR/closing.mp4"

# Screen recordings (convert webm -> mp4 if needed)
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

# Scene audio files
for audio_scene in showcase_hero organism quick_scroll_chat dashboard_pitch tournament evolution instinct closing; do
    check_file "$AUDIO_DIR/$audio_scene.mp3"
done

echo "  All inputs verified."
echo ""

# --- Step 2: Normalize video clips ---
echo "Normalizing video clips..."
NORM_DIR="$BASE_DIR/normalized"
mkdir -p "$NORM_DIR"

if [ "$HAS_MAXWELL_INTRO" = true ]; then
    # Maxwell intro keeps its own audio
    ffmpeg -y -i "$MAXWELL_INTRO" \
        -c:v libx264 -preset fast -crf 20 \
        -pix_fmt yuv420p -r 30 \
        -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black" \
        -c:a aac -b:a 192k \
        "$NORM_DIR/maxwell-intro.mp4" 2>/dev/null
    echo "  maxwell-intro.mp4 (with audio)"
fi

normalize_video "$RECORDINGS_DIR/showcase_hero.mp4" "$NORM_DIR/showcase_hero.mp4"
echo "  showcase_hero.mp4"
normalize_video "$RECORDINGS_DIR/organism.mp4" "$NORM_DIR/organism.mp4"
echo "  organism.mp4"
normalize_video "$RECORDINGS_DIR/quick_scroll_chat.mp4" "$NORM_DIR/quick_scroll_chat.mp4"
echo "  quick_scroll_chat.mp4"

if [ "$HAS_MAXWELL_DAPP" = true ]; then
    normalize_video "$MAXWELL_DAPP" "$NORM_DIR/maxwell-dapp.mp4"
    echo "  maxwell-dapp.mp4"
fi

normalize_video "$SLIDES_DIR/tournament.mp4" "$NORM_DIR/tournament.mp4"
echo "  tournament.mp4"
normalize_video "$SLIDES_DIR/evolution.mp4" "$NORM_DIR/evolution.mp4"
echo "  evolution.mp4"
normalize_video "$SLIDES_DIR/instinct.mp4" "$NORM_DIR/instinct.mp4"
echo "  instinct.mp4"
normalize_video "$RECORDINGS_DIR/closing.mp4" "$NORM_DIR/closing.mp4"
echo "  closing.mp4"
normalize_video "$SLIDES_DIR/closing.mp4" "$NORM_DIR/closing-card.mp4"
echo "  closing-card.mp4"

echo ""

# --- Step 3: Merge each scene (video + audio) ---
echo "Merging scenes with per-scene audio..."
SCENE_INDEX=0

# Scene 0: Maxwell intro (own audio, no TTS)
if [ "$HAS_MAXWELL_INTRO" = true ]; then
    cp "$NORM_DIR/maxwell-intro.mp4" "$SCENE_DIR/00-maxwell-intro.mp4"
    echo "  00-maxwell-intro: $(get_duration "$SCENE_DIR/00-maxwell-intro.mp4")s (own audio)"
    SCENE_INDEX=1
fi

# Scene 1: showcase_hero + showcase_hero.mp3
merge_scene "$(printf '%02d' $SCENE_INDEX)-showcase-hero" "$NORM_DIR/showcase_hero.mp4" "$AUDIO_DIR/showcase_hero.mp3"
SCENE_INDEX=$((SCENE_INDEX + 1))

# Scene 2: organism + organism.mp3
merge_scene "$(printf '%02d' $SCENE_INDEX)-organism" "$NORM_DIR/organism.mp4" "$AUDIO_DIR/organism.mp3"
SCENE_INDEX=$((SCENE_INDEX + 1))

# Scene 3: quick_scroll_chat + quick_scroll_chat.mp3
merge_scene "$(printf '%02d' $SCENE_INDEX)-quick-scroll-chat" "$NORM_DIR/quick_scroll_chat.mp4" "$AUDIO_DIR/quick_scroll_chat.mp3"
SCENE_INDEX=$((SCENE_INDEX + 1))

# Scene 4: maxwell-dapp + dashboard_pitch.mp3
if [ "$HAS_MAXWELL_DAPP" = true ]; then
    merge_scene "$(printf '%02d' $SCENE_INDEX)-maxwell-dapp" "$NORM_DIR/maxwell-dapp.mp4" "$AUDIO_DIR/dashboard_pitch.mp3"
    SCENE_INDEX=$((SCENE_INDEX + 1))
fi

# Scene 5: tournament slide + tournament.mp3
merge_scene "$(printf '%02d' $SCENE_INDEX)-tournament" "$NORM_DIR/tournament.mp4" "$AUDIO_DIR/tournament.mp3"
SCENE_INDEX=$((SCENE_INDEX + 1))

# Scene 6: evolution slide + evolution.mp3
merge_scene "$(printf '%02d' $SCENE_INDEX)-evolution" "$NORM_DIR/evolution.mp4" "$AUDIO_DIR/evolution.mp3"
SCENE_INDEX=$((SCENE_INDEX + 1))

# Scene 7: instinct slide + instinct.mp3
merge_scene "$(printf '%02d' $SCENE_INDEX)-instinct" "$NORM_DIR/instinct.mp4" "$AUDIO_DIR/instinct.mp3"
SCENE_INDEX=$((SCENE_INDEX + 1))

# Scene 8: closing recording + closing.mp3
merge_scene "$(printf '%02d' $SCENE_INDEX)-closing" "$NORM_DIR/closing.mp4" "$AUDIO_DIR/closing.mp3"
SCENE_INDEX=$((SCENE_INDEX + 1))

# Scene 9: closing card (3s silence)
cp "$NORM_DIR/closing-card.mp4" "$SCENE_DIR/$(printf '%02d' $SCENE_INDEX)-closing-card.mp4"
echo "  $(printf '%02d' $SCENE_INDEX)-closing-card: 3s (silence)"

echo ""

# --- Step 4: Concatenate all scenes ---
echo "Building concat list..."
> "$CONCAT_LIST"
for clip in "$SCENE_DIR"/*.mp4; do
    echo "file '$(realpath "$clip")'" >> "$CONCAT_LIST"
done
echo "  $(wc -l < "$CONCAT_LIST") scenes in sequence"
echo ""

echo "Concatenating final video..."
ffmpeg -y -f concat -safe 0 -i "$CONCAT_LIST" \
    -c:v libx264 -preset fast -crf 20 \
    -pix_fmt yuv420p -r 30 \
    -c:a aac -b:a 192k \
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

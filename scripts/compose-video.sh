#!/usr/bin/env bash
#
# DarwinFi Demo Video Compositor (v4)
# Per-scene audio sync with composite scene 04 (slide + DApp recordings).
#
# Scene order:
#   0 - Maxwell intro (webcam, own audio)
#   1 - showcase_hero recording + showcase_hero.mp3
#   2 - organism recording + organism.mp3
#   3 - quick_scroll recording + quick_scroll_chat.mp3
#   4 - COMPOSITE: how_it_works slide (8s) + dapp_landing + dapp_results + dashboard_pitch.mp3
#       Fallback: how_it_works (8s) + live_stats (8s) + maxwell-dapp.mp4 (rest)
#   5 - tournament slide + tournament.mp3
#   6 - evolution slide + evolution.mp3
#   7 - instinct slide + instinct.mp3
#   8 - closing recording + closing.mp3
#   9 - closing card (silence, 5s)
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

echo "=== DarwinFi Demo Video Compositor (v4 - Composite Scenes) ==="
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
    local vid_int audio_int
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
    echo "  Maxwell DApp: NOT FOUND"
fi

# Check for DApp recordings (new in v4)
HAS_DAPP_LANDING=false
HAS_DAPP_RESULTS=false
for scene in dapp_landing dapp_results; do
    src="$RECORDINGS_DIR/$scene.webm"
    dst="$RECORDINGS_DIR/$scene.mp4"
    if [ -f "$src" ]; then
        if [ ! -f "$dst" ]; then
            echo "  Converting $scene.webm -> mp4..."
            ffmpeg -y -i "$src" \
                -c:v libx264 -preset fast -crf 20 \
                -pix_fmt yuv420p -r 30 \
                -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black" \
                "$dst" 2>/dev/null
        fi
        if [ "$scene" = "dapp_landing" ]; then HAS_DAPP_LANDING=true; fi
        if [ "$scene" = "dapp_results" ]; then HAS_DAPP_RESULTS=true; fi
        echo "  $scene: found ($(get_duration "$dst")s)"
    else
        echo "  $scene: NOT FOUND"
    fi
done

# Slide clips
check_file "$SLIDES_DIR/how_it_works.mp4"
check_file "$SLIDES_DIR/live_stats.mp4"
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

# DApp recordings
if [ "$HAS_DAPP_LANDING" = true ]; then
    normalize_video "$RECORDINGS_DIR/dapp_landing.mp4" "$NORM_DIR/dapp_landing.mp4"
    echo "  dapp_landing.mp4"
fi
if [ "$HAS_DAPP_RESULTS" = true ]; then
    normalize_video "$RECORDINGS_DIR/dapp_results.mp4" "$NORM_DIR/dapp_results.mp4"
    echo "  dapp_results.mp4"
fi
if [ "$HAS_MAXWELL_DAPP" = true ]; then
    normalize_video "$MAXWELL_DAPP" "$NORM_DIR/maxwell-dapp.mp4"
    echo "  maxwell-dapp.mp4"
fi

normalize_video "$SLIDES_DIR/how_it_works.mp4" "$NORM_DIR/how_it_works.mp4"
echo "  how_it_works.mp4"
normalize_video "$SLIDES_DIR/live_stats.mp4" "$NORM_DIR/live_stats.mp4"
echo "  live_stats.mp4"
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

# --- Step 3: Build composite scene 04 ---
# dashboard_pitch.mp3 is ~49s. We fill it with:
#   0-8s:   HOW IT WORKS slide
#   8-25s:  DApp landing page (stats, 3 steps)
#   25-49s: DApp Results page (leaderboard, trades, evolution)
# Fallback if no DApp recordings:
#   0-8s:   HOW IT WORKS slide
#   8-16s:  LIVE STATS slide
#   16-49s: maxwell-dapp.mp4

echo "Building composite scene 04 (dashboard_pitch)..."
COMPOSITE_DIR="$BASE_DIR/composite"
mkdir -p "$COMPOSITE_DIR"
DASHBOARD_AUDIO_DUR=$(get_duration "$AUDIO_DIR/dashboard_pitch.mp3")
DASHBOARD_AUDIO_INT=$(printf "%.0f" "$DASHBOARD_AUDIO_DUR")
echo "  dashboard_pitch.mp3: ${DASHBOARD_AUDIO_DUR}s"

if [ "$HAS_DAPP_LANDING" = true ] && [ "$HAS_DAPP_RESULTS" = true ]; then
    echo "  Using: how_it_works (8s) + dapp_landing + dapp_results"
    # Trim how_it_works to 8s (already 8s from slide gen, but ensure)
    ffmpeg -y -i "$NORM_DIR/how_it_works.mp4" -t 8 -c:v libx264 -preset fast -crf 20 -an "$COMPOSITE_DIR/part1.mp4" 2>/dev/null
    # Trim dapp_landing to 17s
    ffmpeg -y -i "$NORM_DIR/dapp_landing.mp4" -t 17 -c:v libx264 -preset fast -crf 20 -an "$COMPOSITE_DIR/part2.mp4" 2>/dev/null
    # dapp_results takes the rest (~24s)
    REMAINING=$((DASHBOARD_AUDIO_INT - 25))
    ffmpeg -y -i "$NORM_DIR/dapp_results.mp4" -t "$REMAINING" -c:v libx264 -preset fast -crf 20 -an "$COMPOSITE_DIR/part3.mp4" 2>/dev/null
else
    echo "  Fallback: how_it_works (8s) + live_stats (8s) + maxwell-dapp (rest)"
    ffmpeg -y -i "$NORM_DIR/how_it_works.mp4" -t 8 -c:v libx264 -preset fast -crf 20 -an "$COMPOSITE_DIR/part1.mp4" 2>/dev/null
    ffmpeg -y -i "$NORM_DIR/live_stats.mp4" -t 8 -c:v libx264 -preset fast -crf 20 -an "$COMPOSITE_DIR/part2.mp4" 2>/dev/null
    if [ "$HAS_MAXWELL_DAPP" = true ]; then
        REMAINING=$((DASHBOARD_AUDIO_INT - 16))
        ffmpeg -y -i "$NORM_DIR/maxwell-dapp.mp4" -t "$REMAINING" -c:v libx264 -preset fast -crf 20 -an "$COMPOSITE_DIR/part3.mp4" 2>/dev/null
    else
        # No DApp recording at all -- extend live_stats to fill
        REMAINING=$((DASHBOARD_AUDIO_INT - 8))
        ffmpeg -y -i "$NORM_DIR/live_stats.mp4" -t "$REMAINING" \
            -filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=$((REMAINING - 8))[vpad]" \
            -map "[vpad]" -c:v libx264 -preset fast -crf 20 -an "$COMPOSITE_DIR/part3.mp4" 2>/dev/null
    fi
fi

# Concatenate composite parts
COMP_LIST="$COMPOSITE_DIR/concat.txt"
> "$COMP_LIST"
for part in "$COMPOSITE_DIR"/part*.mp4; do
    echo "file '$(realpath "$part")'" >> "$COMP_LIST"
done

ffmpeg -y -f concat -safe 0 -i "$COMP_LIST" \
    -c:v libx264 -preset fast -crf 20 \
    -pix_fmt yuv420p -r 30 \
    -an \
    "$NORM_DIR/dashboard_composite.mp4" 2>/dev/null

echo "  Composite: $(get_duration "$NORM_DIR/dashboard_composite.mp4")s"
echo ""

# --- Step 4: Merge each scene (video + audio) ---
echo "Merging scenes with per-scene audio..."
# Clear old scene files
rm -f "$SCENE_DIR"/*.mp4

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

# Scene 4: dashboard composite + dashboard_pitch.mp3
merge_scene "$(printf '%02d' $SCENE_INDEX)-dashboard" "$NORM_DIR/dashboard_composite.mp4" "$AUDIO_DIR/dashboard_pitch.mp3"
SCENE_INDEX=$((SCENE_INDEX + 1))

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

# Scene 9: closing card (5s silence)
# Add silent audio track so concat doesn't fail on audio stream mismatch
ffmpeg -y -i "$NORM_DIR/closing-card.mp4" \
    -f lavfi -i anullsrc=r=44100:cl=stereo \
    -map 0:v:0 -map 1:a:0 \
    -c:v copy -c:a aac -b:a 192k \
    -shortest \
    "$SCENE_DIR/$(printf '%02d' $SCENE_INDEX)-closing-card.mp4" 2>/dev/null
echo "  $(printf '%02d' $SCENE_INDEX)-closing-card: 5s (silence)"

echo ""

# --- Step 5: Concatenate all scenes ---
echo "Building concat list..."
> "$CONCAT_LIST"
for clip in "$SCENE_DIR"/*.mp4; do
    echo "file '$(realpath "$clip")'" >> "$CONCAT_LIST"
done
echo "  $(wc -l < "$CONCAT_LIST") scenes in sequence"
cat "$CONCAT_LIST"
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

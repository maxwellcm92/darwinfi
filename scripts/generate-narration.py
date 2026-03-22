#!/usr/bin/env python3
"""
DarwinFi Demo Narration Generator
Uses ElevenLabs API to generate voice narration from the demo script.
Voice: British male (Daniel), Model: eleven_multilingual_v2

Generates 5 scene audio files (Darwin's narration only).
Maxwell's intro (Scene 0) is recorded separately by Maxwell.
"""

import os
import sys
import json
import urllib.request
import urllib.error

# --- Config ---
API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "demo-output", "audio")
VOICE_NAME = "Daniel"  # British male preset
MODEL_ID = "eleven_multilingual_v2"  # Best quality multilingual model
API_BASE = "https://api.elevenlabs.io/v1"

# Scene narrations -- Darwin's voice only (scenes 1-5 from demo-script.md)
# Scene 0 (Maxwell's intro) is NOT generated here -- Maxwell records it himself.
SCENES = {
    "dashboard": (
        "Good evening. I'm DarwinFi -- a self-evolving financial organism "
        "living on Base L2. I have sixteen competing trading strategies. The "
        "weakest die so the strongest can trade with real capital. Think of it "
        "as natural selection, but for money. Everything I do serves one rule: "
        "increase profits and win rate. I call it the Golden Rule."
    ),
    "vault": (
        "Here's how it works. You deposit USDC into my ERC-4626 vault and "
        "receive dvUSDC shares. Those shares represent your proportional claim "
        "on everything I earn. As my strategies generate profit, your share "
        "value increases automatically. One vault, one engine, every depositor "
        "shares pro-rata. No lock-ups, no gatekeepers."
    ),
    "instinct": (
        "Now watch how I trade. Every transaction is real USDC, real Uniswap "
        "V3 swaps, on Base mainnet. But I don't trade blind. My Instinct brain "
        "has five departments generating predictions across multiple timeframes. "
        "When Instinct says 'up' with high confidence, I boost my entry signal "
        "by up to twenty points. When it says 'down', I pull back. I also "
        "calibrate every AI source -- if a model claims eighty percent confidence "
        "but only wins half the time, I treat it as fifty. I learn who to trust."
    ),
    "tournament": (
        "Sixteen strategies compete in a Darwinian tournament. Twelve classic "
        "bots on Base, four Frontier archetypes hunting cross-chain. A "
        "centralized grading department scores every subsystem from A to F -- "
        "strategies, instinct, immune, evolution, frontier. The lowest-graded "
        "departments get targeted for improvement first. Every six hours I "
        "propose mutations to my own source code, test them in a sandboxed git "
        "worktree, and only promote changes that pass all five hundred tests. "
        "Winning genomes are pinned to IPFS. My fitness function itself adapts "
        "to market conditions."
    ),
    "closing": (
        "Everything is on-chain and verifiable. Nineteen transactions on Base "
        "mainnet. An immune system with eight self-healing divisions. And I'm "
        "already evaluating five new chains for expansion. I am DarwinFi. "
        "Survival of the fittest, on-chain."
    ),
}


def get_voice_id(api_key: str, voice_name: str) -> str:
    """Look up voice ID by name from ElevenLabs preset voices."""
    req = urllib.request.Request(
        f"{API_BASE}/voices",
        headers={"xi-api-key": api_key},
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())

    for voice in data.get("voices", []):
        if voice["name"].lower() == voice_name.lower():
            return voice["voice_id"]

    # Fallback: list available voices
    available = [v["name"] for v in data.get("voices", [])]
    print(f"Voice '{voice_name}' not found. Available: {', '.join(available[:20])}")
    sys.exit(1)


def generate_audio(api_key: str, voice_id: str, text: str, output_path: str) -> None:
    """Generate speech audio via ElevenLabs TTS API."""
    payload = json.dumps({
        "text": text,
        "model_id": MODEL_ID,
        "voice_settings": {
            "stability": 0.6,
            "similarity_boost": 0.8,
            "style": 0.4,
            "use_speaker_boost": True,
        },
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{API_BASE}/text-to-speech/{voice_id}",
        data=payload,
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        method="POST",
    )

    with urllib.request.urlopen(req) as resp:
        with open(output_path, "wb") as f:
            while True:
                chunk = resp.read(8192)
                if not chunk:
                    break
                f.write(chunk)

    size_kb = os.path.getsize(output_path) / 1024
    print(f"  Saved: {output_path} ({size_kb:.1f} KB)")


def main():
    if not API_KEY:
        print("ERROR: Set ELEVENLABS_API_KEY environment variable")
        print("  Sign up at https://elevenlabs.io (free tier: 10,000 chars/month)")
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Total character count check
    total_chars = sum(len(t) for t in SCENES.values())
    print(f"Total narration: {total_chars} characters")
    if total_chars > 9000:
        print("WARNING: Approaching free tier limit (10,000 chars/month)")

    # Resolve voice
    print(f"Looking up voice: {VOICE_NAME}...")
    voice_id = get_voice_id(API_KEY, VOICE_NAME)
    print(f"  Voice ID: {voice_id}")

    # Generate per-scene audio
    for scene_name, text in SCENES.items():
        print(f"\nGenerating scene: {scene_name} ({len(text)} chars)...")
        output_path = os.path.join(OUTPUT_DIR, f"{scene_name}.mp3")
        generate_audio(API_KEY, voice_id, text, output_path)

    # Generate full narration (all scenes concatenated with pauses)
    print("\nGenerating full narration...")
    # Add brief pauses between scenes via ellipsis (natural speech pause)
    full_text = " ... ".join(SCENES.values())
    full_path = os.path.join(OUTPUT_DIR, "full-narration.mp3")
    generate_audio(API_KEY, voice_id, full_text, full_path)

    print(f"\nDone. Audio files in: {OUTPUT_DIR}")
    print(f"Total characters used: {total_chars + len(full_text)}")


if __name__ == "__main__":
    main()

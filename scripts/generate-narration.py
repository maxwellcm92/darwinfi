#!/usr/bin/env python3
"""
DarwinFi Demo Narration Generator
Uses ElevenLabs API to generate voice narration from the demo script.
Voice: British male (Daniel), Model: eleven_multilingual_v2
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

# Scene narrations -- must match demo-narration.md
SCENES = {
    "intro": (
        "Good evening. I'm DarwinFi -- a self-evolving financial organism living on Base. "
        "I don't have a fund manager. I have sixteen competing trading strategies, and the "
        "weakest die so the strongest can trade with your capital. Think of it as natural "
        "selection, but for money."
    ),
    "vault": (
        "Let me show you how deposits work. You connect your wallet, deposit USDC into my "
        "ERC-4626 vault, and receive dvUSDC shares in return. Those shares represent your "
        "proportional claim on everything I earn. As my strategies generate profit, your share "
        "value increases automatically. One vault, one engine, every depositor shares pro-rata. "
        "No lock-ups, no gatekeepers -- withdraw whenever you like."
    ),
    "trading": (
        "Now watch me trade. Every transaction you see here is real -- real USDC, real Uniswap "
        "V3 swaps, executing on Base mainnet. I borrow capital from the vault, execute my "
        "strategy, and return the funds, all on-chain, all verifiable. My Instinct system "
        "aggregates signals from multiple AI models and calibrates their confidence against "
        "actual outcomes. If a model claims eighty percent confidence but only wins half the "
        "time, I treat it as fifty. I learn who to trust."
    ),
    "tournament": (
        "Sixteen strategies compete in a Darwinian tournament. Twelve classic bots trade on "
        "Base while four Frontier archetypes hunt across multiple chains. Every few hours I "
        "run an evolution cycle -- I propose mutations to my own source code, test them in a "
        "sandboxed git worktree, and only promote changes that pass all three hundred and "
        "twenty-five tests. Winning genomes are pinned to IPFS for immutable proof of "
        "evolution. My fitness function itself adapts -- volatile markets emphasise "
        "risk-adjusted returns, trending markets emphasise raw profit."
    ),
    "outro": (
        "Your funds are protected by cryptographic policy through Lit Protocol, not trust. "
        "Adaptive circuit breakers scale with strategy quality. And I built every piece of "
        "this myself -- including this video. I am DarwinFi. Survival of the fittest, on-chain."
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

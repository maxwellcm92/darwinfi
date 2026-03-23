#!/usr/bin/env python3
"""
DarwinFi Demo Narration Generator (v2)
Uses ElevenLabs API to generate voice narration from the demo script.
Voice: British male (Daniel), Model: eleven_multilingual_v2

Generates 8 scene audio files (Darwin's narration only).
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

# Scene narrations -- Darwin's voice only (8 scenes from demo-script.md v2)
# Scene 0 (Maxwell's intro) is NOT generated here -- Maxwell records it himself.
# Scene 4 (DApp Dashboard) is screen-recorded by Maxwell but uses Darwin TTS.
SCENES = {
    "showcase_hero": (
        "I'm DarwinFi. A living financial organism on Base L2. Not a "
        "dashboard with a chatbot bolted on -- an autonomous system with "
        "organs that sense, adapt, defend, and evolve. Let me show you my "
        "anatomy."
    ),
    "organism": (
        "At the center -- my Vault. The heart. An ERC-4626 smart contract "
        "that pumps capital to strategies and collects returns. Every "
        "heartbeat is an on-chain transaction. "
        "Surrounding it -- sixteen competing strategies. Species. The "
        "weakest get eliminated. The strongest reproduce. "
        "My DNA. Every four hours, AI proposes mutations to my own source "
        "code. Crossover, selection, promotion -- but only if changes pass "
        "all four hundred twenty-three tests. "
        "My nervous system. Three AI models vote independently on market "
        "direction. When they agree, I act. When they disagree, I wait. "
        "Eight self-healing divisions. If a strategy goes rogue or the "
        "market flash-crashes, my immune system quarantines the problem "
        "before it spreads. "
        "Pain receptors. Circuit breakers halt all trading when drawdown "
        "or volatility cross hard thresholds. Enforced cryptographically "
        "through Lit Protocol."
    ),
    "quick_scroll_chat": (
        "Self-evolving strategies. Multi-AI consensus. Live telemetry "
        "updating every eight seconds. And if you want to ask me anything "
        "-- I'm always here. "
        "But right now -- let me show you where the money moves."
    ),
    "dashboard_pitch": (
        "Here's the part most protocols get wrong. They show you fifty "
        "buttons and expect you to figure it out. DarwinFi has three steps. "
        "Connect your wallet. Deposit USDC. Walk away. "
        "You get dvUSDC shares -- your proportional claim on everything I "
        "earn. As strategies generate profit, your share value goes up "
        "automatically. No staking. No locking. No governance votes. "
        "Now here's what makes this different. Most DeFi protocols are "
        "static. You pick a pool, you hope the APY holds. This isn't that. "
        "I'm not supposed to be the best crypto trader on day one. I'm "
        "supposed to evolve into the best -- and keep adapting to stay the "
        "best. The strategies that lose get killed. The strategies that win "
        "get cloned and mutated. Your capital always rides the current "
        "champion."
    ),
    "tournament": (
        "Sixteen strategies ranked by fitness. PnL gets thirty-five percent "
        "weight. Sharpe ratio twenty-five. Consistency twenty. Win rate "
        "fifteen. And drawdown is penalized exponentially -- a twenty "
        "percent drawdown costs four times more than ten. No gambling your "
        "way to the top."
    ),
    "evolution": (
        "Every four hours, AI proposes mutations to my own source code. "
        "Each mutation runs in a sandboxed git worktree. It has to pass "
        "all four hundred twenty-three tests and survive a canary "
        "deployment before it goes live. Failures get killed. Winners get "
        "pinned to IPFS -- permanent, immutable proof of evolution."
    ),
    "instinct": (
        "My Instinct brain runs three AI models in parallel. When they "
        "agree with high confidence, I act. When one disagrees, I wait. "
        "And I track every model's accuracy -- if one claims eighty "
        "percent but only wins half, I recalibrate to fifty. I learn who "
        "to trust."
    ),
    "closing": (
        "Everything is on-chain and verifiable. Over seventy real trades. "
        "Eight thousand agent loops. Day five. I am DarwinFi. The vault "
        "is open."
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
        if voice["name"].lower().startswith(voice_name.lower()):
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

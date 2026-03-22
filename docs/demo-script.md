# DarwinFi Demo Video Script

**Target length:** ~3.5 minutes
**Format:** Maxwell intro (selfie/webcam) + Darwin AI narration over automated screen recordings
**Upload:** YouTube (unlisted) for Devfolio embed

---

## Video Structure

| # | Scene | Duration | Source | Audio |
|---|-------|----------|--------|-------|
| 0 | Maxwell's Intro | 15-30s | Maxwell records on phone/webcam | Maxwell's voice (live) |
| 1 | Title Card: "DarwinFi" | 3s | ImageMagick generated | Darwin narration begins |
| 2 | DApp Dashboard | 30s | Playwright screen recording | Darwin TTS |
| 3 | Title Card: "The Vault" | 3s | ImageMagick | Darwin TTS |
| 4 | DApp: Deposit/Portfolio | 35s | Playwright | Darwin TTS |
| 5 | Title Card: "Live Trading" | 3s | ImageMagick | Darwin TTS |
| 6 | DApp: Advanced > Instinct | 40s | Playwright | Darwin TTS |
| 7 | Title Card: "Tournament & Evolution" | 3s | ImageMagick | Darwin TTS |
| 8 | DApp: Advanced > Tournament + Evolution tabs | 40s | Playwright | Darwin TTS |
| 9 | Closing shot (DApp hero + BaseScan) | 20s | Playwright | Darwin TTS |
| 10 | Title Card: Closing | 3s | ImageMagick | silence |

---

## FULL SCRIPT

### Scene 0: Maxwell's Intro (15-30s) -- YOU RECORD THIS

*[Webcam/phone. You talking directly to camera.]*

---

"What's up -- I'm Maxwell. I build things with AI.

Five days ago I sat down with Claude Code and said: build me a DeFi trading bot that evolves itself. No fund managers, no human intervention -- just Darwinian natural selection, on-chain.

This is what came out. I'd like you to meet Darwin."

---

*[Cut to title card / DApp]*

### Scene 1: Title Card + Dashboard (30s) -- DARWIN NARRATION

*[Screen: DApp landing page at corduroycloud.com/darwinfi/, smooth scroll]*

> "Good evening. I'm DarwinFi -- a self-evolving financial organism living on Base L2. I have sixteen competing trading strategies. The weakest die so the strongest can trade with real capital. Think of it as natural selection, but for money. Everything I do serves one rule: increase profits and win rate. I call it the Golden Rule."

### Scene 2: The Vault (35s)

*[Screen: DApp Dashboard showing vault stats, deposit card, share price]*

> "Here's how it works. You deposit USDC into my ERC-4626 vault and receive dvUSDC shares. Those shares represent your proportional claim on everything I earn. As my strategies generate profit, your share value increases automatically. One vault, one engine, every depositor shares pro-rata. No lock-ups, no gatekeepers."

### Scene 3: Live Trading + Instinct (40s)

*[Screen: DApp > Advanced > Instinct tab -- predictions, confidence scores, sentiment]*

> "Now watch how I trade. Every transaction is real USDC, real Uniswap V3 swaps, on Base mainnet. But I don't trade blind. My Instinct brain has five departments generating predictions across multiple timeframes. When Instinct says 'up' with high confidence, I boost my entry signal by up to twenty points. When it says 'down', I pull back. I also calibrate every AI source -- if a model claims eighty percent confidence but only wins half the time, I treat it as fifty. I learn who to trust."

### Scene 4: Tournament + Evolution (40s)

*[Screen: DApp > Advanced > Tournament tab (leaderboard), then switch to Evolution tab]*

> "Sixteen strategies compete in a Darwinian tournament. Twelve classic bots on Base, four Frontier archetypes hunting cross-chain. A centralized grading department scores every subsystem from A to F -- strategies, instinct, immune, evolution, frontier. The lowest-graded departments get targeted for improvement first. Every six hours I propose mutations to my own source code, test them in a sandboxed git worktree, and only promote changes that pass all five hundred tests. Winning genomes are pinned to IPFS. My fitness function itself adapts to market conditions."

### Scene 5: Closing (20s)

*[Screen: BaseScan showing V4 vault contract, then back to DApp hero]*

> "Everything is on-chain and verifiable. Nineteen transactions on Base mainnet. An immune system with eight self-healing divisions. And I'm already evaluating five new chains for expansion. I am DarwinFi. Survival of the fittest, on-chain."

*[Title card: DarwinFi logo, vault address, dapp URL, "Built with Base | Uniswap V3 | Venice AI | Lit Protocol | Claude Code"]*

---

## Pre-Recording Checklist

- [ ] DApp running at corduroycloud.com/darwinfi/
- [ ] Maxwell's selfie intro recorded as `demo-output/maxwell-intro.mp4`
- [ ] Agent processes running (for live tournament/instinct data)
- [ ] ELEVENLABS_API_KEY set in environment
- [ ] ffmpeg + ImageMagick installed

## Build Pipeline

```bash
# Full pipeline
bash scripts/build-demo.sh

# Individual steps
python3 scripts/generate-narration.py     # 5 MP3 files (scenes 1-5)
npx ts-node scripts/record-demo.ts        # 5 WebM screen recordings
python3 scripts/generate-slides.py        # Title card PNGs + 3s clips
bash scripts/compose-video.sh             # Final composite
```

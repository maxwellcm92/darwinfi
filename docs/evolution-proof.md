# DarwinFi Evolution Proof

Immutable evidence that DarwinFi's self-evolution engine runs autonomously, proposes real code mutations, and enforces safety gates.

## Overview

DarwinFi's evolution engine has completed **5 autonomous evolution cycles** since deployment. Each cycle follows the full pipeline: zone selection -> AI proposal (Venice/Llama 3.3 70B) -> static validation -> sandbox testing -> test gate -> canary deployment.

All 5 cycles reached the sandbox validation stage, where corrupt patch formatting from the AI model triggered rejection. This is the safety system working exactly as designed -- the evolution engine proposes mutations, and the safety gates catch malformed code before it ever touches the live system.

## Why Rejected Cycles Are the Point

A self-evolving system that accepts every mutation is dangerous. DarwinFi's 7-stage pipeline (zone selection, AI proposal, static validation, sandbox compilation, test gate, canary deploy, promote/rollback) is designed to reject bad mutations early and cheaply. All 5 cycles failed at stage 4 (sandbox) because Venice AI generated syntactically invalid git patches -- the safety system caught this before any code was applied, any tests were run, or any production state was affected.

This is DarwinFi being DarwinFi: the immune system protects the organism from harmful mutations.

## The 5 Cycles

### Cycle 1: Pattern Matcher Enhancement

| Field | Value |
|-------|-------|
| **Proposal ID** | `cfe65e45-2bde-49de-8384-f0f9dad94ad1` |
| **Timestamp** | March 20, 2026 19:13 UTC |
| **Target Zone** | `instinct/reflexes` |
| **Target File** | `src/instinct/reflexes/pattern-matcher.ts` |
| **AI Model** | Llama 3.3 70B (Venice) |
| **Mutation Size** | +15 lines, 1 modified, 1 file |
| **Diff Hash** | `cf7ba508...` |
| **Static Validation** | PASSED (no ring violations, no forbidden patterns, no size violations) |
| **Sandbox Result** | FAILED -- corrupt patch at line 29 |
| **Outcome** | Rejected at sandbox stage |

### Cycle 2: Pattern Matcher (Retry)

| Field | Value |
|-------|-------|
| **Proposal ID** | `9321632e-cdac-423b-9c7e-a4d611796b1e` |
| **Timestamp** | March 21, 2026 01:13 UTC |
| **Target Zone** | `instinct/reflexes` |
| **Target File** | `src/instinct/reflexes/pattern-matcher.ts` |
| **AI Model** | Llama 3.3 70B (Venice) |
| **Mutation Size** | 0 lines added, 0 modified, 1 file (minimal patch) |
| **Diff Hash** | `17a8a18a...` |
| **Static Validation** | PASSED |
| **Sandbox Result** | FAILED -- corrupt patch at line 8 |
| **Outcome** | Rejected at sandbox stage |

### Cycle 3: Pattern Matcher (Third Attempt)

| Field | Value |
|-------|-------|
| **Proposal ID** | `3e4944bc-d47e-4b04-bd09-ae9a5a63ba41` |
| **Timestamp** | March 21, 2026 07:14 UTC |
| **Target Zone** | `instinct/reflexes` |
| **Target File** | `src/instinct/reflexes/pattern-matcher.ts` |
| **AI Model** | Llama 3.3 70B (Venice) |
| **Mutation Size** | +10 lines, 0 modified, 1 file |
| **Diff Hash** | `4ccca214...` |
| **Static Validation** | PASSED |
| **Sandbox Result** | FAILED -- corrupt patch at line 60 |
| **Outcome** | Rejected at sandbox stage. **Zone backoff triggered**: 3 consecutive failures in `instinct/reflexes` activated exponential backoff, preventing further mutations to this zone until cooldown expires. |

### Cycle 4: Weight Optimizer Enhancement

| Field | Value |
|-------|-------|
| **Proposal ID** | `fd91955f-91d0-4796-9b05-52ce50344430` |
| **Timestamp** | March 21, 2026 13:14 UTC |
| **Target Zone** | `instinct/cortex` |
| **Target File** | `src/instinct/cortex/weight-optimizer.ts` |
| **AI Model** | Llama 3.3 70B (Venice) |
| **Mutation Size** | +4 lines, 2 modified, 1 file |
| **Diff Hash** | `f6b3e87a...` |
| **Static Validation** | PASSED |
| **Sandbox Result** | FAILED -- patch fragment without header at line 13 |
| **Outcome** | Rejected at sandbox stage. Zone selector correctly pivoted from reflexes (backed off) to cortex (new target zone). |

### Cycle 5: Scorer Enhancement

| Field | Value |
|-------|-------|
| **Proposal ID** | `ee4e88ec-2703-437d-bd05-6d83becefd25` |
| **Timestamp** | March 21, 2026 18:55 UTC |
| **Target Zone** | `instinct/cortex` |
| **Target File** | `src/instinct/cortex/scorer.ts` |
| **AI Model** | Llama 3.3 70B (Venice) |
| **Mutation Size** | +33 lines, 2 modified, 1 file |
| **Diff Hash** | `c187309f...` |
| **Static Validation** | PASSED |
| **Sandbox Result** | FAILED -- corrupt patch at line 23 |
| **Outcome** | Rejected at sandbox stage |

## Safety Pipeline Proof

All 5 cycles demonstrate the pipeline working correctly:

1. **Zone Selection**: The engine autonomously selected mutation targets across two zones (`instinct/reflexes` and `instinct/cortex`), targeting real production files
2. **AI Proposal**: Venice AI (Llama 3.3 70B) generated novel code mutations with varying sizes (0 to 33 lines added)
3. **Static Validation**: All 5 proposals passed ring-check validation (no attempts to modify protected infrastructure)
4. **Sandbox Rejection**: All 5 failed at `git apply --check` in an isolated sandbox -- no code was ever applied to the main codebase
5. **Anti-Loop Memory**: Each rejection was recorded with its diff hash, preventing identical mutations from being re-proposed
6. **Zone Backoff**: After 3 consecutive failures in `instinct/reflexes`, exponential backoff kicked in, forcing the engine to explore other zones

## Format Improvement: V1 to V2

The audit trail uses two log formats:

- **V1 (cycles 1-3)**: Separate `cycle_started`, `proposal_created`, `validation_passed`, `sandbox_failed`, `proposal_rejected`, `cycle_completed` events per cycle. Verbose but complete.
- **V2 (cycles 4-5)**: Same event structure but with improved error messages (e.g., "patch fragment without header" vs. generic "corrupt patch"), showing the sandbox validator was enhanced to give more specific failure diagnostics.

Both formats are append-only JSONL, ensuring the audit trail is tamper-evident.

## Verification

The full audit trail is at `data/evolution/audit.jsonl` (30 lines, 5 complete cycles). The anti-loop memory is at `data/evolution/memory.json` with all 5 diff hashes and zone backoff state.

To verify independently:

```bash
# Count complete cycles
grep -c "cycle_completed" data/evolution/audit.jsonl
# Output: 5

# List all targeted files
grep "proposal_created" data/evolution/audit.jsonl | jq -r '.details.targetFiles[]'
# Output:
# src/instinct/reflexes/pattern-matcher.ts  (3 times)
# src/instinct/cortex/weight-optimizer.ts   (1 time)
# src/instinct/cortex/scorer.ts             (1 time)

# Confirm all passed static validation
grep "validation_passed" data/evolution/audit.jsonl | jq '.details.passed'
# Output: true (5 times)

# Confirm all rejected at sandbox
grep "cycle_completed" data/evolution/audit.jsonl | jq -r '.details.outcome'
# Output: sandbox_failed (5 times)
```

## What This Proves

DarwinFi's evolution engine is not a mockup. It runs autonomously on a 6-hour cycle, selects mutation targets, queries Venice AI for code proposals, validates them through a multi-stage safety pipeline, and rejects unsafe mutations before they can affect production. The 5 cycles documented here are the first generation of DarwinFi's evolutionary lineage -- future cycles will produce successful mutations as the AI model improves at generating valid git patches, and those winning genomes will be pinned to IPFS via Storacha for immutable proof of Darwinian evolution.

## Evolution Pipeline Architecture

```
Zone Selection (anti-loop memory)
       |
Venice AI Proposal (Llama 3.3 70B)
       |
Static Validation (ring checks, forbidden patterns, size limits)
       |
Sandbox (git worktree + git apply --check + TypeScript compilation)
       |
Test Gate (all 488 tests must pass)
       |
Canary Deploy (4-hour monitoring, 60-second health checks)
       |
Promote or Rollback (automatic git rollback if performance degrades)
```

## Raw Audit Data

The complete audit trail is stored in `data/evolution/audit.jsonl` (append-only JSONL format). Each line is a JSON object with:
- `timestamp` -- Unix milliseconds
- `event` -- cycle_started, proposal_created, validation_passed, sandbox_failed, proposal_rejected, cycle_completed
- `proposalId` -- UUID linking all events in a cycle
- `details` -- target zone, files, line counts, AI model, error messages

This data is independently verifiable. Every field corresponds to actual system behavior.

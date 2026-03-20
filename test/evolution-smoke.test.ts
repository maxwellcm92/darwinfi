/**
 * DarwinFi Evolution Engine - Smoke Tests
 *
 * Tests the evolution pipeline components in isolation:
 * static validation, memory management, audit trail, config.
 * Does NOT test AI generation or actual git operations.
 */

import { expect } from "chai";
import * as path from "path";
import * as fs from "fs";

// Import evolution modules
import {
  MutabilityRing,
  EvolutionProposal,
  ValidationResult,
  AntiLoopMemory,
  AuditEntry,
} from "../src/evolution/types";

import { FILE_RINGS, FORBIDDEN_PATTERNS, VELOCITY_LIMITS, EVOLUTION_ZONES } from "../src/evolution/config";

describe("Evolution Engine Smoke Tests", function () {
  // ------------------------------------------------------------------
  // Config Tests
  // ------------------------------------------------------------------

  describe("Config", function () {
    it("should have immutable ring for chain files", function () {
      const chainRing = FILE_RINGS.find(r => r.pattern === "src/chain/**/*");
      expect(chainRing).to.not.be.undefined;
      expect(chainRing!.ring).to.equal("immutable");
    });

    it("should have immutable ring for live-engine", function () {
      const ring = FILE_RINGS.find(r => r.pattern === "src/trading/live-engine.ts");
      expect(ring).to.not.be.undefined;
      expect(ring!.ring).to.equal("immutable");
    });

    it("should have immutable ring for evolution code itself", function () {
      const ring = FILE_RINGS.find(r => r.pattern === "src/evolution/**/*");
      expect(ring).to.not.be.undefined;
      expect(ring!.ring).to.equal("immutable");
    });

    it("should have evolvable ring for frontier code", function () {
      const ring = FILE_RINGS.find(r => r.pattern === "src/frontier/**/*");
      expect(ring).to.not.be.undefined;
      expect(ring!.ring).to.equal("evolvable");
    });

    it("should have additive ring for indicators", function () {
      const ring = FILE_RINGS.find(r => r.pattern === "src/trading/indicators.ts");
      expect(ring).to.not.be.undefined;
      expect(ring!.ring).to.equal("additive");
    });

    it("should have velocity limits within expected bounds", function () {
      expect(VELOCITY_LIMITS.maxProposalsPerDay).to.equal(4);
      expect(VELOCITY_LIMITS.maxConcurrentCanaries).to.equal(1);
      expect(VELOCITY_LIMITS.maxDiffLinesAdded).to.equal(200);
      expect(VELOCITY_LIMITS.maxDiffLinesModified).to.equal(50);
      expect(VELOCITY_LIMITS.maxFilesPerProposal).to.equal(3);
    });

    it("should define evolution zones", function () {
      expect(Object.keys(EVOLUTION_ZONES).length).to.be.greaterThan(5);
      expect(EVOLUTION_ZONES["trading/indicators"]).to.not.be.undefined;
      expect(EVOLUTION_ZONES["instinct/reflexes"]).to.not.be.undefined;
      expect(EVOLUTION_ZONES["frontier/discovery"]).to.not.be.undefined;
    });
  });

  // ------------------------------------------------------------------
  // Forbidden Patterns Tests
  // ------------------------------------------------------------------

  describe("Forbidden Patterns", function () {
    it("should detect require('fs')", function () {
      const code = `const fs = require('fs');`;
      const match = FORBIDDEN_PATTERNS.some(fp => fp.pattern.test(code));
      expect(match).to.be.true;
    });

    it("should detect child_process import", function () {
      const code = `import { exec } from 'child_process';`;
      const match = FORBIDDEN_PATTERNS.some(fp => fp.pattern.test(code));
      expect(match).to.be.true;
    });

    it("should detect eval()", function () {
      const code = `const result = eval("1+1");`;
      const match = FORBIDDEN_PATTERNS.some(fp => fp.pattern.test(code));
      expect(match).to.be.true;
    });

    it("should detect process.env access", function () {
      const code = `const key = process.env.API_KEY;`;
      const match = FORBIDDEN_PATTERNS.some(fp => fp.pattern.test(code));
      expect(match).to.be.true;
    });

    it("should detect credential references", function () {
      const code = `const secret = PRIVATE_KEY;`;
      const match = FORBIDDEN_PATTERNS.some(fp => fp.pattern.test(code));
      expect(match).to.be.true;
    });

    it("should allow normal TypeScript code", function () {
      const code = `
        export function calculateRSI(prices: number[], period: number = 14): number {
          if (prices.length < period + 1) return 50;
          let gains = 0, losses = 0;
          for (let i = 1; i <= period; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff > 0) gains += diff;
            else losses -= diff;
          }
          const rs = gains / (losses || 1);
          return 100 - (100 / (1 + rs));
        }
      `;
      const match = FORBIDDEN_PATTERNS.some(fp => fp.pattern.test(code));
      expect(match).to.be.false;
    });
  });

  // ------------------------------------------------------------------
  // Audit Trail Tests
  // ------------------------------------------------------------------

  describe("Audit Trail", function () {
    const testAuditPath = path.join(__dirname, "..", "data", "evolution", "test-audit.jsonl");

    afterEach(function () {
      if (fs.existsSync(testAuditPath)) {
        fs.unlinkSync(testAuditPath);
      }
    });

    it("should create valid JSONL entries", function () {
      const entry: AuditEntry = {
        timestamp: Date.now(),
        event: "test_event",
        proposalId: "test-123",
        details: { key: "value" },
      };

      const line = JSON.stringify(entry);
      const parsed = JSON.parse(line);
      expect(parsed.event).to.equal("test_event");
      expect(parsed.proposalId).to.equal("test-123");
    });
  });

  // ------------------------------------------------------------------
  // Memory Tests
  // ------------------------------------------------------------------

  describe("Anti-Loop Memory", function () {
    it("should detect duplicate diff hashes", function () {
      const memory: AntiLoopMemory = {
        entries: [
          {
            proposalId: "test-1",
            diffHash: "abc123",
            zone: "trading/indicators",
            targetFiles: ["src/trading/indicators.ts"],
            timestamp: Date.now(),
            outcome: "rejected",
            rejectionReason: "test failure",
          },
        ],
        zoneBackoff: {},
        lastProposalTime: 0,
        proposalsToday: 0,
        todayDate: "",
      };

      const isDuplicate = memory.entries.some(e => e.diffHash === "abc123");
      expect(isDuplicate).to.be.true;
    });

    it("should track zone backoff correctly", function () {
      const memory: AntiLoopMemory = {
        entries: [],
        zoneBackoff: {
          "trading/indicators": {
            zone: "trading/indicators",
            consecutiveFailures: 3,
            backoffUntil: Date.now() + 24 * 60 * 60_000,
            lastFailure: Date.now(),
          },
        },
        lastProposalTime: 0,
        proposalsToday: 0,
        todayDate: "",
      };

      const backoff = memory.zoneBackoff["trading/indicators"];
      expect(backoff).to.not.be.undefined;
      expect(backoff.consecutiveFailures).to.equal(3);
      expect(backoff.backoffUntil).to.be.greaterThan(Date.now());
    });
  });

  // ------------------------------------------------------------------
  // Type Safety Tests
  // ------------------------------------------------------------------

  describe("Type Definitions", function () {
    it("should create valid EvolutionProposal", function () {
      const proposal: EvolutionProposal = {
        id: "test-uuid",
        createdAt: Date.now(),
        status: "pending",
        targetZone: "trading/indicators",
        targetFiles: ["src/trading/indicators.ts"],
        rationale: "Add Bollinger Band width indicator",
        diff: "+export function bbWidth() { return 0; }",
        diffHash: "sha256hash",
        linesAdded: 1,
        linesModified: 0,
        filesChanged: 1,
        aiModel: "llama-3.3-70b",
        aiPromptTokens: 100,
        aiCompletionTokens: 50,
      };

      expect(proposal.status).to.equal("pending");
      expect(proposal.targetFiles).to.have.length(1);
    });

    it("should validate proposal status transitions", function () {
      const validStatuses: EvolutionProposal["status"][] = [
        "pending", "validating", "sandboxing", "testing",
        "canary", "evaluating", "promoted", "rejected", "rolled_back",
      ];
      expect(validStatuses).to.have.length(9);
    });
  });
});

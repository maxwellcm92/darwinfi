/**
 * DarwinFi Immune System - Test Runner (Antibody)
 *
 * Runs `npx hardhat test` programmatically and parses the output
 * for pass/fail counts. Saves results to data/immune/antibody-results/.
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CheckResult } from '../types';
import { IMMUNE_FILES, PROJECT_ROOT } from '../config';

interface TestRunResult {
  timestamp: number;
  passing: number;
  failing: number;
  pending: number;
  durationMs: number;
  failures: string[];
  rawOutput: string;
}

function parseHardhatOutput(stdout: string, stderr: string): { passing: number; failing: number; pending: number; failures: string[] } {
  const combined = stdout + '\n' + stderr;

  // Mocha output format: "N passing", "N failing", "N pending"
  const passingMatch = combined.match(/(\d+)\s+passing/);
  const failingMatch = combined.match(/(\d+)\s+failing/);
  const pendingMatch = combined.match(/(\d+)\s+pending/);

  const passing = passingMatch ? parseInt(passingMatch[1], 10) : 0;
  const failing = failingMatch ? parseInt(failingMatch[1], 10) : 0;
  const pending = pendingMatch ? parseInt(pendingMatch[1], 10) : 0;

  // Extract failure descriptions (lines starting with numbers after "failing")
  const failures: string[] = [];
  const failureSection = combined.split(/\d+\s+failing/)[1];
  if (failureSection) {
    const failureLines = failureSection.match(/^\s+\d+\)\s+.+$/gm);
    if (failureLines) {
      for (const line of failureLines) {
        failures.push(line.trim());
      }
    }
  }

  return { passing, failing, pending, failures };
}

function saveResult(result: TestRunResult): void {
  try {
    const resultsDir = path.join(PROJECT_ROOT, IMMUNE_FILES.antibodyResults);
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const now = new Date();
    const filename = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
    ].join('-') + '.json';

    const filePath = path.join(resultsDir, filename);
    const { rawOutput, ...saveable } = result;
    fs.writeFileSync(filePath, JSON.stringify(saveable, null, 2));
  } catch (err) {
    console.error('[Immune:TestRunner] Failed to save test result:', err);
  }
}

export async function runHardhatTests(): Promise<CheckResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    exec('npx hardhat test', { cwd: PROJECT_ROOT, timeout: 120_000 }, (error, stdout, stderr) => {
      const durationMs = Date.now() - start;
      const { passing, failing, pending, failures } = parseHardhatOutput(stdout, stderr);

      const result: TestRunResult = {
        timestamp: Date.now(),
        passing,
        failing,
        pending,
        durationMs,
        failures,
        rawOutput: stdout + '\n' + stderr,
      };

      saveResult(result);

      if (error && passing === 0 && failing === 0) {
        // Hardhat itself failed to run (compilation error, config issue, etc.)
        resolve({
          checkId: 'antibody.test_runner',
          category: 'test',
          severity: 'error',
          message: `Hardhat test execution failed: ${error.message}`,
          details: {
            exitCode: error.code,
            stderr: stderr.slice(0, 1000),
            durationMs,
          },
          timestamp: Date.now(),
          durationMs,
        });
        return;
      }

      if (failing > 0) {
        resolve({
          checkId: 'antibody.test_runner',
          category: 'test',
          severity: 'error',
          message: `${failing} test(s) failing, ${passing} passing, ${pending} pending`,
          details: {
            passing,
            failing,
            pending,
            failures,
            durationMs,
          },
          timestamp: Date.now(),
          durationMs,
        });
        return;
      }

      resolve({
        checkId: 'antibody.test_runner',
        category: 'test',
        severity: 'ok',
        message: `All ${passing} tests passing (${pending} pending)`,
        details: {
          passing,
          failing: 0,
          pending,
          durationMs,
        },
        timestamp: Date.now(),
        durationMs,
      });
    });
  });
}

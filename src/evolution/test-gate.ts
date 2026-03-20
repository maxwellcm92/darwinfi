/**
 * DarwinFi Evolution Engine - Test Gate
 * Runs the test suite in a sandbox worktree to verify proposals.
 */

import { execSync } from 'child_process';
import { TestResult } from './types';

const TEST_TIMEOUT = 5 * 60_000; // 5 minutes

/**
 * Run `npx hardhat test` in the worktree directory and parse results.
 */
export async function runTests(worktreePath: string): Promise<TestResult> {
  const result: TestResult = {
    passed: false,
    totalTests: 0,
    passingTests: 0,
    failingTests: 0,
    pendingTests: 0,
    durationMs: 0,
    failures: [],
    output: '',
  };

  const startTime = Date.now();

  try {
    const output = execSync('npx hardhat test 2>&1', {
      cwd: worktreePath,
      timeout: TEST_TIMEOUT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    result.output = output;
    result.durationMs = Date.now() - startTime;

    // Parse mocha-style output
    const parsed = parseMochaOutput(output);
    result.totalTests = parsed.passing + parsed.failing + parsed.pending;
    result.passingTests = parsed.passing;
    result.failingTests = parsed.failing;
    result.pendingTests = parsed.pending;
    result.failures = parsed.failures;
    result.passed = parsed.failing === 0 && parsed.passing > 0;

    console.log(
      `[Evolution] Tests: ${result.passingTests} passing, ${result.failingTests} failing, ` +
      `${result.pendingTests} pending (${result.durationMs}ms)`,
    );
  } catch (err) {
    result.durationMs = Date.now() - startTime;
    const errOutput = err instanceof Error ? (err as any).stdout || (err as any).stderr || err.message : String(err);
    result.output = errOutput;

    // Parse even on failure (tests may have partially run)
    const parsed = parseMochaOutput(errOutput);
    result.totalTests = parsed.passing + parsed.failing + parsed.pending;
    result.passingTests = parsed.passing;
    result.failingTests = parsed.failing;
    result.pendingTests = parsed.pending;
    result.failures = parsed.failures;

    // If we got no test count at all, it was a compilation/setup failure
    if (result.totalTests === 0) {
      result.failures.push('Test setup failed: ' + errOutput.slice(0, 500));
    }

    console.error(
      `[Evolution] Tests failed: ${result.failingTests} failures (${result.durationMs}ms)`,
    );
  }

  return result;
}

interface MochaParsed {
  passing: number;
  failing: number;
  pending: number;
  failures: string[];
}

function parseMochaOutput(output: string): MochaParsed {
  const result: MochaParsed = { passing: 0, failing: 0, pending: 0, failures: [] };

  // Match "N passing"
  const passingMatch = output.match(/(\d+)\s+passing/);
  if (passingMatch) result.passing = parseInt(passingMatch[1], 10);

  // Match "N failing"
  const failingMatch = output.match(/(\d+)\s+failing/);
  if (failingMatch) result.failing = parseInt(failingMatch[1], 10);

  // Match "N pending"
  const pendingMatch = output.match(/(\d+)\s+pending/);
  if (pendingMatch) result.pending = parseInt(pendingMatch[1], 10);

  // Extract failure messages (lines between numbered failures)
  const failureSection = output.split(/\d+\s+failing/)[1];
  if (failureSection) {
    const failureLines = failureSection.split('\n');
    let currentFailure = '';

    for (const line of failureLines) {
      // New failure starts with a number followed by ")"
      const failureStart = line.match(/^\s*\d+\)\s+(.+)/);
      if (failureStart) {
        if (currentFailure) {
          result.failures.push(currentFailure.trim());
        }
        currentFailure = failureStart[1];
      } else if (currentFailure && line.trim()) {
        // Append error details (limit length)
        if (currentFailure.length < 500) {
          currentFailure += ' ' + line.trim();
        }
      }
    }
    if (currentFailure) {
      result.failures.push(currentFailure.trim());
    }
  }

  return result;
}

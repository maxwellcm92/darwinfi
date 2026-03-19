/**
 * DarwinFi Immune System - Thymus: Contract Scanner
 *
 * Static analysis of Solidity files in contracts/:
 * - Reentrancy guard usage
 * - Access control patterns
 * - Dangerous opcode detection (selfdestruct, delegatecall)
 * Scheduled at CHECK_INTERVALS.contractScan (24h).
 */

import * as fs from 'fs';
import * as path from 'path';
import { CheckResult } from '../types';
import { PROJECT_ROOT } from '../config';
const CONTRACTS_DIR = path.join(PROJECT_ROOT, 'contracts');

interface ContractFinding {
  file: string;
  check: string;
  status: 'pass' | 'fail' | 'warning';
  detail: string;
}

function collectSolFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'artifacts') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSolFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.sol')) {
      results.push(full);
    }
  }
  return results;
}

export async function scanContracts(): Promise<CheckResult> {
  const start = Date.now();
  const findings: ContractFinding[] = [];

  const solFiles = collectSolFiles(CONTRACTS_DIR);
  if (solFiles.length === 0) {
    return {
      checkId: 'contract_scan',
      category: 'security',
      severity: 'warning',
      message: 'No Solidity files found in contracts/',
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }

  for (const filePath of solFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    const relPath = path.relative(PROJECT_ROOT, filePath);
    const isVault = /vault/i.test(path.basename(filePath));

    // Check reentrancy guards
    const hasReentrancyGuard = /ReentrancyGuard/.test(content) || /nonReentrant/.test(content);
    findings.push({
      file: relPath,
      check: 'reentrancy_guard',
      status: hasReentrancyGuard ? 'pass' : 'warning',
      detail: hasReentrancyGuard
        ? 'ReentrancyGuard or nonReentrant modifier found'
        : 'No reentrancy protection detected',
    });

    // Check access control
    const hasAccessControl = /Ownable/.test(content) || /onlyOwner/.test(content)
      || /AccessControl/.test(content) || /onlyRole/.test(content);
    findings.push({
      file: relPath,
      check: 'access_control',
      status: hasAccessControl ? 'pass' : 'warning',
      detail: hasAccessControl
        ? 'Access control pattern found'
        : 'No access control pattern detected',
    });

    // Check for dangerous opcodes in vault contracts
    if (isVault) {
      const hasSelfDestruct = /selfdestruct/.test(content) || /suicide/.test(content);
      const hasDelegateCall = /delegatecall/.test(content);

      if (hasSelfDestruct) {
        findings.push({
          file: relPath,
          check: 'selfdestruct',
          status: 'fail',
          detail: 'selfdestruct found in vault contract',
        });
      }
      if (hasDelegateCall) {
        findings.push({
          file: relPath,
          check: 'delegatecall',
          status: 'fail',
          detail: 'delegatecall found in vault contract',
        });
      }
      if (!hasSelfDestruct && !hasDelegateCall) {
        findings.push({
          file: relPath,
          check: 'dangerous_opcodes',
          status: 'pass',
          detail: 'No selfdestruct or delegatecall in vault contract',
        });
      }
    }
  }

  // Determine overall severity
  const hasFail = findings.some(f => f.status === 'fail');
  const hasWarning = findings.some(f => f.status === 'warning');
  let severity: 'ok' | 'warning' | 'error' | 'critical' = 'ok';
  if (hasFail) severity = 'critical';
  else if (hasWarning) severity = 'warning';

  const failCount = findings.filter(f => f.status === 'fail').length;
  const warnCount = findings.filter(f => f.status === 'warning').length;
  const passCount = findings.filter(f => f.status === 'pass').length;

  return {
    checkId: 'contract_scan',
    category: 'security',
    severity,
    message: `${solFiles.length} contracts scanned: ${passCount} pass, ${warnCount} warning, ${failCount} fail`,
    details: { findings, contractCount: solFiles.length },
    timestamp: Date.now(),
    durationMs: Date.now() - start,
  };
}

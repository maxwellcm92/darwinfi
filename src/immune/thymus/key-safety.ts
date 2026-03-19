/**
 * DarwinFi Immune System - Thymus: Key Safety Scanner
 *
 * Scans source files for exposed private keys and PEM blocks.
 * Also verifies .env is listed in .gitignore.
 * Scheduled at CHECK_INTERVALS.keySafety (12h).
 */

import * as fs from 'fs';
import * as path from 'path';
import { CheckResult } from '../types';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const PRIVATE_KEY_HEX = /0x[a-fA-F0-9]{64}/;
const PEM_PRIVATE_KEY = /-----BEGIN.*PRIVATE KEY-----/;

const SCAN_DIRS = ['src', 'scripts'];
const SCAN_EXTENSIONS = new Set(['.ts', '.js', '.json']);
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'artifacts', '.env']);

interface Finding {
  file: string;
  line: number;
  pattern: string;
}

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

export async function scanKeySafety(): Promise<CheckResult> {
  const start = Date.now();
  const findings: Finding[] = [];

  // Scan source directories
  for (const dir of SCAN_DIRS) {
    const absDir = path.join(PROJECT_ROOT, dir);
    const files = collectFiles(absDir);
    for (const filePath of files) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      const relPath = path.relative(PROJECT_ROOT, filePath);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (PRIVATE_KEY_HEX.test(line)) {
          findings.push({ file: relPath, line: i + 1, pattern: 'hex_private_key' });
        }
        if (PEM_PRIVATE_KEY.test(line)) {
          findings.push({ file: relPath, line: i + 1, pattern: 'pem_private_key' });
        }
      }
    }
  }

  // Check .gitignore contains .env
  let envInGitignore = false;
  const gitignorePath = path.join(PROJECT_ROOT, '.gitignore');
  try {
    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    envInGitignore = gitignore.split('\n').some(l => l.trim() === '.env' || l.trim() === '.env*');
  } catch {
    // .gitignore does not exist
  }

  // Determine severity
  let severity: 'ok' | 'warning' | 'error' | 'critical' = 'ok';
  const messages: string[] = [];

  if (findings.length > 0) {
    severity = 'critical';
    messages.push(`${findings.length} potential private key(s) found in source`);
  }
  if (!envInGitignore) {
    if (severity === 'ok') severity = 'warning';
    messages.push('.env is not listed in .gitignore');
  }
  if (messages.length === 0) {
    messages.push('No exposed keys found, .env protected by .gitignore');
  }

  return {
    checkId: 'key_safety',
    category: 'security',
    severity,
    message: messages.join('; '),
    details: {
      findings,
      envInGitignore,
      filesScanned: SCAN_DIRS.reduce((n, d) => n + collectFiles(path.join(PROJECT_ROOT, d)).length, 0),
    },
    timestamp: Date.now(),
    durationMs: Date.now() - start,
  };
}

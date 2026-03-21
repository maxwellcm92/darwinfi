import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// Strategy genome storage on IPFS/Filecoin via Storacha
// Uses the `storacha` CLI (already authenticated) for reliable uploads

export interface StoredGenome {
  cid: string;
  strategyId: string;
  generation: number;
  timestamp: string;
  genomeHash: string;
}

export class FilecoinStore {
  private history: StoredGenome[] = [];
  private historyPath: string;

  constructor(_proofOrUnused?: string, dataDir: string = "./data") {
    this.historyPath = path.join(dataDir, "ipfs-history.json");
    this.loadHistory();
  }

  private loadHistory(): void {
    try {
      if (fs.existsSync(this.historyPath)) {
        this.history = JSON.parse(fs.readFileSync(this.historyPath, "utf-8"));
      }
    } catch {
      this.history = [];
    }
  }

  private saveHistory(): void {
    const dir = path.dirname(this.historyPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2));
  }

  async pinGenome(genome: object, strategyId: string, generation: number): Promise<string> {
    const payload = JSON.stringify({
      strategyId,
      generation,
      timestamp: new Date().toISOString(),
      genome,
    });

    console.log(`[DarwinFi] Pinning genome for ${strategyId} gen ${generation} to IPFS...`);

    // Write temp file for CLI upload
    const tmpFile = path.join("/tmp", `darwinfi-${strategyId}-gen${generation}.json`);
    fs.writeFileSync(tmpFile, payload);

    try {
      // Use storacha CLI (already authenticated with billing-provisioned space)
      const output = execSync(`storacha up "${tmpFile}" 2>&1`, {
        encoding: "utf-8",
        timeout: 30_000,
      });

      // Extract CID from CLI output (e.g. "https://storacha.link/ipfs/bafybeiabc...")
      const match = output.match(/(baf[a-z2-7]{50,})/);
      const cidStr = match ? match[1] : "";

      if (!cidStr || cidStr.length < 10) {
        throw new Error(`Invalid CID from CLI: ${output.slice(0, 200)}`);
      }

      console.log(`[DarwinFi] Genome pinned! CID: ${cidStr}`);

      const record: StoredGenome = {
        cid: cidStr,
        strategyId,
        generation,
        timestamp: new Date().toISOString(),
        genomeHash: this.hashGenome(payload),
      };

      this.history.push(record);
      this.saveHistory();

      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch {}

      return cidStr;
    } catch (error) {
      console.log(`[DarwinFi] IPFS pin failed, storing locally:`, error instanceof Error ? error.message : error);
      // Fallback: store locally
      const localPath = path.join(path.dirname(this.historyPath), "genomes", `${strategyId}-gen${generation}.json`);
      const localDir = path.dirname(localPath);
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      fs.writeFileSync(localPath, payload);
      try { fs.unlinkSync(tmpFile); } catch {}
      return `local:${localPath}`;
    }
  }

  private hashGenome(data: string): string {
    // Simple hash for verification
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return "0x" + Math.abs(hash).toString(16).padStart(8, "0");
  }

  getHistory(): StoredGenome[] {
    return [...this.history];
  }

  getLatestCID(strategyId: string): string | null {
    const entries = this.history.filter(h => h.strategyId === strategyId);
    return entries.length > 0 ? entries[entries.length - 1].cid : null;
  }
}

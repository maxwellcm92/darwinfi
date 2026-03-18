import * as fs from "fs";
import * as path from "path";

// Strategy genome storage on IPFS/Filecoin via Storacha
// Uses HTTP API for uploads when w3up-client is not available

const STORACHA_API = "https://api.web3.storage";

export interface StoredGenome {
  cid: string;
  strategyId: string;
  generation: number;
  timestamp: string;
  genomeHash: string;
}

export class FilecoinStore {
  private apiToken: string;
  private history: StoredGenome[] = [];
  private historyPath: string;

  constructor(apiToken: string, dataDir: string = "./data") {
    this.apiToken = apiToken;
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

    try {
      const response = await fetch(`${STORACHA_API}/upload`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
          "X-Name": `darwinfi-${strategyId}-gen${generation}`,
        },
        body: payload,
      });

      if (!response.ok) {
        throw new Error(`IPFS upload failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as { cid: string };
      const cid = result.cid;

      console.log(`[DarwinFi] Genome pinned! CID: ${cid}`);

      const record: StoredGenome = {
        cid,
        strategyId,
        generation,
        timestamp: new Date().toISOString(),
        genomeHash: this.hashGenome(payload),
      };

      this.history.push(record);
      this.saveHistory();

      return cid;
    } catch (error) {
      console.log(`[DarwinFi] IPFS pin failed, storing locally:`, error);
      // Fallback: store locally
      const localPath = path.join(path.dirname(this.historyPath), "genomes", `${strategyId}-gen${generation}.json`);
      const localDir = path.dirname(localPath);
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      fs.writeFileSync(localPath, payload);
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

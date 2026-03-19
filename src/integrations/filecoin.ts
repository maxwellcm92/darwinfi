import * as fs from "fs";
import * as path from "path";

// Strategy genome storage on IPFS/Filecoin via Storacha
// Uses @storacha/client with UCAN delegation-based auth

export interface StoredGenome {
  cid: string;
  strategyId: string;
  generation: number;
  timestamp: string;
  genomeHash: string;
}

// Lazy-loaded Storacha client (ESM module requires dynamic import)
let storachaClient: any = null;
let storachaReady = false;
let storachaInitError: string | null = null;

async function getStorachaClient(proofBase64: string): Promise<any> {
  if (storachaClient && storachaReady) return storachaClient;

  const Client = await import("@storacha/client");
  // Dynamic import for ESM-only subpath (moduleResolution: node can't resolve it statically)
  const { parse } = await (Function('return import("@storacha/client/proof")')() as Promise<{ parse: (s: string) => Promise<any> }>);

  const client = await Client.create();
  const proof = await parse(proofBase64);
  const space = await client.addSpace(proof);
  await client.setCurrentSpace(space.did());

  storachaClient = client;
  storachaReady = true;
  return client;
}

export class FilecoinStore {
  private proofBase64: string;
  private history: StoredGenome[] = [];
  private historyPath: string;

  constructor(proofBase64: string, dataDir: string = "./data") {
    this.proofBase64 = proofBase64;
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
      const client = await getStorachaClient(this.proofBase64);
      const file = new File([payload], `darwinfi-${strategyId}-gen${generation}.json`, {
        type: "application/json",
      });
      const cid = await client.uploadFile(file);
      const cidStr = cid.toString();

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

      return cidStr;
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

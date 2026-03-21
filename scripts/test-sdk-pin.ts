import { FilecoinStore } from '../src/integrations/filecoin';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const proof = process.env.STORACHA_PROOF;
  if (!proof) { console.log('No STORACHA_PROOF in env'); return; }
  console.log('Proof length:', proof.length);
  const store = new FilecoinStore(proof, './data');
  const cid = await store.pinGenome(
    { test: true, strategy: 'main-alpha', params: { riskPct: 2 } },
    'test-pin',
    99
  );
  console.log('Result CID:', cid);
  console.log('IPFS Success:', !cid.startsWith('local:'));
}

main().catch(e => console.error('Error:', e.message, e.cause?.message || ''));

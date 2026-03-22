# Lit Protocol Chipotle v3 -- Migration Notes

## Overview

Lit Protocol v3 (codename "Chipotle") is a ground-up rebuild of Lit's signing and compute infrastructure. It replaces the SDK-based LitNodeClient model with a simple REST API, eliminates threshold cryptography coordination, and runs Lit Actions inside single-machine TEE (Trusted Execution Environment) with on-chain key management.

**Production launch**: March 25, 2026
**Naga sunset**: 30 days after Chipotle production (approx. April 24, 2026)
**Dev environment**: Live now at api.dev.litprotocol.com

## Architecture Changes (Naga -> Chipotle)

| Aspect | Naga (Current) | Chipotle (v3) |
|--------|---------------|---------------|
| Client | @lit-protocol/lit-node-client SDK | REST API (any HTTP client) |
| Auth | Wallet-based AuthSig / SessionSigs | API key in X-Api-Key header |
| Signing | Threshold ECDSA across distributed nodes | getPrivateKey() in TEE + ethers.js Wallet |
| Actions format | IIFE with Lit.Actions.signEcdsa() | async function main() with return value |
| Permissions | Runtime isPermittedAction() checks | On-chain enforcement via Groups + AccountConfig |
| PKP minting | On-chain via staking contract + Relay | REST: GET /core/v1/create_wallet |
| Network | datil-dev / datil-test / datil | api.dev.litprotocol.com (dev), production TBD |
| Payment | LIT tokens / gas for minting | Per-request LITKEY on Base |

## REST API Reference

**Base URL (Dev)**: https://api.dev.litprotocol.com/core/v1/
**Swagger UI**: https://api.dev.litprotocol.com/swagger-ui/
**OpenAPI Spec**: https://api.dev.litprotocol.com/core/v1/openapi.json

### Authentication

All protected endpoints accept either:
- `X-Api-Key: <your-api-key>`
- `Authorization: Bearer <your-api-key>`

### Core Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /new_account | POST | Create account, returns admin API key + wallet |
| /account_exists | GET | Verify API key validity |
| /add_usage_api_key | POST | Create scoped usage key (shown once) |
| /create_wallet | GET | Create new PKP wallet, returns address |
| /add_group | POST | Create permission group |
| /add_action_to_group | POST | Register IPFS CID in group |
| /add_pkp_to_group | POST | Add wallet to group |
| /lit_action | POST | Execute a Lit Action |
| /list_groups | GET | List groups (paginated) |
| /list_wallets | GET | List account wallets |
| /list_api_keys | GET | List usage API keys |
| /list_actions | GET | List actions in group |

### Execute a Lit Action

```
POST /core/v1/lit_action
Headers: X-Api-Key: <usage-api-key>
Body: {
  "code": "<javascript-code>",
  "js_params": { "pkpId": "<wallet-address>", ... }
}
Response: {
  "signatures": {...},
  "response": {...},
  "logs": "..."
}
```

Or use a pre-registered IPFS CID action (group must contain the CID and the PKP).

## Lit Action Migration (Breaking Changes)

### 1. Entry Point: IIFE -> async function main()

**Before (Naga)**:
```javascript
(async () => {
  // ... validation logic ...
  const sigShare = await Lit.Actions.signEcdsa({
    toSign: toSign,
    publicKey: publicKey,
    sigName: sigName,
  });
  Lit.Actions.setResponse({ response: JSON.stringify({ success: true }) });
})();
```

**After (Chipotle)**:
```javascript
async function main({ pkpId, txData, vaultAddress }) {
  // ... validation logic ...
  const wallet = new ethers.Wallet(
    await Lit.Actions.getPrivateKey({ pkpId })
  );
  const signature = await wallet.signMessage(payload);
  return { success: true, signature };
}
```

### 2. Signing: Threshold ECDSA -> Direct Private Key

- `Lit.Actions.signEcdsa()` is REMOVED
- Use `Lit.Actions.getPrivateKey({ pkpId })` to get the private key inside the TEE
- Sign with standard `ethers.Wallet` (ethers v5 is available globally)
- The private key never leaves the TEE -- it exists transiently during execution

### 3. Parameters: jsParams -> function arguments

- Parameters are passed via `js_params` in the REST request body
- They arrive as named arguments to `main()`
- No more `jsParams` global variable

### 4. Response: setResponse -> return

- `Lit.Actions.setResponse()` is REMOVED
- Just return the result from `main()`

### 5. Removed APIs

| Removed | Replacement |
|---------|-------------|
| Lit.Actions.signEcdsa() | getPrivateKey() + ethers.Wallet |
| Lit.Actions.setResponse() | return value from main() |
| Lit.Actions.signAndCombineEcdsa() | getPrivateKey() + ethers.Wallet |
| Lit.Actions.isPermittedAction() | On-chain group config |
| Lit.Actions.isPermittedAddress() | On-chain group config |
| broadcastAndCollect() | Removed (single TEE) |
| runOnce() | Removed (actions should be idempotent) |
| getRpcUrl() | Supply your own RPC URL |
| LitAuth / jwt globals | Removed |

### 6. Available Globals

- `Lit.Actions` (alias: `LitActions`)
- `ethers` (v5)
- `fetch` (standard web fetch)

## DarwinFi Migration Path

### What Needs to Change

1. **lit-wallet.ts**: Replace LitNodeClient SDK with REST API calls (fetch-based)
   - Remove `@lit-protocol/lit-node-client` dependency
   - Replace `executeJs()` with `POST /core/v1/lit_action`
   - Replace AuthSig/SessionSigs with API key header
   - Signature assembly changes: Chipotle returns ethers-format sigs directly

2. **trade-policy.js**: Rewrite as `async function main()`
   - Same validation logic, different entry point and signing mechanism
   - Use `getPrivateKey()` + ethers.Wallet for signing
   - Return result instead of setResponse()

3. **Environment variables**: Add LIT_API_KEY, remove LIT_PKP_PUBLIC_KEY (use wallet address instead)

4. **PKP provisioning**: Use REST API instead of on-chain minting script

### What Stays the Same

- Trade policy validation logic (whitelist, chain ID, trade size checks)
- ethers.js integration pattern (LitPKPSigner extends AbstractSigner)
- The overall DarwinFi agent architecture
- Vault interaction logic

### Migration Steps

1. Create Chipotle dev account at dashboard.dev.litprotocol.com
2. Create a wallet (PKP) via the dashboard or REST API
3. Create a group, register the trade-policy action CID, add the PKP
4. Create a usage API key scoped to execute on that group
5. Set LIT_API_KEY and LIT_CHIPOTLE_WALLET env vars
6. Deploy lit-wallet-v3.ts as the active wallet provider

### Current Readiness Status

| Component | Status | Notes |
|-----------|--------|-------|
| lit-wallet.ts (v2, Naga) | Working | Targets datil-test, SDK-based |
| lit-wallet-v3.ts (Chipotle) | Ready | REST API implementation, same interface |
| trade-policy.js (Naga) | Working | IIFE format with signEcdsa() |
| trade-policy-v3.js | Ready | async function main() format |
| Chipotle dev account | Not created | Needs dashboard signup |
| PKP wallet | Not provisioned | Needs account first |
| Group + action registration | Not done | Needs account + IPFS pin |
| LITKEY tokens | Not acquired | Needed for per-request payment |

### Timeline

- **March 22**: v3 implementation code ready (this sprint)
- **March 25**: Chipotle production launch -- create production account, migrate
- **April 24 (approx)**: Naga sunset deadline -- must be fully on Chipotle by then
- **Post-launch**: Monitor Chipotle stability, switch DarwinAgent to v3 wallet

## References

- Chipotle announcement: https://spark.litprotocol.com/introducing-lit-protocol-v3-chipotle/
- Naga sunset: https://spark.litprotocol.com/naga-network-sunset/
- Dev docs: https://docs.dev.litprotocol.com
- Dev dashboard: https://dashboard.dev.litprotocol.com
- API Swagger: https://api.dev.litprotocol.com/swagger-ui/
- OpenAPI spec: https://api.dev.litprotocol.com/core/v1/openapi.json

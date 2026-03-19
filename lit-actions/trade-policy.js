/**
 * trade-policy.js - Lit Action for DarwinFi trade validation
 *
 * Runs inside Lit Protocol network nodes. Validates every transaction
 * the autonomous trading agent attempts to sign, enforcing:
 *   - Contract whitelist (Uniswap V3 SwapRouter + DarwinVaultV2)
 *   - Token whitelist (approved Base L2 tokens only)
 *   - Chain ID (Base mainnet 8453 only)
 *   - No arbitrary transfers to unlisted addresses
 *
 * jsParams expected:
 *   - toSign:      The hash to sign (Uint8Array)
 *   - publicKey:   The PKP public key
 *   - sigName:     Name for the signature output
 *   - txData:      { to, value, data, chainId }
 *   - vaultAddress: The DarwinVaultV2 contract address
 */
(async () => {
  // -----------------------------------------------------------------
  // Policy constants
  // -----------------------------------------------------------------

  const UNISWAP_V3_SWAP_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481";

  const ALLOWED_TOKENS = {
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": "USDC",
    "0x4200000000000000000000000000000000000006": "WETH",
    "0xc3De830EA07524a0761646a6a4e4be0e114a3C83": "UNI",
    "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452": "wstETH",
    "0x2a2764E1472e0a09D70e10B1bfA4AFBE144F72a3": "ENS",
    "0x940181a94A35A4569E4529A3CDfB74e38FD98631": "AERO",
    "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed": "DEGEN",
    "0x532f27101965dd16442E59d40670FaF5eBB142E4": "BRETT",
    "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b": "VIRTUAL",
    "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe": "HIGHER",
  };

  const BASE_CHAIN_ID = 8453;

  // Uniswap V3 SwapRouter function selectors (first 4 bytes of keccak256)
  // exactInputSingle(tuple): 0x414bf389
  // multicall(uint256,bytes[]): 0x5ae401dc
  const ALLOWED_SWAP_SELECTORS = ["0x414bf389", "0x5ae401dc"];

  // ERC-20 approve(address,uint256): 0x095ea7b3
  const ERC20_APPROVE_SELECTOR = "0x095ea7b3";

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------

  function normalizeAddress(addr) {
    if (!addr || typeof addr !== "string") return "";
    return addr.toLowerCase().trim();
  }

  function getFunctionSelector(data) {
    if (!data || typeof data !== "string" || data.length < 10) return "";
    return data.slice(0, 10).toLowerCase();
  }

  function extractAddressFromCalldata(data, byteOffset) {
    // Addresses in calldata are 32-byte words with the address in the last 20 bytes
    // byteOffset is the start of the 32-byte word (in hex chars after 0x prefix)
    const hexOffset = 10 + byteOffset * 2; // skip "0x" + 4-byte selector (8 chars) = 10, then offset
    if (data.length < hexOffset + 64) return "";
    const word = data.slice(hexOffset, hexOffset + 64);
    return "0x" + word.slice(24).toLowerCase();
  }

  // -----------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------

  const { txData, vaultAddress } = jsParams;

  if (!txData) {
    Lit.Actions.setResponse({
      response: JSON.stringify({ success: false, error: "Missing txData in jsParams" }),
    });
    return;
  }

  const to = normalizeAddress(txData.to);
  const chainId = Number(txData.chainId);
  const data = txData.data || "0x";
  const value = txData.value || "0";

  const errors = [];

  // Check 1: Chain ID must be Base mainnet
  if (chainId !== BASE_CHAIN_ID) {
    errors.push(
      "Chain ID violation: expected " + BASE_CHAIN_ID + ", got " + chainId
    );
  }

  // Check 2: Build the contract whitelist
  const contractWhitelist = [normalizeAddress(UNISWAP_V3_SWAP_ROUTER)];
  if (vaultAddress) {
    contractWhitelist.push(normalizeAddress(vaultAddress));
  }

  // Also allow direct calls to whitelisted token contracts (for approve/allowance)
  const tokenAddresses = Object.keys(ALLOWED_TOKENS).map(normalizeAddress);

  const allAllowedTargets = [...contractWhitelist, ...tokenAddresses];

  if (!to) {
    errors.push("Transaction has no 'to' address (contract creation not allowed)");
  } else if (!allAllowedTargets.includes(to)) {
    errors.push(
      "Target address not whitelisted: " + to +
      ". Allowed: " + allAllowedTargets.join(", ")
    );
  }

  // Check 3: If targeting a token contract, only approve() is allowed
  if (to && tokenAddresses.includes(to)) {
    const selector = getFunctionSelector(data);
    if (selector !== ERC20_APPROVE_SELECTOR) {
      errors.push(
        "Only approve() calls allowed on token contracts. Got selector: " + selector
      );
    } else {
      // Verify the spender in the approve call is the SwapRouter or vault
      const spender = extractAddressFromCalldata(data, 0);
      if (!contractWhitelist.includes(spender)) {
        errors.push(
          "approve() spender not whitelisted: " + spender +
          ". Only SwapRouter and Vault are allowed spenders."
        );
      }
    }
  }

  // Check 4: If targeting the SwapRouter, verify function selector
  if (to === normalizeAddress(UNISWAP_V3_SWAP_ROUTER)) {
    const selector = getFunctionSelector(data);
    if (!ALLOWED_SWAP_SELECTORS.includes(selector)) {
      errors.push(
        "SwapRouter function not allowed. Selector: " + selector +
        ". Allowed: " + ALLOWED_SWAP_SELECTORS.join(", ")
      );
    }
  }

  // Check 5: No native ETH transfers to non-whitelisted addresses
  // (value > 0 is okay to SwapRouter for WETH wrapping, but not to random addresses)
  if (
    BigInt(value) > 0n &&
    to !== normalizeAddress(UNISWAP_V3_SWAP_ROUTER)
  ) {
    errors.push(
      "Native ETH transfers only allowed to SwapRouter. Target: " + to
    );
  }

  // -----------------------------------------------------------------
  // Decision: sign or reject
  // -----------------------------------------------------------------

  if (errors.length > 0) {
    Lit.Actions.setResponse({
      response: JSON.stringify({
        success: false,
        error: "Trade policy violation(s): " + errors.join("; "),
        violations: errors,
      }),
    });
    return;
  }

  // All checks passed -- sign the transaction
  const sigShare = await Lit.Actions.signEcdsa({
    toSign: toSign,
    publicKey: publicKey,
    sigName: sigName,
  });

  Lit.Actions.setResponse({
    response: JSON.stringify({
      success: true,
      message: "Transaction approved by trade policy",
    }),
  });
})();

/**
 * trade-policy-v3.js - Lit Action for DarwinFi trade validation (Chipotle v3)
 *
 * Chipotle v3 format: async function main() with direct return.
 * Uses Lit.Actions.getPrivateKey() + ethers.Wallet for signing
 * instead of Lit.Actions.signEcdsa() threshold signing.
 *
 * Same validation logic as trade-policy.js (Naga version):
 *   - Contract whitelist (Uniswap V3 SwapRouter + DarwinVault)
 *   - Token whitelist (approved Base L2 tokens only)
 *   - Chain ID (Base mainnet 8453 only)
 *   - Trade size limits (1000 USDC max)
 *   - No arbitrary transfers to unlisted addresses
 *
 * js_params (passed as main() arguments):
 *   - pkpId:        The PKP wallet address
 *   - txData:       { to, value, data, chainId, toSign?, serializedUnsigned?, rpcUrl? }
 *   - vaultAddress: The DarwinVault contract address
 */
async function main({ pkpId, txData, vaultAddress }) {
  // -----------------------------------------------------------------
  // Policy constants
  // -----------------------------------------------------------------

  const UNISWAP_V3_SWAP_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481";

  // Maximum trade size in USDC (6 decimals). 1000 USDC = 1,000,000,000
  const MAX_TRADE_USDC = 1000000000n; // 1000 USDC
  const USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // lowercase

  const ALLOWED_TOKENS = {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
    "0x4200000000000000000000000000000000000006": "WETH",
    "0xc3de830ea07524a0761646a6a4e4be0e114a3c83": "UNI",
    "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": "wstETH",
    "0x2a2764e1472e0a09d70e10b1bfa4afbe144f72a3": "ENS",
    "0x940181a94a35a4569e4529a3cdfb74e38fd98631": "AERO",
    "0x4ed4e862860bed51a9570b96d89af5e1b0efefed": "DEGEN",
    "0x532f27101965dd16442e59d40670faf5ebb142e4": "BRETT",
    "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b": "VIRTUAL",
    "0x0578d8a44db98b23bf096a382e016e29a5ce0ffe": "HIGHER",
  };

  const BASE_CHAIN_ID = 8453;

  // Uniswap V3 SwapRouter function selectors
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
    const hexOffset = 10 + byteOffset * 2;
    if (data.length < hexOffset + 64) return "";
    const word = data.slice(hexOffset, hexOffset + 64);
    return "0x" + word.slice(24).toLowerCase();
  }

  // -----------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------

  if (!txData) {
    return { success: false, error: "Missing txData in js_params" };
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

  // Also allow direct calls to whitelisted token contracts (for approve)
  const tokenAddresses = Object.keys(ALLOWED_TOKENS);

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
  if (
    BigInt(value) > 0n &&
    to !== normalizeAddress(UNISWAP_V3_SWAP_ROUTER)
  ) {
    errors.push(
      "Native ETH transfers only allowed to SwapRouter. Target: " + to
    );
  }

  // Check 6: Trade size limit for exactInputSingle swaps
  if (to === normalizeAddress(UNISWAP_V3_SWAP_ROUTER)) {
    const selector = getFunctionSelector(data);
    if (selector === "0x414bf389" && data.length >= 330) {
      const tokenInWord = data.slice(10, 74);
      const tokenIn = "0x" + tokenInWord.slice(24).toLowerCase();
      const amountInHex = data.slice(266, 330);
      const amountIn = BigInt("0x" + amountInHex);

      if (tokenIn === USDC_ADDRESS && amountIn > MAX_TRADE_USDC) {
        errors.push(
          "Trade size exceeds maximum: " + amountIn.toString() +
          " > " + MAX_TRADE_USDC.toString() + " (max 1000 USDC)"
        );
      }
    }
  }

  // -----------------------------------------------------------------
  // Decision: sign or reject
  // -----------------------------------------------------------------

  if (errors.length > 0) {
    return {
      success: false,
      error: "Trade policy violation(s): " + errors.join("; "),
      violations: errors,
    };
  }

  // All checks passed -- sign using getPrivateKey() + ethers.Wallet
  const privateKey = await Lit.Actions.getPrivateKey({ pkpId });
  const wallet = new ethers.Wallet(privateKey);

  // If a raw hash to sign was provided
  if (txData.toSign) {
    const sig = await wallet.signMessage(
      ethers.utils.arrayify(txData.toSign)
    );
    return {
      success: true,
      message: "Transaction approved by trade policy",
      signature: sig,
    };
  }

  // If a full serialized unsigned transaction was provided
  if (txData.serializedUnsigned) {
    const provider = new ethers.providers.JsonRpcProvider(
      txData.rpcUrl || "https://mainnet.base.org"
    );
    const connectedWallet = wallet.connect(provider);
    const txObj = JSON.parse(txData.serializedUnsigned);
    // Convert string values back to appropriate types for ethers v5
    if (txObj.value) txObj.value = ethers.BigNumber.from(txObj.value);
    if (txObj.gasLimit) txObj.gasLimit = ethers.BigNumber.from(txObj.gasLimit);
    if (txObj.maxFeePerGas) txObj.maxFeePerGas = ethers.BigNumber.from(txObj.maxFeePerGas);
    if (txObj.maxPriorityFeePerGas) txObj.maxPriorityFeePerGas = ethers.BigNumber.from(txObj.maxPriorityFeePerGas);
    const signedTx = await connectedWallet.signTransaction(txObj);
    return {
      success: true,
      message: "Transaction signed by trade policy",
      signature: signedTx,
    };
  }

  return {
    success: true,
    message: "Trade policy approved (no signing requested)",
  };
}

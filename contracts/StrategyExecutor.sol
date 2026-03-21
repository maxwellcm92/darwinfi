// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal interface for Uniswap V3 SwapRouter (exactInputSingle).
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Swaps `amountIn` of one token for as much as possible of another token.
    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256 amountOut);
}

/// @title StrategyExecutor
/// @notice Executes Uniswap V3 swaps on behalf of DarwinFi strategies. Pulls funds from DarwinVault,
///         performs the swap via the Uniswap V3 SwapRouter on Base, and returns proceeds to the vault.
/// @dev Only the authorized DarwinFi agent address can call executeTrade.
contract StrategyExecutor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ----------------------------------------------------------------
    // Immutables & State
    // ----------------------------------------------------------------

    /// @notice Uniswap V3 SwapRouter on Base mainnet.
    address public constant SWAP_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;

    /// @notice The DarwinVault that holds strategy funds.
    address public vault;

    /// @notice The authorized DarwinFi agent that can submit trade instructions.
    address public agent;

    /// @notice Running trade counter for unique trade IDs.
    uint256 public tradeNonce;

    /// @notice Maximum allowed slippage in basis points (default 500 = 5%).
    uint256 public maxSlippageBps = 500;

    /// @notice Absolute ceiling for maxSlippageBps (1000 = 10%).
    uint256 public constant MAX_SLIPPAGE_CEILING = 1000;

    /// @notice 48-hour timelock duration, matching DarwinVaultV4.
    uint256 public constant TIMELOCK_DURATION = 48 hours;

    /// @notice Pending new maxSlippageBps value awaiting timelock confirmation.
    uint256 public pendingMaxSlippageBps;

    /// @notice Timestamp when pendingMaxSlippageBps was set (0 = no pending change).
    uint256 public pendingMaxSlippageBpsTimestamp;

    // ----------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------

    event TradeExecuted(
        uint256 indexed tradeId,
        uint256 indexed strategyId,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint24 fee,
        uint256 timestamp
    );

    event VaultUpdated(address indexed oldVault, address indexed newVault);
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);

    event PendingMaxSlippageSet(uint256 newBps, uint256 readyAt);
    event MaxSlippageConfirmed(uint256 oldBps, uint256 newBps);
    event PendingMaxSlippageCancelled(uint256 cancelledBps);

    // ----------------------------------------------------------------
    // Errors
    // ----------------------------------------------------------------

    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error SwapFailed();
    error SlippageTooHigh(uint256 requested, uint256 ceiling);
    error SlippageFloorViolation(uint256 amountOutMin, uint256 requiredMin);
    error TimelockNotElapsed(uint256 readyAt);
    error NoPendingChange();

    // ----------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------

    modifier onlyAgent() {
        if (msg.sender != agent) revert Unauthorized();
        _;
    }

    // ----------------------------------------------------------------
    // Constructor
    // ----------------------------------------------------------------

    /// @param _owner The contract owner (deployer).
    /// @param _vault The DarwinVault address.
    /// @param _agent The authorized DarwinFi agent address.
    constructor(address _owner, address _vault, address _agent) Ownable(_owner) {
        if (_vault == address(0) || _agent == address(0)) revert ZeroAddress();
        vault = _vault;
        agent = _agent;
    }

    // ----------------------------------------------------------------
    // Owner: Configuration
    // ----------------------------------------------------------------

    /// @notice Update the DarwinVault address.
    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroAddress();
        address old = vault;
        vault = _vault;
        emit VaultUpdated(old, _vault);
    }

    /// @notice Update the authorized agent address.
    function setAgent(address _agent) external onlyOwner {
        if (_agent == address(0)) revert ZeroAddress();
        address old = agent;
        agent = _agent;
        emit AgentUpdated(old, _agent);
    }

    /// @notice Initiate max slippage change (starts 48h timelock).
    /// @param _bps New max slippage in basis points (must be <= MAX_SLIPPAGE_CEILING).
    function setMaxSlippage(uint256 _bps) external onlyOwner {
        if (_bps > MAX_SLIPPAGE_CEILING) revert SlippageTooHigh(_bps, MAX_SLIPPAGE_CEILING);
        pendingMaxSlippageBps = _bps;
        pendingMaxSlippageBpsTimestamp = block.timestamp;
        emit PendingMaxSlippageSet(_bps, block.timestamp + TIMELOCK_DURATION);
    }

    /// @notice Confirm max slippage change after 48h timelock has elapsed.
    function confirmMaxSlippage() external onlyOwner {
        if (pendingMaxSlippageBpsTimestamp == 0) revert NoPendingChange();
        if (block.timestamp < pendingMaxSlippageBpsTimestamp + TIMELOCK_DURATION) {
            revert TimelockNotElapsed(pendingMaxSlippageBpsTimestamp + TIMELOCK_DURATION);
        }
        uint256 oldBps = maxSlippageBps;
        maxSlippageBps = pendingMaxSlippageBps;
        pendingMaxSlippageBps = 0;
        pendingMaxSlippageBpsTimestamp = 0;
        emit MaxSlippageConfirmed(oldBps, maxSlippageBps);
    }

    /// @notice Cancel a pending max slippage change.
    function cancelPendingMaxSlippage() external onlyOwner {
        if (pendingMaxSlippageBpsTimestamp == 0) revert NoPendingChange();
        uint256 cancelled = pendingMaxSlippageBps;
        pendingMaxSlippageBps = 0;
        pendingMaxSlippageBpsTimestamp = 0;
        emit PendingMaxSlippageCancelled(cancelled);
    }

    // ----------------------------------------------------------------
    // Agent: Trade Execution
    // ----------------------------------------------------------------

    /// @notice Execute a Uniswap V3 exactInputSingle swap for a given strategy.
    /// @param strategyId      The DarwinFi strategy ID funding this trade.
    /// @param tokenIn         The input token address.
    /// @param tokenOut        The output token address.
    /// @param amountIn        The amount of tokenIn to swap.
    /// @param fee             The Uniswap V3 pool fee tier (e.g., 500, 3000, 10000).
    /// @param amountOutMin    Minimum acceptable output (slippage protection).
    /// @param sqrtPriceLimitX96 Price limit for the swap. Pass 0 for no limit.
    /// @return amountOut      The actual amount of tokenOut received.
    function executeTrade(
        uint256 strategyId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint24 fee,
        uint256 amountOutMin,
        uint160 sqrtPriceLimitX96
    ) external onlyAgent nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();

        // M-02: Enforce slippage floor -- amountOutMin must meet the maxSlippageBps threshold
        uint256 requiredMin = (amountIn * (10000 - maxSlippageBps)) / 10000;
        if (amountOutMin < requiredMin) revert SlippageFloorViolation(amountOutMin, requiredMin);

        // 1. Pull funds from DarwinVault
        IDarwinVault(vault).spendToken(strategyId, tokenIn, amountIn, address(this));

        // 2. Approve SwapRouter to spend tokenIn
        IERC20(tokenIn).forceApprove(SWAP_ROUTER, amountIn);

        // 3. Build swap params -- proceeds come back to this contract
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: address(this),
            amountIn: amountIn,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });

        // 4. Execute swap
        amountOut = ISwapRouter(SWAP_ROUTER).exactInputSingle(params);

        // 5. Return proceeds to DarwinVault, credited to the same strategy
        IERC20(tokenOut).forceApprove(vault, amountOut);
        IDarwinVault(vault).returnProceeds(strategyId, tokenOut, amountOut);

        // 6. Emit trade event
        uint256 tradeId = tradeNonce++;
        emit TradeExecuted(
            tradeId,
            strategyId,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            fee,
            block.timestamp
        );
    }

    // ----------------------------------------------------------------
    // Owner: Emergency Token Recovery
    // ----------------------------------------------------------------

    /// @notice Recover tokens accidentally sent to this contract.
    /// @param token The ERC-20 token to recover.
    /// @param to The recipient.
    function recoverToken(address token, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).safeTransfer(to, bal);
        }
    }

    /// @notice Recover ETH accidentally sent to this contract.
    /// @param to The recipient.
    function recoverETH(address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool success,) = to.call{value: bal}("");
            if (!success) revert SwapFailed();
        }
    }

    /// @notice Accept ETH (needed if a swap returns native ETH).
    receive() external payable {}
}

/// @notice Minimal interface for DarwinVault methods called by StrategyExecutor.
interface IDarwinVault {
    function spendToken(uint256 strategyId, address token, uint256 amount, address recipient) external;
    function returnProceeds(uint256 strategyId, address token, uint256 amount) external;
}

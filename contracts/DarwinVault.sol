// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title DarwinVault
/// @notice Fund management vault with per-strategy spending scopes for the DarwinFi autonomous trading agent.
/// @dev Owner deposits ETH/USDC. Each strategy ID has an independent budget. Only the authorized
///      StrategyExecutor contract can pull funds from a strategy's budget.
contract DarwinVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ----------------------------------------------------------------
    // State
    // ----------------------------------------------------------------

    /// @notice The authorized StrategyExecutor contract that can spend strategy budgets.
    address public strategyExecutor;

    /// @notice Per-strategy budget for a given ERC-20 token.
    ///         strategyBudget[strategyId][token] = remaining budget in token-wei.
    mapping(uint256 => mapping(address => uint256)) public strategyBudget;

    /// @notice Per-strategy budget for native ETH.
    ///         strategyEthBudget[strategyId] = remaining budget in wei.
    mapping(uint256 => uint256) public strategyEthBudget;

    /// @notice Sentinel address used to represent native ETH in events.
    address public constant ETH_SENTINEL = address(0);

    // ----------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------

    event Deposited(address indexed depositor, address indexed token, uint256 amount);
    event Withdrawn(address indexed to, address indexed token, uint256 amount);
    event BudgetAllocated(uint256 indexed strategyId, address indexed token, uint256 amount);
    event BudgetSpent(uint256 indexed strategyId, address indexed token, uint256 amount, address indexed spender);
    event StrategyExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);
    event EmergencyWithdraw(address indexed token, uint256 amount);

    // ----------------------------------------------------------------
    // Errors
    // ----------------------------------------------------------------

    error Unauthorized();
    error InsufficientBudget(uint256 strategyId, address token, uint256 requested, uint256 available);
    error InsufficientBalance(address token, uint256 requested, uint256 available);
    error ZeroAddress();
    error ZeroAmount();
    error TransferFailed();

    // ----------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------

    modifier onlyExecutor() {
        if (msg.sender != strategyExecutor) revert Unauthorized();
        _;
    }

    // ----------------------------------------------------------------
    // Constructor
    // ----------------------------------------------------------------

    /// @param _owner The vault owner (typically the deployer / Maxwell's wallet).
    constructor(address _owner) Ownable(_owner) {}

    // ----------------------------------------------------------------
    // Receive ETH
    // ----------------------------------------------------------------

    /// @notice Accept plain ETH transfers as deposits.
    receive() external payable {
        emit Deposited(msg.sender, ETH_SENTINEL, msg.value);
    }

    // ----------------------------------------------------------------
    // Owner: Configuration
    // ----------------------------------------------------------------

    /// @notice Set or update the authorized StrategyExecutor address.
    /// @param _executor The new executor contract address.
    function setStrategyExecutor(address _executor) external onlyOwner {
        if (_executor == address(0)) revert ZeroAddress();
        address old = strategyExecutor;
        strategyExecutor = _executor;
        emit StrategyExecutorUpdated(old, _executor);
    }

    // ----------------------------------------------------------------
    // Owner: Deposits
    // ----------------------------------------------------------------

    /// @notice Deposit ETH into the vault.
    function depositETH() external payable onlyOwner {
        if (msg.value == 0) revert ZeroAmount();
        emit Deposited(msg.sender, ETH_SENTINEL, msg.value);
    }

    /// @notice Deposit an ERC-20 token into the vault.
    /// @param token The token address.
    /// @param amount The amount to transfer in (must have prior approval).
    function depositToken(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, token, amount);
    }

    // ----------------------------------------------------------------
    // Owner: Budget Allocation
    // ----------------------------------------------------------------

    /// @notice Allocate a budget from the vault's token balance to a specific strategy.
    /// @param strategyId The strategy identifier (0, 1, 2 for the three main strategies).
    /// @param token The ERC-20 token address.
    /// @param amount The amount to allocate.
    function allocateTokenBudget(uint256 strategyId, address token, uint256 amount) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (amount > balance) revert InsufficientBalance(token, amount, balance);
        strategyBudget[strategyId][token] += amount;
        emit BudgetAllocated(strategyId, token, amount);
    }

    /// @notice Allocate a budget from the vault's ETH balance to a specific strategy.
    /// @param strategyId The strategy identifier.
    /// @param amount The amount of ETH (in wei) to allocate.
    function allocateEthBudget(uint256 strategyId, uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (amount > address(this).balance) revert InsufficientBalance(ETH_SENTINEL, amount, address(this).balance);
        strategyEthBudget[strategyId] += amount;
        emit BudgetAllocated(strategyId, ETH_SENTINEL, amount);
    }

    // ----------------------------------------------------------------
    // Executor: Spend from Strategy Budget
    // ----------------------------------------------------------------

    /// @notice Pull ERC-20 tokens from a strategy's budget. Called by StrategyExecutor only.
    /// @param strategyId The strategy whose budget to debit.
    /// @param token The ERC-20 token address.
    /// @param amount The amount to transfer out.
    /// @param recipient Where to send the tokens (typically the StrategyExecutor).
    function spendToken(
        uint256 strategyId,
        address token,
        uint256 amount,
        address recipient
    ) external onlyExecutor nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 budget = strategyBudget[strategyId][token];
        if (amount > budget) revert InsufficientBudget(strategyId, token, amount, budget);

        strategyBudget[strategyId][token] = budget - amount;
        IERC20(token).safeTransfer(recipient, amount);
        emit BudgetSpent(strategyId, token, amount, recipient);
    }

    /// @notice Pull ETH from a strategy's budget. Called by StrategyExecutor only.
    /// @param strategyId The strategy whose budget to debit.
    /// @param amount The amount of ETH (in wei) to send.
    /// @param recipient Where to send the ETH.
    function spendETH(
        uint256 strategyId,
        uint256 amount,
        address payable recipient
    ) external onlyExecutor nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 budget = strategyEthBudget[strategyId];
        if (amount > budget) revert InsufficientBudget(strategyId, ETH_SENTINEL, amount, budget);

        strategyEthBudget[strategyId] = budget - amount;
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit BudgetSpent(strategyId, ETH_SENTINEL, amount, recipient);
    }

    // ----------------------------------------------------------------
    // Executor: Return Proceeds
    // ----------------------------------------------------------------

    /// @notice Receive swap proceeds back into a strategy's budget.
    /// @dev Called by StrategyExecutor after a successful swap to credit the output tokens.
    /// @param strategyId The strategy to credit.
    /// @param token The ERC-20 token received.
    /// @param amount The amount received.
    function returnProceeds(uint256 strategyId, address token, uint256 amount) external onlyExecutor {
        if (amount == 0) revert ZeroAmount();
        // Transfer tokens from executor back into vault
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        strategyBudget[strategyId][token] += amount;
        emit Deposited(msg.sender, token, amount);
        emit BudgetAllocated(strategyId, token, amount);
    }

    // ----------------------------------------------------------------
    // Owner: Withdrawals
    // ----------------------------------------------------------------

    /// @notice Withdraw ERC-20 tokens from the vault.
    /// @param token The token to withdraw.
    /// @param amount The amount to withdraw.
    /// @param to The recipient address.
    function withdrawToken(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(to, token, amount);
    }

    /// @notice Withdraw ETH from the vault.
    /// @param amount The amount (in wei) to withdraw.
    /// @param to The recipient address.
    function withdrawETH(uint256 amount, address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > address(this).balance) revert InsufficientBalance(ETH_SENTINEL, amount, address(this).balance);
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit Withdrawn(to, ETH_SENTINEL, amount);
    }

    // ----------------------------------------------------------------
    // Owner: Emergency
    // ----------------------------------------------------------------

    /// @notice Emergency withdraw ALL of a token (or ETH) from the vault. Bypasses budget accounting.
    /// @param token The token to drain. Use address(0) for ETH.
    function emergencyWithdraw(address token) external onlyOwner nonReentrant {
        if (token == address(0)) {
            uint256 bal = address(this).balance;
            (bool success,) = payable(owner()).call{value: bal}("");
            if (!success) revert TransferFailed();
            emit EmergencyWithdraw(ETH_SENTINEL, bal);
        } else {
            uint256 bal = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransfer(owner(), bal);
            emit EmergencyWithdraw(token, bal);
        }
    }

    // ----------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------

    /// @notice Get the vault's balance for a given ERC-20 token.
    function tokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @notice Get the vault's ETH balance.
    function ethBalance() external view returns (uint256) {
        return address(this).balance;
    }
}

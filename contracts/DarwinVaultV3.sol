// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title DarwinVaultV3
/// @notice ERC-4626 multi-user vault for DarwinFi. Users deposit USDC, receive dvUSDC shares.
///         The agent borrows USDC for trading and returns proceeds. Profits increase share value
///         automatically. Performance fees (5%) are taken above a high water mark.
///         Management fees (1% annual) accrue over time and are collected as minted shares.
contract DarwinVaultV3 is ERC4626, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ----------------------------------------------------------------
    // State
    // ----------------------------------------------------------------

    /// @notice The authorized agent address (Lit PKP or EOA)
    address public agent;

    /// @notice Fee recipient for performance and management fees
    address public feeRecipient;

    /// @notice Performance fee in basis points (e.g., 500 = 5%)
    uint256 public performanceFeeBps;

    /// @notice High water mark for total assets (fee only taken on new profits above this)
    uint256 public highWaterMark;

    /// @notice Total USDC currently borrowed by the agent for trading
    uint256 public totalBorrowed;

    /// @notice Maximum total assets the vault will accept
    uint256 public maxTotalAssets;

    /// @notice Minimum lock time before withdrawal (anti-flash-loan)
    uint256 public minLockTime;

    /// @notice Deposit timestamp per user for lock enforcement
    mapping(address => uint256) public depositTimestamp;

    /// @notice Management fee in basis points (e.g., 100 = 1% annual)
    uint256 public managementFeeBps = 100;

    /// @notice Timestamp of last management fee collection
    uint256 public lastFeeCollection;

    // ----------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------

    event AgentUpdated(address indexed oldAgent, address indexed newAgent);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event AgentBorrowed(uint256 amount, uint256 totalBorrowed);
    event AgentReturned(uint256 amount, uint256 totalBorrowed);
    event PerformanceFeeCollected(uint256 feeShares, uint256 profitAmount);
    event ManagementFeeCollected(uint256 feeShares, uint256 feeAmount);
    event ManagementFeeBpsUpdated(uint256 oldBps, uint256 newBps);
    event MaxTotalAssetsUpdated(uint256 oldMax, uint256 newMax);
    event MinLockTimeUpdated(uint256 oldLock, uint256 newLock);
    event EmergencyWithdrawal(address indexed user, uint256 shares, uint256 assets);

    // ----------------------------------------------------------------
    // Errors
    // ----------------------------------------------------------------

    error Unauthorized();
    error LockTimeNotElapsed(uint256 depositTime, uint256 unlockTime);
    error MaxAssetsExceeded(uint256 requested, uint256 max);
    error InsufficientVaultBalance(uint256 requested, uint256 available);
    error ZeroAddress();
    error ZeroAmount();

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

    /// @param _asset The underlying asset (USDC address)
    /// @param _owner The vault owner
    /// @param _agent The initial agent address
    /// @param _feeRecipient The performance fee recipient
    constructor(
        IERC20 _asset,
        address _owner,
        address _agent,
        address _feeRecipient
    )
        ERC4626(_asset)
        ERC20("DarwinFi Vault USDC V3", "dvUSDC")
        Ownable(_owner)
    {
        if (_agent == address(0)) revert ZeroAddress();
        if (_feeRecipient == address(0)) revert ZeroAddress();

        agent = _agent;
        feeRecipient = _feeRecipient;
        performanceFeeBps = 500; // 5%
        maxTotalAssets = 10_000 * 1e6; // 10,000 USDC (6 decimals)
        minLockTime = 1 hours;
        lastFeeCollection = block.timestamp;
    }

    // ----------------------------------------------------------------
    // ERC-4626 Overrides
    // ----------------------------------------------------------------

    /// @notice Total assets includes USDC in vault + USDC borrowed by agent
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + totalBorrowed;
    }

    /// @notice Cap max deposits based on maxTotalAssets
    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) return 0;
        uint256 current = totalAssets();
        if (current >= maxTotalAssets) return 0;
        return maxTotalAssets - current;
    }

    /// @notice Cap max mint based on maxTotalAssets
    function maxMint(address) public view override returns (uint256) {
        if (paused()) return 0;
        uint256 maxDep = maxDeposit(address(0));
        if (maxDep == 0) return 0;
        return convertToShares(maxDep);
    }

    /// @dev Override deposit to enforce cap and record timestamp. Paused check via maxDeposit.
    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        uint256 maxAssets = maxDeposit(receiver);
        if (assets > maxAssets) revert MaxAssetsExceeded(assets, maxAssets);

        depositTimestamp[receiver] = block.timestamp;
        return super.deposit(assets, receiver);
    }

    /// @dev Override mint to enforce cap and record timestamp.
    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        uint256 assets = previewMint(shares);
        uint256 maxAssets = maxDeposit(receiver);
        if (assets > maxAssets) revert MaxAssetsExceeded(assets, maxAssets);

        depositTimestamp[receiver] = block.timestamp;
        return super.mint(shares, receiver);
    }

    /// @notice Returns 0 if the owner's lock time hasn't elapsed, otherwise delegates to ERC-4626 default.
    function maxWithdraw(address owner_) public view override returns (uint256) {
        uint256 depTime = depositTimestamp[owner_];
        if (depTime > 0 && block.timestamp < depTime + minLockTime) {
            return 0;
        }
        return super.maxWithdraw(owner_);
    }

    /// @notice Returns 0 if the owner's lock time hasn't elapsed, otherwise delegates to ERC-4626 default.
    function maxRedeem(address owner_) public view override returns (uint256) {
        uint256 depTime = depositTimestamp[owner_];
        if (depTime > 0 && block.timestamp < depTime + minLockTime) {
            return 0;
        }
        return super.maxRedeem(owner_);
    }

    /// @dev Override withdraw to enforce lock time
    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256)
    {
        _enforceLockTime(owner_);
        return super.withdraw(assets, receiver, owner_);
    }

    /// @dev Override redeem to enforce lock time
    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256)
    {
        _enforceLockTime(owner_);
        return super.redeem(shares, receiver, owner_);
    }

    // ----------------------------------------------------------------
    // Agent: Borrow / Return
    // ----------------------------------------------------------------

    /// @notice Agent borrows USDC from the vault for trading
    /// @param amount The USDC amount to borrow
    function agentBorrow(uint256 amount) external onlyAgent nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = IERC20(asset()).balanceOf(address(this));
        if (amount > available) revert InsufficientVaultBalance(amount, available);

        totalBorrowed += amount;
        IERC20(asset()).safeTransfer(agent, amount);

        emit AgentBorrowed(amount, totalBorrowed);
    }

    /// @notice Agent returns USDC after trading (proceeds may be > or < borrowed amount)
    /// @param amount The USDC amount being returned
    function agentReturn(uint256 amount) external onlyAgent nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // Auto-collect management fee on every return
        _collectManagementFeeInternal();

        // Transfer USDC from agent back to vault
        IERC20(asset()).safeTransferFrom(agent, address(this), amount);

        // Reduce totalBorrowed (cap at 0 if returning more than borrowed)
        if (amount >= totalBorrowed) {
            uint256 profit = amount - totalBorrowed;
            totalBorrowed = 0;

            // Collect performance fee on profit above high water mark
            if (profit > 0) {
                _collectPerformanceFee(profit);
            }
        } else {
            totalBorrowed -= amount;
        }

        emit AgentReturned(amount, totalBorrowed);
    }

    // ----------------------------------------------------------------
    // Management Fee
    // ----------------------------------------------------------------

    /// @notice Collect accrued management fee. Mints shares to feeRecipient.
    function collectManagementFee() public {
        _collectManagementFeeInternal();
    }

    /// @notice Set management fee basis points (max 500 = 5%)
    function setManagementFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= 500, "Management fee too high");
        // Collect any pending fee before updating rate
        _collectManagementFeeInternal();
        uint256 oldBps = managementFeeBps;
        emit ManagementFeeBpsUpdated(oldBps, _bps);
        managementFeeBps = _bps;
    }

    // ----------------------------------------------------------------
    // Emergency Withdraw (always available, even when paused)
    // ----------------------------------------------------------------

    /// @notice Emergency withdraw: burns all shares for proportional USDC.
    ///         Always available regardless of pause state. Ignores lock time.
    function emergencyWithdraw() external nonReentrant {
        uint256 shares = balanceOf(msg.sender);
        if (shares == 0) revert ZeroAmount();

        uint256 assets = convertToAssets(shares);

        // Cap at available USDC in vault (some may be borrowed by agent)
        uint256 available = IERC20(asset()).balanceOf(address(this));
        if (assets > available) {
            assets = available;
        }

        _burn(msg.sender, shares);
        IERC20(asset()).safeTransfer(msg.sender, assets);

        // Emit standard ERC-4626 Withdraw event for integrator compatibility
        emit Withdraw(msg.sender, msg.sender, msg.sender, assets, shares);
        emit EmergencyWithdrawal(msg.sender, shares, assets);
    }

    // ----------------------------------------------------------------
    // Owner: Configuration
    // ----------------------------------------------------------------

    /// @notice Set the agent address (Lit PKP or EOA)
    function setAgent(address _agent) external onlyOwner {
        if (_agent == address(0)) revert ZeroAddress();
        address old = agent;
        agent = _agent;
        emit AgentUpdated(old, _agent);
    }

    /// @notice Set the fee recipient
    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        address old = feeRecipient;
        feeRecipient = _feeRecipient;
        emit FeeRecipientUpdated(old, _feeRecipient);
    }

    /// @notice Set the performance fee (in basis points, max 2000 = 20%)
    function setPerformanceFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= 2000, "Fee too high");
        performanceFeeBps = _bps;
    }

    /// @notice Set maximum total assets
    function setMaxTotalAssets(uint256 _max) external onlyOwner {
        uint256 old = maxTotalAssets;
        maxTotalAssets = _max;
        emit MaxTotalAssetsUpdated(old, _max);
    }

    /// @notice Set minimum lock time
    function setMinLockTime(uint256 _lockTime) external onlyOwner {
        uint256 old = minLockTime;
        minLockTime = _lockTime;
        emit MinLockTimeUpdated(old, _lockTime);
    }

    /// @notice Pause deposits
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause deposits
    function unpause() external onlyOwner {
        _unpause();
    }

    // ----------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------

    /// @notice Get the share price (assets per share) scaled to 1e6 for USDC precision
    function sharePrice() external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e6; // 1:1 when empty
        return (totalAssets() * 1e6) / supply;
    }

    /// @notice Get available (non-borrowed) USDC in vault
    function availableAssets() external view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    // ----------------------------------------------------------------
    // Internal
    // ----------------------------------------------------------------

    function _enforceLockTime(address owner_) internal view {
        uint256 depTime = depositTimestamp[owner_];
        if (depTime > 0 && block.timestamp < depTime + minLockTime) {
            revert LockTimeNotElapsed(depTime, depTime + minLockTime);
        }
    }

    function _collectPerformanceFee(uint256 profit) internal {
        uint256 currentAssets = totalAssets();

        // Only charge fee on profit above high water mark
        uint256 feeableProfit;
        if (currentAssets > highWaterMark) {
            feeableProfit = currentAssets - highWaterMark;
            // Cap feeable profit to actual profit from this return
            if (feeableProfit > profit) {
                feeableProfit = profit;
            }
            highWaterMark = currentAssets;
        } else {
            return; // No fee if below high water mark
        }

        if (feeableProfit == 0) return;

        uint256 feeAmount = (feeableProfit * performanceFeeBps) / 10000;
        if (feeAmount == 0) return;

        // Mint fee as shares to fee recipient (dilutes other shareholders slightly)
        uint256 feeShares = convertToShares(feeAmount);
        if (feeShares > 0) {
            _mint(feeRecipient, feeShares);
            emit PerformanceFeeCollected(feeShares, feeableProfit);
        }
    }

    function _collectManagementFeeInternal() internal {
        if (lastFeeCollection == 0) {
            lastFeeCollection = block.timestamp;
            return;
        }

        uint256 elapsed = block.timestamp - lastFeeCollection;
        if (elapsed == 0) return;

        uint256 _totalAssets = totalAssets();
        if (_totalAssets == 0) {
            lastFeeCollection = block.timestamp;
            return;
        }

        uint256 feeAmount = (_totalAssets * managementFeeBps * elapsed) / (10000 * 365 days);
        lastFeeCollection = block.timestamp;

        if (feeAmount == 0) return;

        uint256 supply = totalSupply();
        if (supply == 0) return;

        // Mint equivalent shares to feeRecipient
        uint256 feeShares = convertToShares(feeAmount);
        if (feeShares > 0) {
            _mint(feeRecipient, feeShares);
            emit ManagementFeeCollected(feeShares, feeAmount);
        }
    }
}

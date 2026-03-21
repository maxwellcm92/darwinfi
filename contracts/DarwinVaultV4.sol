// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title DarwinVaultV4
/// @notice Security-hardened ERC-4626 vault for DarwinFi. Fixes 6 audit findings from V3:
///         C-01: 48-hour timelock on agent/feeRecipient changes
///         C-02: Proportional emergency withdrawal (no share burning beyond available USDC)
///         H-01: Max borrow ratio cap (default 80%, ceiling 90%)
///         H-02: Decimals offset for inflation attack mitigation
///         M-01: Borrow timeout with bad debt write-off
///         M-02: Lock time cap (max 7 days)
contract DarwinVaultV4 is ERC4626, Ownable, ReentrancyGuard, Pausable {
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

    // C-01: Timelock state
    uint256 public constant TIMELOCK_DURATION = 48 hours;
    address public pendingAgent;
    uint256 public pendingAgentTimestamp;
    address public pendingFeeRecipient;
    uint256 public pendingFeeRecipientTimestamp;

    // Fee parameter timelocks
    uint256 public pendingPerformanceFeeBps;
    uint256 public pendingPerformanceFeeBpsTimestamp;
    uint256 public pendingManagementFeeBps;
    uint256 public pendingManagementFeeBpsTimestamp;

    // H-01: Max borrow ratio
    uint256 public constant MAX_BORROW_RATIO = 9000; // 90% ceiling
    uint256 public maxBorrowRatioBps;                 // default 8000 = 80%

    // M-01: Borrow timeout
    uint256 public lastBorrowTimestamp;
    uint256 public maxBorrowDuration;                 // default 7 days

    // M-02: Lock time cap
    uint256 public constant MAX_LOCK_TIME = 7 days;

    // ----------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------

    // C-01: Timelock events
    event PendingAgentSet(address indexed newAgent, uint256 readyAt);
    event AgentConfirmed(address indexed oldAgent, address indexed newAgent);
    event PendingAgentCancelled(address indexed cancelledAgent);
    event PendingFeeRecipientSet(address indexed newFeeRecipient, uint256 readyAt);
    event FeeRecipientConfirmed(address indexed oldRecipient, address indexed newRecipient);
    event PendingFeeRecipientCancelled(address indexed cancelledRecipient);

    // Fee parameter timelock events
    event PendingPerformanceFeeBpsSet(uint256 newBps, uint256 readyAt);
    event PerformanceFeeBpsConfirmed(uint256 oldBps, uint256 newBps);
    event PendingPerformanceFeeBpsCancelled(uint256 cancelledBps);
    event PendingManagementFeeBpsSet(uint256 newBps, uint256 readyAt);
    event ManagementFeeBpsConfirmed(uint256 oldBps, uint256 newBps);
    event PendingManagementFeeBpsCancelled(uint256 cancelledBps);

    // H-01: Borrow ratio events
    event MaxBorrowRatioBpsUpdated(uint256 oldRatio, uint256 newRatio);

    // M-01: Borrow timeout events
    event MaxBorrowDurationUpdated(uint256 oldDuration, uint256 newDuration);
    event BadDebtWrittenOff(uint256 amount);

    // Preserved from V3
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

    // C-01: Timelock errors
    error TimelockNotElapsed(uint256 readyAt);
    error NoPendingChange();

    // C-02: Emergency withdraw rounding
    error WithdrawalTooSmall();

    // H-01: Borrow ratio errors
    error BorrowRatioExceeded(uint256 resultingRatio, uint256 maxRatio);
    error BorrowRatioTooHigh(uint256 requested, uint256 max);

    // M-01: Borrow timeout errors
    error BorrowNotTimedOut();
    error NoBadDebt();

    // M-02: Lock time cap errors
    error LockTimeTooLong(uint256 requested, uint256 max);

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
        ERC20("DarwinFi Vault USDC V4", "dvUSDC")
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
        maxBorrowRatioBps = 8000; // 80% default
        maxBorrowDuration = 7 days;
    }

    // ----------------------------------------------------------------
    // H-02: Decimals Offset (inflation attack mitigation)
    // ----------------------------------------------------------------

    /// @dev Virtual shares offset to mitigate ERC-4626 inflation attacks.
    ///      With USDC (6 decimals) + offset 6 = 12 decimal shares.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
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

        // H-01: Enforce max borrow ratio
        uint256 newTotalBorrowed = totalBorrowed + amount;
        uint256 _totalAssets = totalAssets();
        if (_totalAssets > 0) {
            uint256 resultingRatio = (newTotalBorrowed * 10000) / _totalAssets;
            if (resultingRatio > maxBorrowRatioBps) revert BorrowRatioExceeded(resultingRatio, maxBorrowRatioBps);
        }

        totalBorrowed = newTotalBorrowed;

        // M-01: Track borrow timestamp
        lastBorrowTimestamp = block.timestamp;

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

            // M-01: Reset borrow timestamp when fully repaid
            lastBorrowTimestamp = 0;

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

    /// @notice Initiate management fee change (starts 48h timelock, max 500 = 5%)
    function setManagementFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= 500, "Management fee too high");
        pendingManagementFeeBps = _bps;
        pendingManagementFeeBpsTimestamp = block.timestamp;
        emit PendingManagementFeeBpsSet(_bps, block.timestamp + TIMELOCK_DURATION);
    }

    /// @notice Confirm management fee change after timelock has elapsed
    function confirmManagementFeeBps() external onlyOwner {
        if (pendingManagementFeeBpsTimestamp == 0) revert NoPendingChange();
        if (block.timestamp < pendingManagementFeeBpsTimestamp + TIMELOCK_DURATION) {
            revert TimelockNotElapsed(pendingManagementFeeBpsTimestamp + TIMELOCK_DURATION);
        }
        // Collect any pending fee before updating rate
        _collectManagementFeeInternal();
        uint256 oldBps = managementFeeBps;
        managementFeeBps = pendingManagementFeeBps;
        pendingManagementFeeBps = 0;
        pendingManagementFeeBpsTimestamp = 0;
        emit ManagementFeeBpsUpdated(oldBps, managementFeeBps);
    }

    /// @notice Cancel a pending management fee change
    function cancelPendingManagementFeeBps() external onlyOwner {
        if (pendingManagementFeeBpsTimestamp == 0) revert NoPendingChange();
        uint256 cancelled = pendingManagementFeeBps;
        pendingManagementFeeBps = 0;
        pendingManagementFeeBpsTimestamp = 0;
        emit PendingManagementFeeBpsCancelled(cancelled);
    }

    // ----------------------------------------------------------------
    // C-02: Proportional Emergency Withdraw
    // ----------------------------------------------------------------

    /// @notice Emergency withdraw: proportional to available USDC.
    ///         If agent has borrowed, user burns only the shares corresponding to
    ///         available USDC and retains remaining shares as a claim on borrowed funds.
    ///         Always available regardless of pause state. Ignores lock time.
    function emergencyWithdraw() external nonReentrant {
        uint256 shares = balanceOf(msg.sender);
        if (shares == 0) revert ZeroAmount();

        uint256 assets = convertToAssets(shares);
        uint256 available = IERC20(asset()).balanceOf(address(this));

        if (assets <= available) {
            // Full withdrawal -- burn all shares, send all assets
            _burn(msg.sender, shares);
            IERC20(asset()).safeTransfer(msg.sender, assets);

            emit Withdraw(msg.sender, msg.sender, msg.sender, assets, shares);
            emit EmergencyWithdrawal(msg.sender, shares, assets);
        } else if (available > 0) {
            // Partial withdrawal -- burn proportional shares, send available USDC
            uint256 sharesToBurn = (shares * available) / assets;
            if (sharesToBurn == 0) revert WithdrawalTooSmall();
            _burn(msg.sender, sharesToBurn);
            IERC20(asset()).safeTransfer(msg.sender, available);

            emit Withdraw(msg.sender, msg.sender, msg.sender, available, sharesToBurn);
            emit EmergencyWithdrawal(msg.sender, sharesToBurn, available);
        }
        // If available == 0: do nothing (no USDC to give, user keeps all shares)
    }

    // ----------------------------------------------------------------
    // C-01: Timelock -- Agent
    // ----------------------------------------------------------------

    /// @notice Initiate agent change (starts 48h timelock)
    function setAgent(address _agent) external onlyOwner {
        if (_agent == address(0)) revert ZeroAddress();
        pendingAgent = _agent;
        pendingAgentTimestamp = block.timestamp;
        emit PendingAgentSet(_agent, block.timestamp + TIMELOCK_DURATION);
    }

    /// @notice Confirm agent change after timelock has elapsed
    function confirmAgent() external onlyOwner {
        if (pendingAgent == address(0)) revert NoPendingChange();
        if (block.timestamp < pendingAgentTimestamp + TIMELOCK_DURATION) {
            revert TimelockNotElapsed(pendingAgentTimestamp + TIMELOCK_DURATION);
        }
        address oldAgent = agent;
        agent = pendingAgent;
        pendingAgent = address(0);
        pendingAgentTimestamp = 0;
        emit AgentConfirmed(oldAgent, agent);
    }

    /// @notice Cancel a pending agent change
    function cancelPendingAgent() external onlyOwner {
        if (pendingAgent == address(0)) revert NoPendingChange();
        address cancelled = pendingAgent;
        pendingAgent = address(0);
        pendingAgentTimestamp = 0;
        emit PendingAgentCancelled(cancelled);
    }

    // ----------------------------------------------------------------
    // C-01: Timelock -- Fee Recipient
    // ----------------------------------------------------------------

    /// @notice Initiate fee recipient change (starts 48h timelock)
    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        pendingFeeRecipient = _feeRecipient;
        pendingFeeRecipientTimestamp = block.timestamp;
        emit PendingFeeRecipientSet(_feeRecipient, block.timestamp + TIMELOCK_DURATION);
    }

    /// @notice Confirm fee recipient change after timelock has elapsed
    function confirmFeeRecipient() external onlyOwner {
        if (pendingFeeRecipient == address(0)) revert NoPendingChange();
        if (block.timestamp < pendingFeeRecipientTimestamp + TIMELOCK_DURATION) {
            revert TimelockNotElapsed(pendingFeeRecipientTimestamp + TIMELOCK_DURATION);
        }
        address oldRecipient = feeRecipient;
        feeRecipient = pendingFeeRecipient;
        pendingFeeRecipient = address(0);
        pendingFeeRecipientTimestamp = 0;
        emit FeeRecipientConfirmed(oldRecipient, feeRecipient);
    }

    /// @notice Cancel a pending fee recipient change
    function cancelPendingFeeRecipient() external onlyOwner {
        if (pendingFeeRecipient == address(0)) revert NoPendingChange();
        address cancelled = pendingFeeRecipient;
        pendingFeeRecipient = address(0);
        pendingFeeRecipientTimestamp = 0;
        emit PendingFeeRecipientCancelled(cancelled);
    }

    // ----------------------------------------------------------------
    // Owner: Configuration
    // ----------------------------------------------------------------

    /// @notice Initiate performance fee change (starts 48h timelock, max 2000 = 20%)
    function setPerformanceFeeBps(uint256 _bps) external onlyOwner {
        require(_bps <= 2000, "Fee too high");
        pendingPerformanceFeeBps = _bps;
        pendingPerformanceFeeBpsTimestamp = block.timestamp;
        emit PendingPerformanceFeeBpsSet(_bps, block.timestamp + TIMELOCK_DURATION);
    }

    /// @notice Confirm performance fee change after timelock has elapsed
    function confirmPerformanceFeeBps() external onlyOwner {
        if (pendingPerformanceFeeBpsTimestamp == 0) revert NoPendingChange();
        if (block.timestamp < pendingPerformanceFeeBpsTimestamp + TIMELOCK_DURATION) {
            revert TimelockNotElapsed(pendingPerformanceFeeBpsTimestamp + TIMELOCK_DURATION);
        }
        uint256 oldBps = performanceFeeBps;
        performanceFeeBps = pendingPerformanceFeeBps;
        pendingPerformanceFeeBps = 0;
        pendingPerformanceFeeBpsTimestamp = 0;
        emit PerformanceFeeBpsConfirmed(oldBps, performanceFeeBps);
    }

    /// @notice Cancel a pending performance fee change
    function cancelPendingPerformanceFeeBps() external onlyOwner {
        if (pendingPerformanceFeeBpsTimestamp == 0) revert NoPendingChange();
        uint256 cancelled = pendingPerformanceFeeBps;
        pendingPerformanceFeeBps = 0;
        pendingPerformanceFeeBpsTimestamp = 0;
        emit PendingPerformanceFeeBpsCancelled(cancelled);
    }

    /// @notice Set maximum total assets
    function setMaxTotalAssets(uint256 _max) external onlyOwner {
        uint256 old = maxTotalAssets;
        maxTotalAssets = _max;
        emit MaxTotalAssetsUpdated(old, _max);
    }

    /// @notice Set minimum lock time (M-02: capped at MAX_LOCK_TIME)
    function setMinLockTime(uint256 _lockTime) external onlyOwner {
        if (_lockTime > MAX_LOCK_TIME) revert LockTimeTooLong(_lockTime, MAX_LOCK_TIME);
        uint256 old = minLockTime;
        minLockTime = _lockTime;
        emit MinLockTimeUpdated(old, _lockTime);
    }

    /// @notice H-01: Set max borrow ratio in basis points (capped at MAX_BORROW_RATIO = 90%)
    function setMaxBorrowRatioBps(uint256 _ratioBps) external onlyOwner {
        if (_ratioBps > MAX_BORROW_RATIO) revert BorrowRatioTooHigh(_ratioBps, MAX_BORROW_RATIO);
        uint256 old = maxBorrowRatioBps;
        maxBorrowRatioBps = _ratioBps;
        emit MaxBorrowRatioBpsUpdated(old, _ratioBps);
    }

    /// @notice M-01: Set max borrow duration
    function setMaxBorrowDuration(uint256 _duration) external onlyOwner {
        uint256 old = maxBorrowDuration;
        maxBorrowDuration = _duration;
        emit MaxBorrowDurationUpdated(old, _duration);
    }

    /// @notice M-01: Write off bad debt after borrow timeout. Callable by anyone.
    ///         Zeros totalBorrowed so depositors can withdraw remaining USDC.
    function writeOffBadDebt() external {
        if (totalBorrowed == 0) revert NoBadDebt();
        if (lastBorrowTimestamp == 0) revert NoBadDebt();
        if (block.timestamp < lastBorrowTimestamp + maxBorrowDuration) revert BorrowNotTimedOut();

        uint256 amount = totalBorrowed;
        totalBorrowed = 0;
        lastBorrowTimestamp = 0;

        emit BadDebtWrittenOff(amount);
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

    /// @notice Get the share price (assets per share) scaled to 1e6 for USDC precision.
    ///         With _decimalsOffset()=6, shares have 12 decimals, so we scale by 1e12.
    function sharePrice() external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e6; // 1:1 when empty
        return (totalAssets() * 1e12) / supply;
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

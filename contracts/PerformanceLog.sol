// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PerformanceLog
/// @notice On-chain performance logging for the DarwinFi autonomous trading agent.
///         Records trade results, evolution events (strategy promotion/demotion),
///         and strategy genome hashes for IPFS verification. Data is stored primarily
///         via events (cheap) with minimal on-chain state for current generation tracking.
contract PerformanceLog is Ownable {
    // ----------------------------------------------------------------
    // State
    // ----------------------------------------------------------------

    /// @notice The current evolution generation number.
    uint256 public currentGeneration;

    /// @notice Authorized addresses that can write logs (agent, executor, owner).
    mapping(address => bool) public authorizedLoggers;

    /// @notice Latest genome hash per strategy (for quick on-chain lookup).
    ///         strategyGenomeHash[strategyId] = keccak256 of the genome JSON.
    mapping(uint256 => bytes32) public strategyGenomeHash;

    /// @notice Cumulative trade count per strategy.
    mapping(uint256 => uint256) public strategyTradeCount;

    /// @notice Cumulative wins per strategy.
    mapping(uint256 => uint256) public strategyWinCount;

    /// @notice Cumulative PnL per strategy (can be negative, stored as int256).
    mapping(uint256 => int256) public strategyCumulativePnL;

    /// @notice Strategy status: true = active, false = inactive/demoted.
    mapping(uint256 => bool) public strategyActive;

    // ----------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------

    /// @notice Emitted when a trade result is logged.
    event TradeResultLogged(
        uint256 indexed strategyId,
        int256 pnl,
        bool win,
        uint256 indexed generation,
        uint256 timestamp
    );

    /// @notice Emitted when a strategy is promoted (selected as top performer).
    event StrategyPromoted(
        uint256 indexed strategyId,
        uint256 indexed generation,
        string reason,
        uint256 timestamp
    );

    /// @notice Emitted when a strategy is demoted (replaced by a new mutation).
    event StrategyDemoted(
        uint256 indexed strategyId,
        uint256 indexed generation,
        string reason,
        uint256 timestamp
    );

    /// @notice Emitted when a new generation begins (evolution cycle).
    event GenerationAdvanced(
        uint256 indexed oldGeneration,
        uint256 indexed newGeneration,
        uint256 timestamp
    );

    /// @notice Emitted when a strategy genome hash is recorded.
    event GenomeHashRecorded(
        uint256 indexed strategyId,
        bytes32 indexed genomeHash,
        string ipfsCid,
        uint256 indexed generation,
        uint256 timestamp
    );

    /// @notice Emitted when a logger is added or removed.
    event LoggerUpdated(address indexed logger, bool authorized);

    // ----------------------------------------------------------------
    // Errors
    // ----------------------------------------------------------------

    error Unauthorized();
    error ZeroAddress();

    // ----------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------

    modifier onlyLogger() {
        if (!authorizedLoggers[msg.sender] && msg.sender != owner()) revert Unauthorized();
        _;
    }

    // ----------------------------------------------------------------
    // Constructor
    // ----------------------------------------------------------------

    /// @param _owner The contract owner.
    constructor(address _owner) Ownable(_owner) {
        currentGeneration = 1;
        // Owner is implicitly a logger via the onlyLogger check.
    }

    // ----------------------------------------------------------------
    // Owner: Logger Management
    // ----------------------------------------------------------------

    /// @notice Add or remove an authorized logger.
    /// @param logger The address to authorize/deauthorize.
    /// @param authorized Whether the address should be allowed to write logs.
    function setLogger(address logger, bool authorized) external onlyOwner {
        if (logger == address(0)) revert ZeroAddress();
        authorizedLoggers[logger] = authorized;
        emit LoggerUpdated(logger, authorized);
    }

    // ----------------------------------------------------------------
    // Logging: Trade Results
    // ----------------------------------------------------------------

    /// @notice Log the result of a single trade.
    /// @param strategyId The strategy that executed the trade.
    /// @param pnl The profit/loss in base units (positive = profit, negative = loss).
    /// @param win Whether this trade was profitable.
    function logTradeResult(
        uint256 strategyId,
        int256 pnl,
        bool win
    ) external onlyLogger {
        strategyTradeCount[strategyId]++;
        strategyCumulativePnL[strategyId] += pnl;
        if (win) {
            strategyWinCount[strategyId]++;
        }

        emit TradeResultLogged(
            strategyId,
            pnl,
            win,
            currentGeneration,
            block.timestamp
        );
    }

    // ----------------------------------------------------------------
    // Logging: Evolution Events
    // ----------------------------------------------------------------

    /// @notice Record that a strategy was promoted (top performer in Darwinian selection).
    /// @param strategyId The promoted strategy.
    /// @param reason Human-readable reason (e.g., "highest Sharpe ratio in gen 3").
    function logPromotion(uint256 strategyId, string calldata reason) external onlyLogger {
        strategyActive[strategyId] = true;
        emit StrategyPromoted(strategyId, currentGeneration, reason, block.timestamp);
    }

    /// @notice Record that a strategy was demoted (replaced by mutation).
    /// @param strategyId The demoted strategy.
    /// @param reason Human-readable reason.
    function logDemotion(uint256 strategyId, string calldata reason) external onlyLogger {
        strategyActive[strategyId] = false;
        emit StrategyDemoted(strategyId, currentGeneration, reason, block.timestamp);
    }

    /// @notice Advance to the next evolution generation.
    /// @dev Call this at the end of each evolution cycle.
    function advanceGeneration() external onlyLogger {
        uint256 oldGen = currentGeneration;
        currentGeneration = oldGen + 1;
        emit GenerationAdvanced(oldGen, currentGeneration, block.timestamp);
    }

    // ----------------------------------------------------------------
    // Logging: Genome Hashes
    // ----------------------------------------------------------------

    /// @notice Record a strategy's genome hash for verification against its IPFS copy.
    /// @param strategyId The strategy whose genome is being recorded.
    /// @param genomeHash The keccak256 hash of the genome JSON.
    /// @param ipfsCid The IPFS content identifier where the genome is pinned.
    function recordGenomeHash(
        uint256 strategyId,
        bytes32 genomeHash,
        string calldata ipfsCid
    ) external onlyLogger {
        strategyGenomeHash[strategyId] = genomeHash;
        emit GenomeHashRecorded(
            strategyId,
            genomeHash,
            ipfsCid,
            currentGeneration,
            block.timestamp
        );
    }

    // ----------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------

    /// @notice Get a strategy's performance summary.
    /// @param strategyId The strategy to query.
    /// @return tradeCount Total number of trades.
    /// @return winCount Number of winning trades.
    /// @return cumulativePnL Net profit/loss.
    /// @return winRate Win rate as basis points (0-10000).
    /// @return active Whether the strategy is currently active.
    function getStrategyStats(uint256 strategyId)
        external
        view
        returns (
            uint256 tradeCount,
            uint256 winCount,
            int256 cumulativePnL,
            uint256 winRate,
            bool active
        )
    {
        tradeCount = strategyTradeCount[strategyId];
        winCount = strategyWinCount[strategyId];
        cumulativePnL = strategyCumulativePnL[strategyId];
        active = strategyActive[strategyId];
        winRate = tradeCount > 0 ? (winCount * 10000) / tradeCount : 0;
    }

    /// @notice Verify a genome hash matches what was recorded on-chain.
    /// @param strategyId The strategy to check.
    /// @param genomeHash The hash to verify.
    /// @return valid True if the provided hash matches the on-chain record.
    function verifyGenomeHash(uint256 strategyId, bytes32 genomeHash) external view returns (bool valid) {
        valid = strategyGenomeHash[strategyId] == genomeHash;
    }
}

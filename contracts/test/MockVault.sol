// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Mock vault for StrategyExecutor tests. Implements spendToken and returnProceeds.
contract MockVault {
    using SafeERC20 for IERC20;

    function spendToken(uint256, address token, uint256 amount, address recipient) external {
        IERC20(token).safeTransfer(recipient, amount);
    }

    function returnProceeds(uint256, address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }
}

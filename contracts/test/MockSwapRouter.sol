// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Mock Uniswap V3 SwapRouter for testing. Returns amountOutMinimum as amountOut.
contract MockSwapRouter {
    using SafeERC20 for IERC20;

    /// @notice The output token to send (set before calling executeTrade)
    address public outputToken;
    uint256 public outputAmount;

    function setOutput(address _token, uint256 _amount) external {
        outputToken = _token;
        outputAmount = _amount;
    }

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256) {
        // Take tokenIn from caller
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        // Send outputAmount of tokenOut to recipient
        uint256 out = outputAmount > 0 ? outputAmount : params.amountOutMinimum;
        IERC20(params.tokenOut).safeTransfer(params.recipient, out);
        return out;
    }
}

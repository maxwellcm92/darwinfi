# DarwinFi On-Chain Trade Proof

**Date**: March 21, 2026
**Network**: Base Mainnet (Chain 8453)
**Vault**: V4 (`0x4a55DEEC24C6b5c1aa6301b43b4D9680c10491d7`)
**PerformanceLog**: `0x7d7433A4aD04D6AD85E82Ce43CC4535ADb2fc9c9`
**Agent/Deployer**: `0xb2db53Db9a2349186F0214BC3e1bF08a195570e3` (darwinfi.base.eth)

## Transaction Log

### Funding
| # | Action | Tx Hash | BaseScan |
|---|--------|---------|----------|
| 1 | USDC transfer from Kraken (51 USDC via Base) | `0x75725cf24337730829990fefaa214bee8d2429c7d8df0bbff5db4f65ab917416` | [View](https://basescan.org/tx/0x75725cf24337730829990fefaa214bee8d2429c7d8df0bbff5db4f65ab917416) |
| 2 | Approve USDC for V4 vault | `0x1fc8d767fc4240259a302e69238edb420f6aaa370014ee1211e03fbc7507eada` | [View](https://basescan.org/tx/0x1fc8d767fc4240259a302e69238edb420f6aaa370014ee1211e03fbc7507eada) |
| 3 | Deposit 50 USDC into V4 vault | `0xb942e7e3440b4f59303be0cfe87f59261fb8273e5f6255a945bcf24c84ed3af1` | [View](https://basescan.org/tx/0xb942e7e3440b4f59303be0cfe87f59261fb8273e5f6255a945bcf24c84ed3af1) |

### Trade Cycle 1 (3 USDC)
| # | Action | Tx Hash | BaseScan |
|---|--------|---------|----------|
| 4 | Agent borrow 3 USDC from vault | `0xd192bbd6b659bd9aa6a5199cbcd4bdf2fd5fe97ab7dd8d9d49c3df37f493119c` | [View](https://basescan.org/tx/0xd192bbd6b659bd9aa6a5199cbcd4bdf2fd5fe97ab7dd8d9d49c3df37f493119c) |
| 5 | Swap 3 USDC -> WETH (Uniswap V3) | `0x8a407a2b4fdc2c9053889db8b3d4942c262c5762d1e254d4c5f6ffd372abb6ff` | [View](https://basescan.org/tx/0x8a407a2b4fdc2c9053889db8b3d4942c262c5762d1e254d4c5f6ffd372abb6ff) |
| 6 | Swap WETH -> 2.997 USDC (Uniswap V3) | `0x231cd149391a4fa283dac52551620b68bf56fb8f0c9370b15f949fcfeea32c56` | [View](https://basescan.org/tx/0x231cd149391a4fa283dac52551620b68bf56fb8f0c9370b15f949fcfeea32c56) |
| 7 | Agent return 3 USDC to vault | `0xdd1a4dd5da76fe4fda7be23b8dbd16b40d5749e3bf3a929d2564f31f663b4339` | [View](https://basescan.org/tx/0xdd1a4dd5da76fe4fda7be23b8dbd16b40d5749e3bf3a929d2564f31f663b4339) |

### Trade Cycle 2 (5 USDC)
| # | Action | Tx Hash | BaseScan |
|---|--------|---------|----------|
| 8 | Agent borrow 5 USDC from vault | `0x0b1ed9494efbc4932f2ab8e3950696e37c8d6d16fae9b1331d672f841c3c58f9` | [View](https://basescan.org/tx/0x0b1ed9494efbc4932f2ab8e3950696e37c8d6d16fae9b1331d672f841c3c58f9) |
| 9 | Swap 5 USDC -> WETH (Uniswap V3) | `0x62d5b09d7ceec1282d1c300c757096fe5dfd347873946f48f8c840f7f4f3d876` | [View](https://basescan.org/tx/0x62d5b09d7ceec1282d1c300c757096fe5dfd347873946f48f8c840f7f4f3d876) |
| 10 | Wrap ETH -> WETH | `0xeeccc4ae5d3afdadbfa29b8b924a94b12cd8803e38cacb9960bcd773f614d77a` | [View](https://basescan.org/tx/0xeeccc4ae5d3afdadbfa29b8b924a94b12cd8803e38cacb9960bcd773f614d77a) |
| 11 | Swap WETH -> USDC (Uniswap V3) | `0xeb4ee0b0cd3cbb2b68fb33aebf8f77e2fd090305acf91c20662f234c77372ec4` | [View](https://basescan.org/tx/0xeb4ee0b0cd3cbb2b68fb33aebf8f77e2fd090305acf91c20662f234c77372ec4) |
| 12 | Agent return 5 USDC to vault | `0xe1bb254ef7db8b1d0923430096b9bf2f66df5d19bae26f675e68446649a860b5` | [View](https://basescan.org/tx/0xe1bb254ef7db8b1d0923430096b9bf2f66df5d19bae26f675e68446649a860b5) |

### PerformanceLog Entries
| # | Action | Tx Hash | BaseScan |
|---|--------|---------|----------|
| 13 | Log trade 1 result (strategy 1, -0.10% PnL) | `0x546e8f61cf042166e1aef48d396e9686f7a27eb976a384151c584b81cf62e1d3` | [View](https://basescan.org/tx/0x546e8f61cf042166e1aef48d396e9686f7a27eb976a384151c584b81cf62e1d3) |
| 14 | Log trade 2 result (strategy 1, -0.10% PnL) | `0x15e83888ef1cb4e5428d94d4e60438991738a45b4e6735a7b00d4e3f44c9ba76` | [View](https://basescan.org/tx/0x15e83888ef1cb4e5428d94d4e60438991738a45b4e6735a7b00d4e3f44c9ba76) |
| 15 | Advance generation to 42 | `0xd02f5bd96bc2aa1ae47358b35def801f7cbb65d5e7a11b5e65a6eeb1a1f52589` | [View](https://basescan.org/tx/0xd02f5bd96bc2aa1ae47358b35def801f7cbb65d5e7a11b5e65a6eeb1a1f52589) |

## Summary

- **Total transactions**: 19 (15 trade-related + 4 ENS text records on darwinfi.base.eth)
- **Unique on-chain actions**: Fund, deposit, 2 full borrow-swap-return cycles, PerformanceLog entries, 4 ENS text records
- **Volume traded**: 8 USDC across 4 Uniswap V3 swaps (USDC/WETH 0.05% pool)
- **DEX**: Uniswap V3 SwapRouter02 (`0x2626664c2603336E57B271c5C0b26F421741e481`)
- **Round-trip cost**: ~$0.05 (swap fees + slippage, gas negligible on Base)
- **PerformanceLog**: 2 trade results logged, generation advanced to 42
- **Vault state**: 50 USDC total assets, all borrowed funds returned

## Verification

All transactions can be independently verified on BaseScan:
- Vault: https://basescan.org/address/0x4a55DEEC24C6b5c1aa6301b43b4D9680c10491d7
- PerformanceLog: https://basescan.org/address/0x7d7433A4aD04D6AD85E82Ce43CC4535ADb2fc9c9
- Agent: https://basescan.org/address/0xb2db53Db9a2349186F0214BC3e1bF08a195570e3

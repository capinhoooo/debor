// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {DeBOROracle} from "../src/DeBOROracle.sol";
import {AdaptiveLending} from "../src/DeBORConsumer.sol";
import {DeBORSwap} from "../src/DeBORSwap.sol";

/// @notice Redeploy Oracles + Swap + Consumer after code changes
/// Unchanged contracts (AIInsight, PaymentGate, CCIP) keep existing addresses.
/// After deploy, call setAIInsight() on new Swap to connect AI risk guard.
///
/// Usage: source .env && forge script script/DeployOracleSwap.s.sol:DeployOracleSwap --rpc-url sepolia --broadcast --verify
contract DeployOracleSwap is Script {
    address constant CRE_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;
    address constant AI_INSIGHT = 0x8767630Fa001F380bE5d752969C4DE8D8D083083;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        // --- 5 Oracles (updated: RateManipulationDetected event) ---
        DeBOROracle usdcOracle = new DeBOROracle(CRE_FORWARDER);
        console.log("USDC Oracle:", address(usdcOracle));

        DeBOROracle ethOracle = new DeBOROracle(CRE_FORWARDER);
        console.log("ETH  Oracle:", address(ethOracle));

        DeBOROracle btcOracle = new DeBOROracle(CRE_FORWARDER);
        console.log("BTC  Oracle:", address(btcOracle));

        DeBOROracle daiOracle = new DeBOROracle(CRE_FORWARDER);
        console.log("DAI  Oracle:", address(daiOracle));

        DeBOROracle usdtOracle = new DeBOROracle(CRE_FORWARDER);
        console.log("USDT Oracle:", address(usdtOracle));

        // --- Consumer (points to new USDC oracle) ---
        AdaptiveLending consumer = new AdaptiveLending(address(usdcOracle));
        console.log("Consumer:   ", address(consumer));

        // --- Swap (updated: AI risk guard on createSwap) ---
        DeBORSwap swap = new DeBORSwap(address(usdcOracle), CRE_FORWARDER);
        console.log("Swap:       ", address(swap));

        // --- Connect AI insight to Swap ---
        swap.setAIInsight(AI_INSIGHT);
        console.log("Swap.aiInsight set to:", AI_INSIGHT);

        vm.stopBroadcast();
    }
}

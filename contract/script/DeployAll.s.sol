// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {DeBOROracle} from "../src/DeBOROracle.sol";
import {AdaptiveLending} from "../src/DeBORConsumer.sol";
import {DeBORSwap} from "../src/DeBORSwap.sol";
import {DeBORAIInsight} from "../src/DeBORAIInsight.sol";
import {DeBORPaymentGate} from "../src/DeBORPaymentGate.sol";

/// @notice Deploy all Sepolia-side contracts (oracles, consumer, swap, AI insight, payment gate)
/// Usage: source .env && forge script script/DeployAll.s.sol:DeployAllSepolia --rpc-url sepolia --broadcast --verify
contract DeployAllSepolia is Script {
    address constant CRE_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;
    address constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        // --- 5 Oracles ---
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

        // --- Consumer (points to USDC oracle) ---
        AdaptiveLending consumer = new AdaptiveLending(address(usdcOracle));
        console.log("Consumer:   ", address(consumer));

        // --- Swap (points to USDC oracle) ---
        DeBORSwap swap = new DeBORSwap(address(usdcOracle), CRE_FORWARDER);
        console.log("Swap:       ", address(swap));

        // --- AI Insight ---
        DeBORAIInsight aiInsight = new DeBORAIInsight(CRE_FORWARDER);
        console.log("AIInsight:  ", address(aiInsight));

        // --- Payment Gate (1 USDC per credit, deployer as treasury) ---
        DeBORPaymentGate paymentGate = new DeBORPaymentGate(SEPOLIA_USDC, 1_000_000, deployer);
        console.log("PaymentGate:", address(paymentGate));

        vm.stopBroadcast();
    }
}

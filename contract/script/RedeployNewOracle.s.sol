// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DeBOROracle} from "../src/DeBOROracle.sol";
import {AdaptiveLending} from "../src/DeBORConsumer.sol";

/// @notice Redeploy all 5 DeBOROracle instances + AdaptiveLending with updated 8-field sourcesConfigured support
/// Usage: forge script script/RedeployOracles.s.sol:RedeployOracles --rpc-url sepolia --broadcast --verify
contract RedeployOracles is Script {
    address constant SEPOLIA_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        // Deploy 5 oracle instances
        DeBOROracle usdcOracle = new DeBOROracle(SEPOLIA_FORWARDER);
        console.log("DeBOR-USDC Oracle:", address(usdcOracle));

        DeBOROracle ethOracle = new DeBOROracle(SEPOLIA_FORWARDER);
        console.log("DeBOR-ETH  Oracle:", address(ethOracle));

        DeBOROracle btcOracle = new DeBOROracle(SEPOLIA_FORWARDER);
        console.log("DeBOR-BTC  Oracle:", address(btcOracle));

        DeBOROracle daiOracle = new DeBOROracle(SEPOLIA_FORWARDER);
        console.log("DeBOR-DAI  Oracle:", address(daiOracle));

        DeBOROracle usdtOracle = new DeBOROracle(SEPOLIA_FORWARDER);
        console.log("DeBOR-USDT Oracle:", address(usdtOracle));

        // Deploy consumer pointing to new USDC oracle
        AdaptiveLending consumer = new AdaptiveLending(address(usdcOracle));
        console.log("AdaptiveLending:  ", address(consumer));

        vm.stopBroadcast();
    }
}

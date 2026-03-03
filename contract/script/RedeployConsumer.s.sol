// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AdaptiveLending} from "../src/DeBORConsumer.sol";

/// @notice Redeploy AdaptiveLending consumer with new risk functions (getRiskScore, getStressTestPnL, getSourceDiversityScore)
/// Usage: forge script script/RedeployConsumer.s.sol:RedeployConsumer --rpc-url sepolia --broadcast
contract RedeployConsumer is Script {
    // Existing USDC oracle on Sepolia (do NOT redeploy — has live data)
    address constant USDC_ORACLE = 0x80Be9b18DCb40E216682aA8972b64F93a4716FE6;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        AdaptiveLending consumer = new AdaptiveLending(USDC_ORACLE);
        console.log("AdaptiveLending deployed at:", address(consumer));

        vm.stopBroadcast();
    }
}

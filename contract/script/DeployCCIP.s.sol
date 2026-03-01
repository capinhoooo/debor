// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {DeBORCCIPSender} from "../src/DeBORCCIPSender.sol";
import {DeBORCCIPReceiver} from "../src/DeBORCCIPReceiver.sol";

/// @notice Deploy DeBORCCIPSender on Sepolia
/// Usage: forge script script/DeployCCIP.s.sol:DeploySender --rpc-url sepolia --broadcast --verify
contract DeploySender is Script {
    address constant SEPOLIA_ROUTER = 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        DeBORCCIPSender sender = new DeBORCCIPSender(SEPOLIA_ROUTER);
        console.log("DeBORCCIPSender deployed:", address(sender));

        vm.stopBroadcast();
    }
}

/// @notice Deploy DeBORCCIPReceiver on Base Sepolia
/// Usage: forge script script/DeployCCIP.s.sol:DeployReceiverBase --rpc-url base_sepolia --broadcast --verify
contract DeployReceiverBase is Script {
    address constant BASE_SEPOLIA_ROUTER = 0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93;
    uint64 constant SEPOLIA_SELECTOR = 16015286601757825753;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address senderAddress = vm.envAddress("CCIP_SENDER");

        vm.startBroadcast(pk);

        DeBORCCIPReceiver receiver = new DeBORCCIPReceiver(
            BASE_SEPOLIA_ROUTER,
            SEPOLIA_SELECTOR,
            senderAddress
        );
        console.log("DeBORCCIPReceiver (Base Sepolia) deployed:", address(receiver));

        vm.stopBroadcast();
    }
}

/// @notice Deploy DeBORCCIPReceiver on Arbitrum Sepolia
/// Usage: forge script script/DeployCCIP.s.sol:DeployReceiverArb --rpc-url arb_sepolia --broadcast --verify
contract DeployReceiverArb is Script {
    address constant ARB_SEPOLIA_ROUTER = 0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165;
    uint64 constant SEPOLIA_SELECTOR = 16015286601757825753;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address senderAddress = vm.envAddress("CCIP_SENDER");

        vm.startBroadcast(pk);

        DeBORCCIPReceiver receiver = new DeBORCCIPReceiver(
            ARB_SEPOLIA_ROUTER,
            SEPOLIA_SELECTOR,
            senderAddress
        );
        console.log("DeBORCCIPReceiver (Arb Sepolia) deployed:", address(receiver));

        vm.stopBroadcast();
    }
}

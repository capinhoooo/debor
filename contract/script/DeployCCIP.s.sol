// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {DeBORCCIPSender} from "../src/DeBORCCIPSender.sol";
import {DeBORCCIPReceiver} from "../src/DeBORCCIPReceiver.sol";

/// @notice Deploy DeBORCCIPSender on Sepolia
/// Usage: forge script script/DeployCCIP.s.sol:DeploySender --rpc-url sepolia --broadcast --verify
contract DeploySender is Script {
    // Sepolia CCIP Router
    address constant SEPOLIA_ROUTER = 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59;
    // CRE Forwarder address on Sepolia
    address constant CRE_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        DeBORCCIPSender sender = new DeBORCCIPSender(SEPOLIA_ROUTER, CRE_FORWARDER);
        console.log("DeBORCCIPSender deployed:", address(sender));

        vm.stopBroadcast();
    }
}

/// @notice Deploy DeBORCCIPReceiver on Base Sepolia
/// Usage: forge script script/DeployCCIP.s.sol:DeployReceiverBase --rpc-url base_sepolia --broadcast --verify
contract DeployReceiverBase is Script {
    // Base Sepolia CCIP Router
    address constant BASE_SEPOLIA_ROUTER = 0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93;
    // Sepolia chain selector
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
    // Arbitrum Sepolia CCIP Router
    address constant ARB_SEPOLIA_ROUTER = 0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165;
    // Sepolia chain selector
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

/// @notice Deploy DeBORCCIPReceiver on Optimism Sepolia
/// Usage: CCIP_SENDER=0xE99c38245EA789E9102Dc23EE28FAd3ed67d2432 forge script script/DeployCCIP.s.sol:DeployReceiverOP --rpc-url op_sepolia --broadcast --verify
contract DeployReceiverOP is Script {
    address constant OP_SEPOLIA_ROUTER = 0x114A20A10b43D4115e5aeef7345a1A71d2a60C57;
    uint64 constant SEPOLIA_SELECTOR = 16015286601757825753;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address senderAddress = vm.envAddress("CCIP_SENDER");

        vm.startBroadcast(pk);

        DeBORCCIPReceiver receiver = new DeBORCCIPReceiver(
            OP_SEPOLIA_ROUTER,
            SEPOLIA_SELECTOR,
            senderAddress
        );
        console.log("DeBORCCIPReceiver (OP Sepolia) deployed:", address(receiver));

        vm.stopBroadcast();
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {DeBORSwap} from "../src/DeBORSwap.sol";

/// @notice Deploy DeBORSwap on Sepolia (pointed at DeBOR-USD Oracle + CRE Forwarder)
/// Usage: forge script script/DeploySwap.s.sol:DeploySwap --rpc-url sepolia --broadcast --verify
contract DeploySwap is Script {
    address constant DEBOR_ORACLE = 0x7D951b4dA2B4B50e83C92aB94b318b3268637E3E;
    address constant FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        DeBORSwap swap = new DeBORSwap(DEBOR_ORACLE, FORWARDER);
        console.log("DeBORSwap deployed:", address(swap));

        vm.stopBroadcast();
    }
}

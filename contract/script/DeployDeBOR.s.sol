// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DeBOROracle} from "../src/DeBOROracle.sol";
import {AdaptiveLending} from "../src/DeBORConsumer.sol";

contract DeployDeBOR is Script {
    address constant SEPOLIA_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        DeBOROracle oracle = new DeBOROracle(SEPOLIA_FORWARDER);
        console.log("DeBOROracle deployed at:", address(oracle));

        AdaptiveLending consumer = new AdaptiveLending(address(oracle));
        console.log("AdaptiveLending deployed at:", address(consumer));

        vm.stopBroadcast();
    }
}

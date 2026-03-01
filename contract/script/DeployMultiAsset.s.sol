// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DeBOROracle} from "../src/DeBOROracle.sol";

contract DeployMultiAsset is Script {
    address constant SEPOLIA_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        DeBOROracle ethOracle = new DeBOROracle(SEPOLIA_FORWARDER);
        console.log("DeBOR-ETH Oracle deployed at:", address(ethOracle));

        DeBOROracle btcOracle = new DeBOROracle(SEPOLIA_FORWARDER);
        console.log("DeBOR-BTC Oracle deployed at:", address(btcOracle));

        vm.stopBroadcast();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DeBOROracle} from "../src/DeBOROracle.sol";

contract DeployNewAssets is Script {
    address constant SEPOLIA_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        DeBOROracle daiOracle = new DeBOROracle(SEPOLIA_FORWARDER);
        console.log("DeBOR-DAI Oracle deployed at:", address(daiOracle));

        DeBOROracle usdtOracle = new DeBOROracle(SEPOLIA_FORWARDER);
        console.log("DeBOR-USDT Oracle deployed at:", address(usdtOracle));

        vm.stopBroadcast();
    }
}

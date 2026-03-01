// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {DeBOROracle} from "../src/DeBOROracle.sol";
import {AdaptiveLending} from "../src/DeBORConsumer.sol";

contract DeBOROracleTest is Test {
    DeBOROracle public oracle;
    AdaptiveLending public consumer;
    address public forwarder = address(0xF0);

    function setUp() public {
        oracle = new DeBOROracle(forwarder);
        consumer = new AdaptiveLending(address(oracle));
    }

    function test_InitialState() public view {
        assertEq(oracle.deborRate(), 0);
        assertEq(oracle.numSources(), 0);
        assertEq(oracle.getForwarderAddress(), forwarder);
    }

    function test_ProcessReport() public {
        // Encode a benchmark report: rate=423, supply=289, spread=134, vol=450, term7d=415, ts=1000, sources=7
        bytes memory report = abi.encode(
            uint256(423),
            uint256(289),
            uint256(134),
            uint256(450),
            uint256(415),
            uint256(1000),
            uint256(7)
        );

        // Build metadata (96 bytes: 32 workflowId + 10 workflowName + 20 owner + 2 reportName + padding)
        bytes memory metadata = new bytes(96);

        // Call onReport as the forwarder
        vm.prank(forwarder);
        oracle.onReport(metadata, report);

        assertEq(oracle.deborRate(), 423);
        assertEq(oracle.deborSupply(), 289);
        assertEq(oracle.deborSpread(), 134);
        assertEq(oracle.deborVol(), 450);
        assertEq(oracle.deborTerm7d(), 415);
        assertEq(oracle.lastUpdated(), 1000);
        assertEq(oracle.numSources(), 7);
    }

    function test_GetFullBenchmark() public {
        bytes memory report = abi.encode(
            uint256(423), uint256(289), uint256(134),
            uint256(450), uint256(415), uint256(1000), uint256(7)
        );
        bytes memory metadata = new bytes(96);

        vm.prank(forwarder);
        oracle.onReport(metadata, report);

        (uint256 rate, uint256 supply, uint256 spread, uint256 vol, uint256 term7d, uint256 updated, uint256 sources) =
            oracle.getFullBenchmark();

        assertEq(rate, 423);
        assertEq(supply, 289);
        assertEq(spread, 134);
        assertEq(vol, 450);
        assertEq(term7d, 415);
        assertEq(updated, 1000);
        assertEq(sources, 7);
    }

    function test_HistoricalRates() public {
        bytes memory metadata = new bytes(96);

        // Submit 3 reports with different rates
        uint256[3] memory rates = [uint256(400), uint256(420), uint256(440)];
        for (uint256 i = 0; i < 3; i++) {
            bytes memory report = abi.encode(
                rates[i], uint256(289), uint256(100),
                uint256(450), uint256(415), uint256(1000 + i), uint256(7)
            );
            vm.prank(forwarder);
            oracle.onReport(metadata, report);
        }

        // Most recent (0 periods back) should be 440
        assertEq(oracle.getHistoricalRate(0), 440);
        // 1 period back should be 420
        assertEq(oracle.getHistoricalRate(1), 420);
        // 2 periods back should be 400
        assertEq(oracle.getHistoricalRate(2), 400);
    }

    function test_RevertUnauthorizedSender() public {
        bytes memory report = abi.encode(
            uint256(423), uint256(289), uint256(134),
            uint256(450), uint256(415), uint256(1000), uint256(7)
        );
        bytes memory metadata = new bytes(96);

        // Call from non-forwarder should revert
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        oracle.onReport(metadata, report);
    }

    function test_ConsumerBorrowRate() public {
        bytes memory report = abi.encode(
            uint256(423), uint256(289), uint256(134),
            uint256(450), uint256(415), uint256(1000), uint256(7)
        );
        bytes memory metadata = new bytes(96);

        vm.prank(forwarder);
        oracle.onReport(metadata, report);

        (uint256 rateBps, string memory regime) = consumer.getCurrentBorrowRate();
        // rate = 423 + 200 (base spread) + (450 * 50 / 1000) = 423 + 200 + 22 = 645
        assertEq(rateBps, 645);
        assertEq(keccak256(bytes(regime)), keccak256(bytes("STABLE")));
    }

    function test_ConsumerCollateralRatio() public {
        bytes memory report = abi.encode(
            uint256(423), uint256(289), uint256(134),
            uint256(450), uint256(415), uint256(1000), uint256(7)
        );
        bytes memory metadata = new bytes(96);

        vm.prank(forwarder);
        oracle.onReport(metadata, report);

        uint256 ratio = consumer.getAdaptiveCollateralRatio();
        // spread = 134, excess = 34, additional = 34 * 1000 / 100 = 340
        // ratio = 15000 + 340 = 15340
        assertEq(ratio, 15340);
    }
}

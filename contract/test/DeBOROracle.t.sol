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
        // Encode a benchmark report: rate=423, supply=289, spread=134, vol=450, term7d=415, ts=1000, sources=7, configured=10
        bytes memory report = abi.encode(
            uint256(423),
            uint256(289),
            uint256(134),
            uint256(450),
            uint256(415),
            uint256(1000),
            uint256(7),
            uint256(10)
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
        assertEq(oracle.sourcesConfigured(), 10);
    }

    function test_GetFullBenchmark() public {
        bytes memory report = abi.encode(
            uint256(423), uint256(289), uint256(134),
            uint256(450), uint256(415), uint256(1000), uint256(7), uint256(10)
        );
        bytes memory metadata = new bytes(96);

        vm.prank(forwarder);
        oracle.onReport(metadata, report);

        (uint256 rate, uint256 supply, uint256 spread, uint256 vol, uint256 term7d, uint256 updated, uint256 sources, uint256 configured) =
            oracle.getFullBenchmark();

        assertEq(rate, 423);
        assertEq(supply, 289);
        assertEq(spread, 134);
        assertEq(vol, 450);
        assertEq(term7d, 415);
        assertEq(updated, 1000);
        assertEq(sources, 7);
        assertEq(configured, 10);
    }

    function test_HistoricalRates() public {
        bytes memory metadata = new bytes(96);

        // Submit 3 reports with different rates
        uint256[3] memory rates = [uint256(400), uint256(420), uint256(440)];
        for (uint256 i = 0; i < 3; i++) {
            bytes memory report = abi.encode(
                rates[i], uint256(289), uint256(100),
                uint256(450), uint256(415), uint256(1000 + i), uint256(7), uint256(10)
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
            uint256(450), uint256(415), uint256(1000), uint256(7), uint256(10)
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
            uint256(450), uint256(415), uint256(1000), uint256(7), uint256(10)
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
            uint256(450), uint256(415), uint256(1000), uint256(7), uint256(10)
        );
        bytes memory metadata = new bytes(96);

        vm.prank(forwarder);
        oracle.onReport(metadata, report);

        uint256 ratio = consumer.getAdaptiveCollateralRatio();
        // spread = 134, excess = 34, additional = 34 * 1000 / 100 = 340
        // ratio = 15000 + 340 = 15340
        assertEq(ratio, 15340);
    }

    // --- Phase 7h: New Oracle Tests ---

    function test_HistoryRingBufferWraparound() public {
        bytes memory metadata = new bytes(96);

        // Fill entire ring buffer (336 entries) + 1 extra to wrap
        for (uint256 i = 0; i < 337; i++) {
            bytes memory report = abi.encode(
                uint256(100 + i), uint256(50), uint256(50),
                uint256(100), uint256(100), uint256(1000 + i), uint256(5), uint256(8)
            );
            vm.prank(forwarder);
            oracle.onReport(metadata, report);
        }

        // historyIndex should be 337
        assertEq(oracle.historyIndex(), 337);
        // Most recent (index 336) should be 100+336 = 436
        assertEq(oracle.getHistoricalRate(0), 436);
        // Oldest accessible should be index 1 (index 0 was overwritten by 337th write)
        assertEq(oracle.getHistoricalRate(335), 101);
    }

    function test_GetHistoricalRateOutOfRange() public {
        bytes memory metadata = new bytes(96);

        // Submit only 2 reports
        for (uint256 i = 0; i < 2; i++) {
            bytes memory report = abi.encode(
                uint256(400 + i), uint256(200), uint256(100),
                uint256(300), uint256(350), uint256(1000 + i), uint256(5), uint256(8)
            );
            vm.prank(forwarder);
            oracle.onReport(metadata, report);
        }

        // periodsBack=2 should revert (only 2 entries, max periodsBack is 1)
        vm.expectRevert("Out of range");
        oracle.getHistoricalRate(2);

        // periodsBack=336 should also revert (>= MAX_HISTORY)
        vm.expectRevert("Out of range");
        oracle.getHistoricalRate(336);
    }

    function test_SetForwarderAddress() public {
        address newForwarder = address(0xAA);
        oracle.setForwarderAddress(newForwarder);
        assertEq(oracle.getForwarderAddress(), newForwarder);

        // Old forwarder should now be rejected
        bytes memory report = abi.encode(
            uint256(400), uint256(200), uint256(100),
            uint256(300), uint256(350), uint256(1000), uint256(5), uint256(8)
        );
        bytes memory metadata = new bytes(96);
        vm.prank(forwarder); // old forwarder
        vm.expectRevert();
        oracle.onReport(metadata, report);

        // New forwarder should work
        vm.prank(newForwarder);
        oracle.onReport(metadata, report);
        assertEq(oracle.deborRate(), 400);
    }

    function test_OnlyOwnerSetForwarder() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        oracle.setForwarderAddress(address(0xBB));
    }

    function test_ProcessReportEmitsEvent() public {
        bytes memory report = abi.encode(
            uint256(500), uint256(300), uint256(200),
            uint256(600), uint256(480), uint256(2000), uint256(9), uint256(12)
        );
        bytes memory metadata = new bytes(96);

        vm.expectEmit(true, false, false, true);
        emit DeBOROracle.BenchmarkUpdated(2000, 500, 300, 200, 600, 480, 9, 12);

        vm.prank(forwarder);
        oracle.onReport(metadata, report);
    }

    function test_ZeroRateReport() public {
        // With circuit breaker, rate=0 conflicts with REPORT_TYPE_NORMAL=0,
        // so zero-rate reports must use the new format with explicit type prefix
        bytes memory report = abi.encode(
            uint256(0),      // REPORT_TYPE_NORMAL
            uint256(0),      // rate
            uint256(0),      // supply
            uint256(0),      // spread
            uint256(0),      // vol
            uint256(0),      // term7d
            uint256(999),    // timestamp
            uint256(0),      // numSources
            uint256(0)       // sourcesConfigured
        );
        bytes memory metadata = new bytes(96);

        vm.prank(forwarder);
        oracle.onReport(metadata, report);

        assertEq(oracle.deborRate(), 0);
        assertEq(oracle.lastUpdated(), 999);
        assertEq(oracle.getRate(), 0);
    }

    // --- Phase 7h: New Consumer Tests ---

    function test_ConsumerVolatileRegime() public {
        // vol=3000 → VOLATILE regime, volPremium = 3000*50/1000 = 150
        bytes memory report = abi.encode(
            uint256(400), uint256(200), uint256(100),
            uint256(3000), uint256(380), uint256(1000), uint256(7), uint256(10)
        );
        bytes memory metadata = new bytes(96);
        vm.prank(forwarder);
        oracle.onReport(metadata, report);

        (uint256 rateBps, string memory regime) = consumer.getCurrentBorrowRate();
        // rate = 400 + 200 + 150 = 750
        assertEq(rateBps, 750);
        assertEq(keccak256(bytes(regime)), keccak256(bytes("VOLATILE")));
    }

    function test_ConsumerCrisisRegime() public {
        // vol=6000 → CRISIS regime, volPremium = 6000*50/1000 = 300
        bytes memory report = abi.encode(
            uint256(800), uint256(400), uint256(500),
            uint256(6000), uint256(700), uint256(1000), uint256(7), uint256(10)
        );
        bytes memory metadata = new bytes(96);
        vm.prank(forwarder);
        oracle.onReport(metadata, report);

        (uint256 rateBps, string memory regime) = consumer.getCurrentBorrowRate();
        // rate = 800 + 200 + 300 = 1300
        assertEq(rateBps, 1300);
        assertEq(keccak256(bytes(regime)), keccak256(bytes("CRISIS")));
    }

    // --- Circuit Breaker Tests ---

    function test_CircuitBreakerAlertReport() public {
        bytes memory metadata = new bytes(96);

        // First write a normal rate so there's existing data
        bytes memory normalReport = abi.encode(
            uint256(400), uint256(200), uint256(100),
            uint256(300), uint256(350), uint256(1000), uint256(7), uint256(10)
        );
        vm.prank(forwarder);
        oracle.onReport(metadata, normalReport);
        assertEq(oracle.deborRate(), 400);
        assertFalse(oracle.circuitBreakerActive());

        // Now send an alert report (type 1)
        // Format: (uint8 reportType=1, uint256 proposedRate, uint256 riskLevel, uint256 deviationBps, uint256 timestamp)
        bytes memory alertReport = abi.encode(
            uint256(1),      // REPORT_TYPE_ALERT
            uint256(900),    // proposedRate (anomalous)
            uint256(3),      // CRITICAL risk level
            uint256(500),    // 500bps deviation
            uint256(2000)    // timestamp
        );

        vm.expectEmit(true, false, false, true);
        emit DeBOROracle.CircuitBreakerTripped(2000, 900, 400, 3, 500);

        vm.prank(forwarder);
        oracle.onReport(metadata, alertReport);

        assertTrue(oracle.circuitBreakerActive());
        assertEq(oracle.riskLevel(), 3);
        assertEq(oracle.lastCircuitBreakerTrip(), 2000);
        // Rate should NOT have changed
        assertEq(oracle.deborRate(), 400);
    }

    function test_CircuitBreakerResetOnNormalReport() public {
        bytes memory metadata = new bytes(96);

        // Set initial rate
        bytes memory report1 = abi.encode(
            uint256(400), uint256(200), uint256(100),
            uint256(300), uint256(350), uint256(1000), uint256(7), uint256(10)
        );
        vm.prank(forwarder);
        oracle.onReport(metadata, report1);

        // Trip circuit breaker
        bytes memory alertReport = abi.encode(
            uint256(1), uint256(900), uint256(3), uint256(500), uint256(2000)
        );
        vm.prank(forwarder);
        oracle.onReport(metadata, alertReport);
        assertTrue(oracle.circuitBreakerActive());

        // Normal report should reset circuit breaker (legacy format, rate > 1)
        bytes memory normalReport = abi.encode(
            uint256(420), uint256(210), uint256(110),
            uint256(280), uint256(360), uint256(3000), uint256(8), uint256(10)
        );

        vm.expectEmit(true, false, false, false);
        emit DeBOROracle.CircuitBreakerReset(3000);

        vm.prank(forwarder);
        oracle.onReport(metadata, normalReport);

        assertFalse(oracle.circuitBreakerActive());
        assertEq(oracle.deborRate(), 420);
    }

    function test_LegacyReportBackwardsCompat() public {
        bytes memory metadata = new bytes(96);

        // Legacy format: 8 uint256s, first value > 1 (the rate)
        bytes memory legacyReport = abi.encode(
            uint256(500), uint256(300), uint256(200),
            uint256(400), uint256(480), uint256(5000), uint256(6), uint256(9)
        );

        vm.prank(forwarder);
        oracle.onReport(metadata, legacyReport);

        assertEq(oracle.deborRate(), 500);
        assertEq(oracle.deborSupply(), 300);
        assertEq(oracle.numSources(), 6);
        assertEq(oracle.sourcesConfigured(), 9);
    }

    function test_NewFormatNormalReport() public {
        bytes memory metadata = new bytes(96);

        // New format: type=0 prefix + 8 fields
        bytes memory newReport = abi.encode(
            uint256(0),      // REPORT_TYPE_NORMAL
            uint256(450), uint256(250), uint256(150),
            uint256(350), uint256(400), uint256(6000), uint256(9), uint256(12)
        );

        vm.prank(forwarder);
        oracle.onReport(metadata, newReport);

        assertEq(oracle.deborRate(), 450);
        assertEq(oracle.deborSupply(), 250);
        assertEq(oracle.numSources(), 9);
        assertEq(oracle.sourcesConfigured(), 12);
    }

    function test_ConsumerCollateralRatioLowSpread() public {
        // spread=80 (< 100) → no additional collateral, base ratio = 15000
        bytes memory report = abi.encode(
            uint256(300), uint256(200), uint256(80),
            uint256(200), uint256(290), uint256(1000), uint256(7), uint256(10)
        );
        bytes memory metadata = new bytes(96);
        vm.prank(forwarder);
        oracle.onReport(metadata, report);

        uint256 ratio = consumer.getAdaptiveCollateralRatio();
        assertEq(ratio, 15000);
    }
}
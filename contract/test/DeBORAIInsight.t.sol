// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeBORAIInsight} from "../src/DeBORAIInsight.sol";

contract DeBORAIInsightTest is Test {
    DeBORAIInsight public insight;
    address public forwarder = address(0xF0);

    function setUp() public {
        insight = new DeBORAIInsight(forwarder);
    }

    function test_InitialState() public view {
        assertEq(insight.riskLevel(), 0);
        assertEq(insight.riskScore(), 0);
        assertFalse(insight.anomalyDetected());
        assertEq(insight.lastAnalyzedAt(), 0);
    }

    function test_ProcessInsightReport() public {
        // riskLevel=1(MEDIUM), rateDirection=0(STABLE), spreadHealth=0(NORMAL),
        // marketRegime=1(NORMAL), riskScore=35, anomaly=0, timestamp=1000
        bytes memory report = abi.encode(
            uint256(1), uint256(0), uint256(0),
            uint256(1), uint256(35), uint256(0), uint256(1000)
        );
        bytes memory metadata = new bytes(96);

        vm.prank(forwarder);
        insight.onReport(metadata, report);

        assertEq(insight.riskLevel(), 1);
        assertEq(insight.rateDirection(), 0);
        assertEq(insight.spreadHealth(), 0);
        assertEq(insight.marketRegime(), 1);
        assertEq(insight.riskScore(), 35);
        assertFalse(insight.anomalyDetected());
        assertEq(insight.lastAnalyzedAt(), 1000);
    }

    function test_AnomalyFlagEmitsEvent() public {
        // CRITICAL risk with anomaly detected
        bytes memory report = abi.encode(
            uint256(3), uint256(2), uint256(2),
            uint256(3), uint256(85), uint256(1), uint256(2000)
        );
        bytes memory metadata = new bytes(96);

        vm.expectEmit(true, false, false, true);
        emit DeBORAIInsight.AnomalyFlagged(2000, 85, 3);

        vm.prank(forwarder);
        insight.onReport(metadata, report);

        assertTrue(insight.anomalyDetected());
        assertEq(insight.riskLevel(), 3);
        assertTrue(insight.isHighRisk());
    }

    function test_GetInsightStruct() public {
        bytes memory report = abi.encode(
            uint256(2), uint256(1), uint256(1),
            uint256(2), uint256(60), uint256(0), uint256(3000)
        );
        bytes memory metadata = new bytes(96);

        vm.prank(forwarder);
        insight.onReport(metadata, report);

        (
            uint8 _risk, uint8 _dir, uint8 _spread,
            uint8 _regime, uint256 _score, bool _anomaly, uint256 _ts
        ) = insight.getInsight();

        assertEq(_risk, 2);
        assertEq(_dir, 1);
        assertEq(_spread, 1);
        assertEq(_regime, 2);
        assertEq(_score, 60);
        assertFalse(_anomaly);
        assertEq(_ts, 3000);
    }

    function test_RiskScoreHistory() public {
        bytes memory metadata = new bytes(96);

        for (uint256 i = 0; i < 5; i++) {
            bytes memory report = abi.encode(
                uint256(0), uint256(0), uint256(0),
                uint256(0), uint256(10 + i * 10), uint256(0), uint256(1000 + i)
            );
            vm.prank(forwarder);
            insight.onReport(metadata, report);
        }

        // Most recent (0 back) = 50, 1 back = 40, etc.
        assertEq(insight.getHistoricalRiskScore(0), 50);
        assertEq(insight.getHistoricalRiskScore(1), 40);
        assertEq(insight.getHistoricalRiskScore(4), 10);
    }

    function test_IsHighRiskThresholds() public {
        bytes memory metadata = new bytes(96);

        // riskLevel=1 (MEDIUM) -> not high risk
        bytes memory report1 = abi.encode(
            uint256(1), uint256(0), uint256(0),
            uint256(0), uint256(30), uint256(0), uint256(1000)
        );
        vm.prank(forwarder);
        insight.onReport(metadata, report1);
        assertFalse(insight.isHighRisk());

        // riskLevel=2 (HIGH) -> high risk
        bytes memory report2 = abi.encode(
            uint256(2), uint256(0), uint256(0),
            uint256(0), uint256(65), uint256(0), uint256(2000)
        );
        vm.prank(forwarder);
        insight.onReport(metadata, report2);
        assertTrue(insight.isHighRisk());
    }

    function test_RevertUnauthorizedSender() public {
        bytes memory report = abi.encode(
            uint256(0), uint256(0), uint256(0),
            uint256(0), uint256(25), uint256(0), uint256(1000)
        );
        bytes memory metadata = new bytes(96);

        vm.prank(address(0xBEEF));
        vm.expectRevert();
        insight.onReport(metadata, report);
    }
}

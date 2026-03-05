// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeBOROracle} from "../src/DeBOROracle.sol";
import {AdaptiveLending} from "../src/DeBORConsumer.sol";

contract DeBORConsumerTest is Test {
    DeBOROracle public oracle;
    AdaptiveLending public consumer;
    address public forwarder = address(0xF0);

    function setUp() public {
        oracle = new DeBOROracle(forwarder);
        consumer = new AdaptiveLending(address(oracle));
    }

    function _submitReport(
        uint256 rate, uint256 supply, uint256 spread,
        uint256 vol, uint256 term7d, uint256 ts,
        uint256 sources, uint256 configured
    ) internal {
        bytes memory report = abi.encode(rate, supply, spread, vol, term7d, ts, sources, configured);
        bytes memory metadata = new bytes(96);
        vm.prank(forwarder);
        oracle.onReport(metadata, report);
    }

    // ── getCurrentBorrowRate regime boundaries ──

    function test_RegimeStable() public {
        // vol=499 (< 500) => STABLE
        _submitReport(400, 200, 100, 499, 350, 1000, 7, 10);
        (uint256 rateBps, string memory regime) = consumer.getCurrentBorrowRate();
        // volPremium = 499 * 50 / 1000 = 24
        assertEq(rateBps, 400 + 200 + 24);
        assertEq(keccak256(bytes(regime)), keccak256(bytes("STABLE")));
    }

    function test_RegimeNormal() public {
        // vol=500 (>= 500, < 2000) => NORMAL
        _submitReport(400, 200, 100, 500, 350, 1000, 7, 10);
        (uint256 rateBps, string memory regime) = consumer.getCurrentBorrowRate();
        assertEq(rateBps, 400 + 200 + 25);
        assertEq(keccak256(bytes(regime)), keccak256(bytes("NORMAL")));
    }

    function test_RegimeNormalUpperBound() public {
        // vol=1999 (< 2000) => NORMAL
        _submitReport(400, 200, 100, 1999, 350, 1000, 7, 10);
        (uint256 rateBps, string memory regime) = consumer.getCurrentBorrowRate();
        assertEq(rateBps, 400 + 200 + 99); // 1999*50/1000 = 99
        assertEq(keccak256(bytes(regime)), keccak256(bytes("NORMAL")));
    }

    function test_RegimeVolatile() public {
        // vol=2000 (>= 2000, < 5000) => VOLATILE
        _submitReport(400, 200, 100, 2000, 350, 1000, 7, 10);
        (uint256 rateBps, string memory regime) = consumer.getCurrentBorrowRate();
        assertEq(rateBps, 400 + 200 + 100); // 2000*50/1000 = 100
        assertEq(keccak256(bytes(regime)), keccak256(bytes("VOLATILE")));
    }

    function test_RegimeCrisis() public {
        // vol=5000 (>= 5000) => CRISIS
        _submitReport(800, 400, 500, 5000, 700, 1000, 7, 10);
        (uint256 rateBps, string memory regime) = consumer.getCurrentBorrowRate();
        assertEq(rateBps, 800 + 200 + 250); // 5000*50/1000 = 250
        assertEq(keccak256(bytes(regime)), keccak256(bytes("CRISIS")));
    }

    function test_RegimeZeroVol() public {
        // vol=0 => STABLE, volPremium=0
        _submitReport(300, 100, 50, 0, 280, 1000, 5, 5);
        (uint256 rateBps, string memory regime) = consumer.getCurrentBorrowRate();
        assertEq(rateBps, 300 + 200);
        assertEq(keccak256(bytes(regime)), keccak256(bytes("STABLE")));
    }

    // ── getAdaptiveCollateralRatio ──

    function test_CollateralRatioBaseOnly() public {
        // spread=100 => no additional (only > 100 triggers), ratio = 15000
        _submitReport(400, 200, 100, 300, 350, 1000, 7, 10);
        assertEq(consumer.getAdaptiveCollateralRatio(), 15000);
    }

    function test_CollateralRatioLowSpread() public {
        // spread=50 (< 100) => base only
        _submitReport(400, 200, 50, 300, 350, 1000, 7, 10);
        assertEq(consumer.getAdaptiveCollateralRatio(), 15000);
    }

    function test_CollateralRatioHighSpread() public {
        // spread=200 => excess=100, additional=100*1000/100=1000
        _submitReport(400, 200, 200, 300, 350, 1000, 7, 10);
        assertEq(consumer.getAdaptiveCollateralRatio(), 16000);
    }

    function test_CollateralRatioVeryHighSpread() public {
        // spread=500 => excess=400, additional=400*1000/100=4000
        _submitReport(400, 200, 500, 300, 350, 1000, 7, 10);
        assertEq(consumer.getAdaptiveCollateralRatio(), 19000);
    }

    // ── getRiskScore boundaries ──

    function test_RiskScoreAllLow() public {
        // vol<500 (0pts), spread<100 (0pts), sources 10/10=100% (0pts) => score=0
        _submitReport(400, 200, 50, 200, 350, 1000, 10, 10);
        assertEq(consumer.getRiskScore(), 0);
    }

    function test_RiskScoreAllMax() public {
        // vol>=5000 (40pts), spread>=300 (30pts), sources 0/10 uptime<50% (30pts) => score=100
        _submitReport(400, 200, 300, 5000, 350, 1000, 0, 10);
        assertEq(consumer.getRiskScore(), 100);
    }

    function test_RiskScoreVolBoundaries() public {
        // vol=499 => 0pts
        _submitReport(400, 200, 50, 499, 350, 1000, 10, 10);
        assertEq(consumer.getRiskScore(), 0);

        // vol=500 => 15pts
        _submitReport(400, 200, 50, 500, 350, 1001, 10, 10);
        assertEq(consumer.getRiskScore(), 15);

        // vol=1999 => 15pts
        _submitReport(400, 200, 50, 1999, 350, 1002, 10, 10);
        assertEq(consumer.getRiskScore(), 15);

        // vol=2000 => 30pts
        _submitReport(400, 200, 50, 2000, 350, 1003, 10, 10);
        assertEq(consumer.getRiskScore(), 30);

        // vol=4999 => 30pts
        _submitReport(400, 200, 50, 4999, 350, 1004, 10, 10);
        assertEq(consumer.getRiskScore(), 30);

        // vol=5000 => 40pts
        _submitReport(400, 200, 50, 5000, 350, 1005, 10, 10);
        assertEq(consumer.getRiskScore(), 40);
    }

    function test_RiskScoreSpreadBoundaries() public {
        // spread=99 => 0pts
        _submitReport(400, 200, 99, 200, 350, 1000, 10, 10);
        assertEq(consumer.getRiskScore(), 0);

        // spread=100 => 10pts
        _submitReport(400, 200, 100, 200, 350, 1001, 10, 10);
        assertEq(consumer.getRiskScore(), 10);

        // spread=199 => 10pts
        _submitReport(400, 200, 199, 200, 350, 1002, 10, 10);
        assertEq(consumer.getRiskScore(), 10);

        // spread=200 => 20pts
        _submitReport(400, 200, 200, 200, 350, 1003, 10, 10);
        assertEq(consumer.getRiskScore(), 20);

        // spread=300 => 30pts
        _submitReport(400, 200, 300, 200, 350, 1004, 10, 10);
        assertEq(consumer.getRiskScore(), 30);
    }

    function test_RiskScoreSourceDiversity() public {
        // 10/10 = 100% => 0pts
        _submitReport(400, 200, 50, 200, 350, 1000, 10, 10);
        assertEq(consumer.getRiskScore(), 0);

        // 9/10 = 90% => 0pts (>= 90%)
        _submitReport(400, 200, 50, 200, 350, 1001, 9, 10);
        assertEq(consumer.getRiskScore(), 0);

        // 8/10 = 80% => 10pts (>= 70%, < 90%)
        _submitReport(400, 200, 50, 200, 350, 1002, 8, 10);
        assertEq(consumer.getRiskScore(), 10);

        // 7/10 = 70% => 10pts
        _submitReport(400, 200, 50, 200, 350, 1003, 7, 10);
        assertEq(consumer.getRiskScore(), 10);

        // 6/10 = 60% => 20pts (>= 50%, < 70%)
        _submitReport(400, 200, 50, 200, 350, 1004, 6, 10);
        assertEq(consumer.getRiskScore(), 20);

        // 5/10 = 50% => 20pts
        _submitReport(400, 200, 50, 200, 350, 1005, 5, 10);
        assertEq(consumer.getRiskScore(), 20);

        // 4/10 = 40% => 30pts (< 50%)
        _submitReport(400, 200, 50, 200, 350, 1006, 4, 10);
        assertEq(consumer.getRiskScore(), 30);
    }

    function test_RiskScoreConfiguredZero() public {
        // configured=0 => sourceScore=30
        _submitReport(400, 200, 50, 200, 350, 1000, 0, 0);
        assertEq(consumer.getRiskScore(), 30);
    }

    function test_RiskScoreCapped() public {
        // vol=5000 (40) + spread=300 (30) + configured=0 (30) = 100 (capped)
        _submitReport(400, 200, 300, 5000, 350, 1000, 0, 0);
        assertEq(consumer.getRiskScore(), 100);
    }

    // ── getStressTestPnL ──

    function test_StressTestPositiveShock() public {
        // rate=400, fixedRate=400, notional=1e18, shock=+200
        // shockedRate=600, rateDiff=600-400=200
        // pnl = 1e18 * 200 / 10000 / 365 = 54794520547945205
        _submitReport(400, 200, 100, 300, 350, 1000, 7, 10);
        int256 pnl = consumer.getStressTestPnL(400, 1e18, 200);
        assertEq(pnl, int256(1e18) * 200 / 10000 / 365);
        assertTrue(pnl > 0);
    }

    function test_StressTestNegativeShock() public {
        // rate=400, fixedRate=400, shock=-200 => shockedRate=200
        // rateDiff=200-400=-200 => negative PnL for fixed payer
        _submitReport(400, 200, 100, 300, 350, 1000, 7, 10);
        int256 pnl = consumer.getStressTestPnL(400, 1e18, -200);
        assertEq(pnl, int256(1e18) * (-200) / 10000 / 365);
        assertTrue(pnl < 0);
    }

    function test_StressTestShockToZero() public {
        // rate=400, shock=-500 => shockedRate clamped to 0
        // rateDiff=0-400=-400
        _submitReport(400, 200, 100, 300, 350, 1000, 7, 10);
        int256 pnl = consumer.getStressTestPnL(400, 1e18, -500);
        assertEq(pnl, int256(1e18) * (-400) / 10000 / 365);
    }

    function test_StressTestZeroShock() public {
        // rate=400, shock=0 => rateDiff=400-400=0 => pnl=0
        _submitReport(400, 200, 100, 300, 350, 1000, 7, 10);
        int256 pnl = consumer.getStressTestPnL(400, 1e18, 0);
        assertEq(pnl, 0);
    }

    function test_StressTestZeroNotional() public {
        _submitReport(400, 200, 100, 300, 350, 1000, 7, 10);
        int256 pnl = consumer.getStressTestPnL(400, 0, 200);
        assertEq(pnl, 0);
    }

    // ── getSourceDiversityScore ──

    function test_SourceDiversityFull() public {
        // 10/10 => 10000 bps
        _submitReport(400, 200, 100, 300, 350, 1000, 10, 10);
        assertEq(consumer.getSourceDiversityScore(), 10000);
    }

    function test_SourceDiversityPartial() public {
        // 7/10 => 7000 bps
        _submitReport(400, 200, 100, 300, 350, 1000, 7, 10);
        assertEq(consumer.getSourceDiversityScore(), 7000);
    }

    function test_SourceDiversityNone() public {
        // 0/10 => 0 bps
        _submitReport(400, 200, 100, 300, 350, 1000, 0, 10);
        assertEq(consumer.getSourceDiversityScore(), 0);
    }

    function test_SourceDiversityZeroConfigured() public {
        // configured=0 => returns 0
        _submitReport(400, 200, 100, 300, 350, 1000, 0, 0);
        assertEq(consumer.getSourceDiversityScore(), 0);
    }
}

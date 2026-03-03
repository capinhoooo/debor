// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDeBOR {
    function getRate() external view returns (uint256);
    function getSpread() external view returns (uint256);
    function getVolatility() external view returns (uint256);
    function getFullBenchmark() external view returns (
        uint256 rate, uint256 supply, uint256 spread, uint256 vol,
        uint256 term7d, uint256 updated, uint256 sources, uint256 configured
    );
    function getHistoricalRate(uint256 periodsBack) external view returns (uint256);
}

/// @title AdaptiveLending - Demo consumer that auto-adjusts rates based on DeBOR
/// @notice Shows how protocols would use the DeBOR benchmark rate oracle
contract AdaptiveLending {
    IDeBOR public immutable debor;

    uint256 public constant BASE_SPREAD = 200; 
    uint256 public constant VOL_MULTIPLIER = 50;

    event RateAdjusted(
        uint256 benchmarkRate,
        uint256 ourBorrowRate,
        uint256 volatilityPremium,
        string regime
    );

    constructor(address _debor) {
        debor = IDeBOR(_debor);
    }

    function getCurrentBorrowRate() public view returns (uint256 rateBps, string memory regime) {
        uint256 benchmark = debor.getRate();
        uint256 vol = debor.getVolatility();

        uint256 volPremium = (vol * VOL_MULTIPLIER) / 1000;
        rateBps = benchmark + BASE_SPREAD + volPremium;

        if (vol < 500) {
            regime = "STABLE";
        } else if (vol < 2000) {
            regime = "NORMAL";
        } else if (vol < 5000) {
            regime = "VOLATILE";
        } else {
            regime = "CRISIS";
        }
    }

    function getAdaptiveCollateralRatio() public view returns (uint256 ratioBps) {
        uint256 spread = debor.getSpread();

        ratioBps = 15000;
        if (spread > 100) {
            ratioBps += ((spread - 100) * 1000) / 100;
        }
    }

    /// @notice Composite risk score (0-100) based on vol, spread, source diversity
    /// @return score 0 = lowest risk, 100 = highest risk
    function getRiskScore() public view returns (uint256 score) {
        (, , uint256 spread, uint256 vol, , , uint256 sources, uint256 configured) = debor.getFullBenchmark();

        // Volatility component (0-40 points)
        uint256 volScore;
        if (vol >= 5000) volScore = 40;
        else if (vol >= 2000) volScore = 30;
        else if (vol >= 500) volScore = 15;

        // Spread component (0-30 points)
        uint256 spreadScore;
        if (spread >= 300) spreadScore = 30;
        else if (spread >= 200) spreadScore = 20;
        else if (spread >= 100) spreadScore = 10;

        // Source diversity component (0-30 points) — fewer sources = higher risk
        uint256 sourceScore;
        if (configured > 0) {
            uint256 uptime = (sources * 100) / configured;
            if (uptime < 50) sourceScore = 30;
            else if (uptime < 70) sourceScore = 20;
            else if (uptime < 90) sourceScore = 10;
        } else {
            sourceScore = 30;
        }

        score = volScore + spreadScore + sourceScore;
        if (score > 100) score = 100;
    }

    /// @notice Compute swap PnL impact under a rate shock scenario
    /// @param currentFixedRate The fixed rate of the swap (bps)
    /// @param notional The swap notional amount (wei)
    /// @param rateShockBps Signed rate shock to apply (e.g., +200 or -200)
    /// @return pnlImpact Signed PnL impact (positive = gain for fixed payer)
    function getStressTestPnL(
        uint256 currentFixedRate,
        uint256 notional,
        int256 rateShockBps
    ) public view returns (int256 pnlImpact) {
        uint256 currentRate = debor.getRate();
        int256 shockedRate = int256(currentRate) + rateShockBps;
        if (shockedRate < 0) shockedRate = 0;

        // PnL = notional * (shockedRate - fixedRate) / 10000 / 365 (daily)
        int256 rateDiff = shockedRate - int256(currentFixedRate);
        pnlImpact = (int256(notional) * rateDiff) / 10000 / 365;
    }

    /// @notice Source diversity score: active sources vs configured (basis points)
    /// @return diversityBps 10000 = all sources active, 0 = none active
    function getSourceDiversityScore() public view returns (uint256 diversityBps) {
        (, , , , , , uint256 sources, uint256 configured) = debor.getFullBenchmark();
        if (configured == 0) return 0;
        diversityBps = (sources * 10000) / configured;
    }
}

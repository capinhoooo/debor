// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDeBOR {
    function getRate() external view returns (uint256);
    function getSpread() external view returns (uint256);
    function getVolatility() external view returns (uint256);
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
}

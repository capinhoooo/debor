// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./ReceiverTemplate.sol";

/// @title DeBOROracle - DeFi Benchmark Rate Oracle
/// @notice Receives TVL-weighted benchmark rates from CRE workflow and stores them on-chain
/// @dev Any smart contract can read DeBOR metrics via the public getter functions
contract DeBOROracle is ReceiverTemplate {
    // --- DeBOR Metrics ---
    uint256 public deborRate;           // TVL-weighted borrow rate (bps)
    uint256 public deborSupply;         // TVL-weighted supply rate (bps)
    uint256 public deborSpread;         // Rate spread (bps)
    uint256 public deborVol;            // Volatility index
    uint256 public deborTerm7d;         // 7-day rolling average (bps)
    uint256 public lastUpdated;         // Timestamp of last update
    uint256 public numSources;          // Number of data sources that contributed
    uint256 public sourcesConfigured;   // Number of data sources configured

    uint256 public constant MAX_HISTORY = 336;
    uint256[336] public rateHistory;
    uint256 public historyIndex;

    // --- Events ---
    event BenchmarkUpdated(
        uint256 indexed timestamp,
        uint256 deborRate,
        uint256 deborSupply,
        uint256 deborSpread,
        uint256 deborVol,
        uint256 deborTerm7d,
        uint256 numSources,
        uint256 sourcesConfigured
    );

    constructor(address _forwarderAddress) ReceiverTemplate(_forwarderAddress) {}

    function _processReport(bytes calldata report) internal override {
        (
            uint256 _rate,
            uint256 _supply,
            uint256 _spread,
            uint256 _vol,
            uint256 _term7d,
            uint256 _timestamp,
            uint256 _numSources,
            uint256 _sourcesConfigured
        ) = abi.decode(report, (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256));

        deborRate = _rate;
        deborSupply = _supply;
        deborSpread = _spread;
        deborVol = _vol;
        deborTerm7d = _term7d;
        lastUpdated = _timestamp;
        numSources = _numSources;
        sourcesConfigured = _sourcesConfigured;

        rateHistory[historyIndex % MAX_HISTORY] = _rate;
        historyIndex++;

        emit BenchmarkUpdated(_timestamp, _rate, _supply, _spread, _vol, _term7d, _numSources, _sourcesConfigured);
    }

    function getRate() external view returns (uint256) {
        return deborRate;
    }

    function getSupplyRate() external view returns (uint256) {
        return deborSupply;
    }

    function getSpread() external view returns (uint256) {
        return deborSpread;
    }

    function getVolatility() external view returns (uint256) {
        return deborVol;
    }

    function getTermRate() external view returns (uint256) {
        return deborTerm7d;
    }

    function getFullBenchmark()
        external
        view
        returns (
            uint256 rate,
            uint256 supply,
            uint256 spread,
            uint256 vol,
            uint256 term7d,
            uint256 updated,
            uint256 sources,
            uint256 configured
        )
    {
        return (deborRate, deborSupply, deborSpread, deborVol, deborTerm7d, lastUpdated, numSources, sourcesConfigured);
    }

    function getHistoricalRate(uint256 periodsBack) external view returns (uint256) {
        require(periodsBack < MAX_HISTORY && periodsBack < historyIndex, "Out of range");
        uint256 idx = (historyIndex - 1 - periodsBack) % MAX_HISTORY;
        return rateHistory[idx];
    }
}

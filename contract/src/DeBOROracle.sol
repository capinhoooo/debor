// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./ReceiverTemplate.sol";

/// @title DeBOROracle - DeFi Benchmark Rate Oracle with Circuit Breaker
/// @notice Receives TVL-weighted benchmark rates from CRE workflow and stores them on-chain.
///         Supports dual report types: normal (type 0) updates the rate, alert (type 1)
///         activates the circuit breaker without updating the rate.
/// @dev Any smart contract can read DeBOR metrics and circuit breaker state via public getters
contract DeBOROracle is ReceiverTemplate {
    // --- Report Types ---
    uint8 public constant REPORT_TYPE_NORMAL = 0;
    uint8 public constant REPORT_TYPE_ALERT = 1;

    // --- DeBOR Metrics ---
    uint256 public deborRate;           // TVL-weighted borrow rate (bps)
    uint256 public deborSupply;         // TVL-weighted supply rate (bps)
    uint256 public deborSpread;         // Rate spread (bps)
    uint256 public deborVol;            // Volatility index
    uint256 public deborTerm7d;         // 7-day rolling average (bps)
    uint256 public lastUpdated;         // Timestamp of last update
    uint256 public numSources;          // Number of data sources that contributed
    uint256 public sourcesConfigured;   // Number of data sources configured

    // --- Circuit Breaker State ---
    bool public circuitBreakerActive;
    uint256 public lastCircuitBreakerTrip;
    uint8 public riskLevel;             // 0=LOW, 1=MEDIUM, 2=HIGH, 3=CRITICAL

    // --- Rate Bounds ---
    uint256 public constant MAX_RATE_BPS = 50000;        // 500% APR ceiling
    uint256 public constant MAX_DEVIATION_BPS = 2000;     // max 20% change per update

    error RateOutOfBounds(uint256 rate, uint256 maxRate);
    error RateDeviationTooLarge(uint256 newRate, uint256 oldRate, uint256 maxDeviation);
    error InvalidTWAPWindow(uint256 periods);

    // --- Rate History ---
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

    event CircuitBreakerTripped(
        uint256 indexed timestamp,
        uint256 proposedRate,
        uint256 currentRate,
        uint8 riskLevel,
        uint256 deviationBps
    );

    event CircuitBreakerReset(uint256 indexed timestamp);

    constructor(address _forwarderAddress) ReceiverTemplate(_forwarderAddress) {}

    function _processReport(bytes calldata report) internal override {
        // First uint256 doubles as reportType (0 or 1) or the rate itself (>1).
        // For backwards compatibility: if the first value is > 1, treat as legacy normal report.
        uint8 reportType;
        uint256 firstWord = abi.decode(report[:32], (uint256));

        if (firstWord <= 1) {
            reportType = uint8(firstWord);
        } else {
            reportType = REPORT_TYPE_NORMAL;
            _processNormalReportLegacy(report);
            return;
        }

        if (reportType == REPORT_TYPE_ALERT) {
            _processAlertReport(report);
        } else {
            _processNormalReport(report);
        }
    }

    function _processNormalReport(bytes calldata report) internal {
        (
            , // skip reportType (already read)
            uint256 _rate,
            uint256 _supply,
            uint256 _spread,
            uint256 _vol,
            uint256 _term7d,
            uint256 _timestamp,
            uint256 _numSources,
            uint256 _sourcesConfigured
        ) = abi.decode(report, (uint8, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256));

        // Rate sanity checks
        if (_rate > MAX_RATE_BPS) revert RateOutOfBounds(_rate, MAX_RATE_BPS);
        if (deborRate > 0) {
            uint256 diff = _rate > deborRate ? _rate - deborRate : deborRate - _rate;
            if (diff > MAX_DEVIATION_BPS) revert RateDeviationTooLarge(_rate, deborRate, MAX_DEVIATION_BPS);
        }

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

        // Reset circuit breaker on successful normal report
        if (circuitBreakerActive) {
            circuitBreakerActive = false;
            emit CircuitBreakerReset(_timestamp);
        }

        emit BenchmarkUpdated(_timestamp, _rate, _supply, _spread, _vol, _term7d, _numSources, _sourcesConfigured);
    }

    /// @dev Legacy format: 8 uint256s without reportType prefix (backwards compatible)
    function _processNormalReportLegacy(bytes calldata report) internal {
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

        // Rate sanity checks
        if (_rate > MAX_RATE_BPS) revert RateOutOfBounds(_rate, MAX_RATE_BPS);
        if (deborRate > 0) {
            uint256 diff = _rate > deborRate ? _rate - deborRate : deborRate - _rate;
            if (diff > MAX_DEVIATION_BPS) revert RateDeviationTooLarge(_rate, deborRate, MAX_DEVIATION_BPS);
        }

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

        if (circuitBreakerActive) {
            circuitBreakerActive = false;
            emit CircuitBreakerReset(_timestamp);
        }

        emit BenchmarkUpdated(_timestamp, _rate, _supply, _spread, _vol, _term7d, _numSources, _sourcesConfigured);
    }

    function _processAlertReport(bytes calldata report) internal {
        (
            , // skip reportType
            uint256 _proposedRate,
            uint256 _riskLevel,
            uint256 _deviationBps,
            uint256 _timestamp
        ) = abi.decode(report, (uint8, uint256, uint256, uint256, uint256));

        circuitBreakerActive = true;
        lastCircuitBreakerTrip = _timestamp;
        riskLevel = uint8(_riskLevel);

        emit CircuitBreakerTripped(_timestamp, _proposedRate, deborRate, uint8(_riskLevel), _deviationBps);
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

    /// @notice Compute time-weighted average rate from the last `periods` entries
    /// @param periods Number of historical entries to average (1 to min(historyIndex, MAX_HISTORY))
    /// @return The average rate in basis points
    function getTWAP(uint256 periods) external view returns (uint256) {
        if (periods == 0 || periods > historyIndex || periods > MAX_HISTORY)
            revert InvalidTWAPWindow(periods);
        uint256 sum;
        for (uint256 i = 0; i < periods; i++) {
            uint256 idx = (historyIndex - 1 - i) % MAX_HISTORY;
            sum += rateHistory[idx];
        }
        return sum / periods;
    }
}

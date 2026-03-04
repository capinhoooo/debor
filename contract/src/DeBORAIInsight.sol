// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./ReceiverTemplate.sol";

/// @title DeBORAIInsight - On-chain AI Market Intelligence from DON Consensus
/// @notice Stores DON-signed AI analysis verdicts (risk level, rate direction,
///         market regime, anomaly flags) written by the CRE workflow after
///         Groq LLM consensus across multiple DON nodes.
/// @dev Report format: (uint8 riskLevel, uint8 rateDirection, uint8 spreadHealth,
///      uint8 marketRegime, uint256 riskScore, bool anomalyDetected, uint256 timestamp)
contract DeBORAIInsight is ReceiverTemplate {
    // --- Enums as uint8 ---
    // riskLevel:     0=LOW, 1=MEDIUM, 2=HIGH, 3=CRITICAL
    // rateDirection: 0=STABLE, 1=RISING, 2=FALLING
    // spreadHealth:  0=NORMAL, 1=COMPRESSED, 2=INVERTED
    // marketRegime:  0=CONVERGED, 1=NORMAL, 2=DIVERGED, 3=DISLOCATED

    // --- State ---
    uint8 public riskLevel;
    uint8 public rateDirection;
    uint8 public spreadHealth;
    uint8 public marketRegime;
    uint256 public riskScore;        
    bool public anomalyDetected;
    uint256 public lastAnalyzedAt;

    // --- History ---
    uint256 public constant MAX_INSIGHT_HISTORY = 48;  
    uint256[48] public riskScoreHistory;
    uint256 public insightIndex;

    // --- Events ---
    event AIInsightUpdated(
        uint256 indexed timestamp,
        uint8 riskLevel,
        uint8 rateDirection,
        uint8 spreadHealth,
        uint8 marketRegime,
        uint256 riskScore,
        bool anomalyDetected
    );

    event AnomalyFlagged(
        uint256 indexed timestamp,
        uint256 riskScore,
        uint8 riskLevel
    );

    constructor(address _forwarderAddress) ReceiverTemplate(_forwarderAddress) {}

    function _processReport(bytes calldata report) internal override {
        (
            uint256 _riskLevel,
            uint256 _rateDirection,
            uint256 _spreadHealth,
            uint256 _marketRegime,
            uint256 _riskScore,
            uint256 _anomaly,
            uint256 _timestamp
        ) = abi.decode(report, (uint256, uint256, uint256, uint256, uint256, uint256, uint256));

        riskLevel = uint8(_riskLevel);
        rateDirection = uint8(_rateDirection);
        spreadHealth = uint8(_spreadHealth);
        marketRegime = uint8(_marketRegime);
        riskScore = _riskScore;
        anomalyDetected = _anomaly == 1;
        lastAnalyzedAt = _timestamp;

        riskScoreHistory[insightIndex % MAX_INSIGHT_HISTORY] = _riskScore;
        insightIndex++;

        emit AIInsightUpdated(
            _timestamp,
            uint8(_riskLevel),
            uint8(_rateDirection),
            uint8(_spreadHealth),
            uint8(_marketRegime),
            _riskScore,
            _anomaly == 1
        );

        if (_anomaly == 1) {
            emit AnomalyFlagged(_timestamp, _riskScore, uint8(_riskLevel));
        }
    }

    // --- Read Interface ---

    function getInsight()
        external
        view
        returns (
            uint8 _riskLevel,
            uint8 _rateDirection,
            uint8 _spreadHealth,
            uint8 _marketRegime,
            uint256 _riskScore,
            bool _anomalyDetected,
            uint256 _lastAnalyzedAt
        )
    {
        return (riskLevel, rateDirection, spreadHealth, marketRegime, riskScore, anomalyDetected, lastAnalyzedAt);
    }

    function getHistoricalRiskScore(uint256 periodsBack) external view returns (uint256) {
        require(periodsBack < MAX_INSIGHT_HISTORY && periodsBack < insightIndex, "Out of range");
        uint256 idx = (insightIndex - 1 - periodsBack) % MAX_INSIGHT_HISTORY;
        return riskScoreHistory[idx];
    }

    function isHighRisk() external view returns (bool) {
        return riskLevel >= 2; 
    }
}

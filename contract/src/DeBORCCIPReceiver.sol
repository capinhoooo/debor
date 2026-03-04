// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CCIPReceiver} from "@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title DeBORCCIPReceiver - Receives DeBOR benchmark data via CCIP on L2 chains
/// @notice Deployed on Base Sepolia and Arbitrum Sepolia. Stores the same 5 metrics as DeBOROracle.
contract DeBORCCIPReceiver is CCIPReceiver, Ownable {
    uint64 public allowedSourceChainSelector;
    address public allowedSender;

    uint256 public deborRate;
    uint256 public deborSupply;
    uint256 public deborSpread;
    uint256 public deborVol;
    uint256 public deborTerm7d;
    uint256 public lastUpdated;
    uint256 public numSources;

    // Risk metadata (propagated from L1 oracle)
    uint8 public riskLevel;          // 0=LOW, 1=MEDIUM, 2=HIGH, 3=CRITICAL
    bool public circuitBreakerActive;
    uint256 public riskScore;        // 0-100

    uint256 public constant MAX_HISTORY = 336;
    uint256[336] public rateHistory;
    uint256 public historyIndex;

    event BenchmarkReceived(
        bytes32 indexed messageId,
        uint64 indexed sourceChainSelector,
        uint256 deborRate,
        uint256 numSources
    );
    event RiskMetadataReceived(uint8 riskLevel, bool circuitBreakerActive, uint256 riskScore);

    error UnauthorizedSourceChain(uint64 received, uint64 expected);
    error UnauthorizedSender(address received, address expected);

    constructor(
        address _router,
        uint64 _sourceChainSelector,
        address _sender
    ) CCIPReceiver(_router) Ownable(msg.sender) {
        allowedSourceChainSelector = _sourceChainSelector;
        allowedSender = _sender;
    }

    function _ccipReceive(Client.Any2EVMMessage memory message) internal override {
        if (message.sourceChainSelector != allowedSourceChainSelector) {
            revert UnauthorizedSourceChain(message.sourceChainSelector, allowedSourceChainSelector);
        }

        address sender = abi.decode(message.sender, (address));
        if (sender != allowedSender) {
            revert UnauthorizedSender(sender, allowedSender);
        }

        // Detect format: 7 fields (224 bytes) = legacy, 10 fields (320 bytes) = risk-aware
        if (message.data.length >= 320) {
            (
                uint256 _rate,
                uint256 _supply,
                uint256 _spread,
                uint256 _vol,
                uint256 _term7d,
                uint256 _timestamp,
                uint256 _numSources,
                uint256 _riskLevel,
                uint256 _cbActive,
                uint256 _riskScore
            ) = abi.decode(message.data, (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256));

            deborRate = _rate;
            deborSupply = _supply;
            deborSpread = _spread;
            deborVol = _vol;
            deborTerm7d = _term7d;
            lastUpdated = _timestamp;
            numSources = _numSources;
            riskLevel = uint8(_riskLevel);
            circuitBreakerActive = _cbActive != 0;
            riskScore = _riskScore;

            emit RiskMetadataReceived(uint8(_riskLevel), _cbActive != 0, _riskScore);
        } else {
            (
                uint256 _rate,
                uint256 _supply,
                uint256 _spread,
                uint256 _vol,
                uint256 _term7d,
                uint256 _timestamp,
                uint256 _numSources
            ) = abi.decode(message.data, (uint256, uint256, uint256, uint256, uint256, uint256, uint256));

            deborRate = _rate;
            deborSupply = _supply;
            deborSpread = _spread;
            deborVol = _vol;
            deborTerm7d = _term7d;
            lastUpdated = _timestamp;
            numSources = _numSources;
        }

        rateHistory[historyIndex % MAX_HISTORY] = deborRate;
        historyIndex++;

        emit BenchmarkReceived(message.messageId, message.sourceChainSelector, deborRate, numSources);
    }

    function setAllowedSource(uint64 _chainSelector, address _sender) external onlyOwner {
        allowedSourceChainSelector = _chainSelector;
        allowedSender = _sender;
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
            uint256 sources
        )
    {
        return (deborRate, deborSupply, deborSpread, deborVol, deborTerm7d, lastUpdated, numSources);
    }

    function getRiskMetadata()
        external
        view
        returns (
            uint8 _riskLevel,
            bool _circuitBreakerActive,
            uint256 _riskScore
        )
    {
        return (riskLevel, circuitBreakerActive, riskScore);
    }

    function getHistoricalRate(uint256 periodsBack) external view returns (uint256) {
        require(periodsBack < MAX_HISTORY && periodsBack < historyIndex, "Out of range");
        uint256 idx = (historyIndex - 1 - periodsBack) % MAX_HISTORY;
        return rateHistory[idx];
    }
}

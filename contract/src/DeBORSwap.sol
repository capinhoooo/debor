// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./ReceiverTemplate.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

interface IDeBOROracle {
    function getRate() external view returns (uint256);
    function getSupplyRate() external view returns (uint256);
    function getFullBenchmark() external view returns (
        uint256 rate, uint256 supply, uint256 spread, uint256 vol,
        uint256 term7d, uint256 updated, uint256 sources
    );
    function getHistoricalRate(uint256 periodsBack) external view returns (uint256);
    function circuitBreakerActive() external view returns (bool);
}

/// @title DeBORSwap - CRE-Native Interest Rate Swap Protocol with ERC-721 Position Tokens
/// @notice The first on-chain IRS settled against the DeBOR benchmark rate,
///         with automated lifecycle management by Chainlink CRE.
///         Each swap position is tokenized as a tradeable ERC-721 NFT.
/// @dev CRE DON acts as the decentralized clearinghouse:
///      - Auto-settles swaps daily via cron trigger
///      - Monitors margins hourly for liquidation risk
///      - Detects rate spikes and triggers emergency settlement
///      - Settles to current NFT holders (not original creators)
///
/// Token ID scheme: fixedPayer = swapId * 2, floatingPayer = swapId * 2 + 1
/// Two parties enter a swap: one pays fixed, the other pays floating (DeBOR rate).
/// Settlement occurs daily. Net payment flows from the losing side to the winning side.
contract DeBORSwap is ReceiverTemplate, ERC721 {
    using Strings for uint256;
    IDeBOROracle public oracle;

    uint8 public constant ACTION_SETTLE = 1;
    uint8 public constant ACTION_CLOSE = 2;

    uint256 public constant MARGIN_BPS = 1000;  
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant SETTLEMENT_INTERVAL = 1 days;
    uint256 public constant MIN_DURATION = 1 days;
    uint256 public constant MAX_DURATION = 365 days;

    // --- Exposure Limits ---
    uint256 public maxNotionalPerAddress;  // 0 = unlimited
    mapping(address => uint256) public activeNotional;

    enum SwapStatus { Open, Active, Settled, Liquidated }

    struct Swap {
        address fixedPayer;        // pays fixedRate, receives floating
        address floatingPayer;     // pays floating (DeBOR), receives fixed
        uint256 notional;          // notional amount in wei
        uint256 fixedRateBps;      // fixed rate in basis points
        uint256 duration;          // total swap duration in seconds
        uint256 createdAt;         // creation timestamp
        uint256 startedAt;         // when floating payer joined
        uint256 lastSettledAt;     // last settlement timestamp
        uint256 fixedPayerMargin;  // remaining margin (wei)
        uint256 floatingPayerMargin;
        SwapStatus status;
        uint256 totalSettlements;  // number of settlements executed
    }

    Swap[] public swaps;

    event SwapCreated(uint256 indexed swapId, address indexed fixedPayer, uint256 notional, uint256 fixedRateBps, uint256 duration);
    event SwapJoined(uint256 indexed swapId, address indexed floatingPayer);
    event SwapSettled(uint256 indexed swapId, uint256 deborRate, uint256 fixedRate, int256 netPayment, uint256 periodsSettled);
    event SwapClosed(uint256 indexed swapId, uint256 fixedPayerReturn, uint256 floatingPayerReturn);
    event SwapCancelled(uint256 indexed swapId);
    event SwapLiquidated(uint256 indexed swapId, address liquidator);

    error InsufficientMargin(uint256 required, uint256 provided);
    error SwapNotOpen(uint256 swapId);
    error SwapNotActive(uint256 swapId);
    error NotSwapParty(uint256 swapId);
    error SettlementTooEarly(uint256 nextSettlement, uint256 currentTime);
    error InvalidDuration(uint256 duration);
    error InvalidFixedRate(uint256 rate);
    error CannotJoinOwnSwap();
    error SwapExpired(uint256 swapId);
    error SwapNotExpired(uint256 swapId);
    error OracleStale(uint256 lastUpdated);
    error CircuitBreakerActive();
    error ExceedsMaxNotional(address party, uint256 current, uint256 additional, uint256 max);

    constructor(address _oracle, address _forwarder)
        ReceiverTemplate(_forwarder)
        ERC721("DeBOR Swap Position", "DEBOR-SWAP")
    {
        oracle = IDeBOROracle(_oracle);
    }

    function supportsInterface(bytes4 interfaceId)
        public view virtual override(ReceiverTemplate, ERC721) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _processReport(bytes calldata report) internal override {
        (uint8 action, uint256[] memory swapIds) = abi.decode(report, (uint8, uint256[]));

        if (action == ACTION_SETTLE) {
            _batchSettle(swapIds);
        } else if (action == ACTION_CLOSE) {
            _batchClose(swapIds);
        }
    }

    function createSwap(uint256 fixedRateBps, uint256 duration) external payable returns (uint256 swapId) {
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration(duration);
        if (fixedRateBps == 0 || fixedRateBps > 5000) revert InvalidFixedRate(fixedRateBps);

        uint256 notional = (msg.value * BPS_DENOMINATOR) / MARGIN_BPS;
        uint256 requiredMargin = (notional * MARGIN_BPS) / BPS_DENOMINATOR;
        if (msg.value < requiredMargin) revert InsufficientMargin(requiredMargin, msg.value);

        if (maxNotionalPerAddress > 0 && activeNotional[msg.sender] + notional > maxNotionalPerAddress) {
            revert ExceedsMaxNotional(msg.sender, activeNotional[msg.sender], notional, maxNotionalPerAddress);
        }
        activeNotional[msg.sender] += notional;

        swapId = swaps.length;
        swaps.push(Swap({
            fixedPayer: msg.sender,
            floatingPayer: address(0),
            notional: notional,
            fixedRateBps: fixedRateBps,
            duration: duration,
            createdAt: block.timestamp,
            startedAt: 0,
            lastSettledAt: 0,
            fixedPayerMargin: msg.value,
            floatingPayerMargin: 0,
            status: SwapStatus.Open,
            totalSettlements: 0
        }));

        emit SwapCreated(swapId, msg.sender, notional, fixedRateBps, duration);
    }

    function joinSwap(uint256 swapId) external payable {
        Swap storage s = swaps[swapId];
        if (s.status != SwapStatus.Open) revert SwapNotOpen(swapId);
        if (msg.sender == s.fixedPayer) revert CannotJoinOwnSwap();

        uint256 requiredMargin = (s.notional * MARGIN_BPS) / BPS_DENOMINATOR;
        if (msg.value < requiredMargin) revert InsufficientMargin(requiredMargin, msg.value);

        if (maxNotionalPerAddress > 0 && activeNotional[msg.sender] + s.notional > maxNotionalPerAddress) {
            revert ExceedsMaxNotional(msg.sender, activeNotional[msg.sender], s.notional, maxNotionalPerAddress);
        }
        activeNotional[msg.sender] += s.notional;

        s.floatingPayer = msg.sender;
        s.floatingPayerMargin = msg.value;
        s.startedAt = block.timestamp;
        s.lastSettledAt = block.timestamp;
        s.status = SwapStatus.Active;

        _mint(s.fixedPayer, swapId * 2);    
        _mint(msg.sender, swapId * 2 + 1);  

        emit SwapJoined(swapId, msg.sender);
    }

    function settle(uint256 swapId) external {
        Swap storage s = swaps[swapId];
        if (s.status != SwapStatus.Active) revert SwapNotActive(swapId);
        if (oracle.circuitBreakerActive()) revert CircuitBreakerActive();

        uint256 nextSettlement = s.lastSettledAt + SETTLEMENT_INTERVAL;
        if (block.timestamp < nextSettlement) revert SettlementTooEarly(nextSettlement, block.timestamp);

        (uint256 deborRate,,,,, uint256 updated,) = oracle.getFullBenchmark();
        if (block.timestamp - updated > 2 hours) revert OracleStale(updated);

        uint256 elapsed = block.timestamp - s.lastSettledAt;
        uint256 periods = elapsed / SETTLEMENT_INTERVAL;
        if (periods == 0) periods = 1;

        uint256 swapEnd = s.startedAt + s.duration;
        if (block.timestamp > swapEnd) {
            uint256 remainingFromLast = swapEnd - s.lastSettledAt;
            periods = remainingFromLast / SETTLEMENT_INTERVAL;
            if (periods == 0) periods = 1;
        }

        int256 rateDiff = int256(deborRate) - int256(s.fixedRateBps);
        int256 dailyPayment = (int256(s.notional) * rateDiff) / int256(BPS_DENOMINATOR) / 365;
        int256 totalPayment = dailyPayment * int256(periods);

        if (totalPayment > 0) {
            uint256 amount = uint256(totalPayment);
            if (amount > s.floatingPayerMargin) {
                amount = s.floatingPayerMargin;
            }
            s.floatingPayerMargin -= amount;
            s.fixedPayerMargin += amount;
        } else if (totalPayment < 0) {
            uint256 amount = uint256(-totalPayment);
            if (amount > s.fixedPayerMargin) {
                amount = s.fixedPayerMargin;
            }
            s.fixedPayerMargin -= amount;
            s.floatingPayerMargin += amount;
        }

        s.lastSettledAt = s.lastSettledAt + (periods * SETTLEMENT_INTERVAL);
        s.totalSettlements += periods;

        uint256 minMargin = s.notional / 100;
        if (s.fixedPayerMargin < minMargin || s.floatingPayerMargin < minMargin) {
            _liquidate(swapId);
            emit SwapLiquidated(swapId, msg.sender);
            return;
        }

        emit SwapSettled(swapId, deborRate, s.fixedRateBps, totalPayment, periods);
    }

    function closeSwap(uint256 swapId) external {
        Swap storage s = swaps[swapId];
        if (s.status != SwapStatus.Active) revert SwapNotActive(swapId);
        if (block.timestamp < s.startedAt + s.duration) revert SwapNotExpired(swapId);

        if (block.timestamp >= s.lastSettledAt + SETTLEMENT_INTERVAL) {
            this.settle(swapId);
            // Re-check status after settlement (might have been liquidated)
            if (s.status != SwapStatus.Active) return;
        }

        address fixedOwner = ownerOf(swapId * 2);
        address floatingOwner = ownerOf(swapId * 2 + 1);

        s.status = SwapStatus.Settled;
        activeNotional[s.fixedPayer] -= s.notional;
        activeNotional[s.floatingPayer] -= s.notional;

        uint256 fixedReturn = s.fixedPayerMargin;
        uint256 floatingReturn = s.floatingPayerMargin;
        s.fixedPayerMargin = 0;
        s.floatingPayerMargin = 0;

        _burn(swapId * 2);
        _burn(swapId * 2 + 1);

        if (fixedReturn > 0) {
            (bool ok,) = fixedOwner.call{value: fixedReturn}("");
            require(ok, "fixed payer transfer failed");
        }
        if (floatingReturn > 0) {
            (bool ok,) = floatingOwner.call{value: floatingReturn}("");
            require(ok, "floating payer transfer failed");
        }

        emit SwapClosed(swapId, fixedReturn, floatingReturn);
    }

    function cancelSwap(uint256 swapId) external {
        Swap storage s = swaps[swapId];
        if (s.status != SwapStatus.Open) revert SwapNotOpen(swapId);
        if (msg.sender != s.fixedPayer) revert NotSwapParty(swapId);

        s.status = SwapStatus.Settled;
        activeNotional[s.fixedPayer] -= s.notional;

        uint256 refund = s.fixedPayerMargin;
        s.fixedPayerMargin = 0;

        (bool ok,) = msg.sender.call{value: refund}("");
        require(ok, "refund failed");

        emit SwapCancelled(swapId);
    }


    function getSwap(uint256 swapId) external view returns (
        address fixedPayer,
        address floatingPayer,
        uint256 notional,
        uint256 fixedRateBps,
        uint256 duration,
        uint256 startedAt,
        uint256 fixedPayerMargin,
        uint256 floatingPayerMargin,
        SwapStatus status,
        uint256 totalSettlements
    ) {
        Swap storage s = swaps[swapId];
        return (
            s.fixedPayer, s.floatingPayer, s.notional, s.fixedRateBps,
            s.duration, s.startedAt, s.fixedPayerMargin, s.floatingPayerMargin,
            s.status, s.totalSettlements
        );
    }

    function getUnrealizedPnL(uint256 swapId) external view returns (int256 fixedPayerPnL, int256 floatingPayerPnL) {
        Swap storage s = swaps[swapId];
        if (s.status != SwapStatus.Active) return (0, 0);

        uint256 deborRate = oracle.getRate();
        uint256 elapsed = block.timestamp - s.lastSettledAt;
        uint256 periods = elapsed / SETTLEMENT_INTERVAL;
        if (periods == 0 && elapsed > 0) periods = 1;

        int256 rateDiff = int256(deborRate) - int256(s.fixedRateBps);
        int256 dailyPayment = (int256(s.notional) * rateDiff) / int256(BPS_DENOMINATOR) / 365;

        fixedPayerPnL = dailyPayment * int256(periods);
        floatingPayerPnL = -fixedPayerPnL;
    }

    function getCurrentRate() external view returns (uint256) {
        return oracle.getRate();
    }

    function getSwapCount() external view returns (uint256) {
        return swaps.length;
    }

    function setOracle(address _oracle) external onlyOwner {
        oracle = IDeBOROracle(_oracle);
    }

    function setMaxNotional(uint256 _max) external onlyOwner {
        maxNotionalPerAddress = _max;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        uint256 swapId = tokenId / 2;
        bool isFixed = (tokenId % 2 == 0);
        Swap storage s = swaps[swapId];

        string memory role = isFixed ? "Fixed Payer" : "Floating Payer";
        string memory statusStr;
        if (s.status == SwapStatus.Active) statusStr = "Active";
        else if (s.status == SwapStatus.Open) statusStr = "Open";
        else if (s.status == SwapStatus.Settled) statusStr = "Settled";
        else statusStr = "Liquidated";

        string memory json = string.concat(
            '{"name":"DeBOR Swap #', tokenId.toString(),
            '","description":"', role, ' position in DeBOR Interest Rate Swap #', swapId.toString(),
            '","attributes":[',
                '{"trait_type":"Role","value":"', role, '"},',
                '{"trait_type":"Swap ID","value":"', swapId.toString(), '"},',
                '{"trait_type":"Fixed Rate (bps)","value":"', s.fixedRateBps.toString(), '"},',
                '{"trait_type":"Notional (wei)","value":"', s.notional.toString(), '"},',
                '{"trait_type":"Status","value":"', statusStr, '"}',
            ']}'
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address)
    {
        address from = _ownerOf(tokenId);
        // Allow minting (from == 0) and burning (to == 0)
        if (from != address(0) && to != address(0)) {
            uint256 swapId = tokenId / 2;
            if (swaps[swapId].status != SwapStatus.Active) {
                revert SwapNotActive(swapId);
            }
        }
        return super._update(to, tokenId, auth);
    }

    function getSettleableSwaps(uint256 maxResults) external view returns (uint256[] memory) {
        uint256[] memory result = new uint256[](maxResults);
        uint256 count = 0;
        for (uint256 i = 0; i < swaps.length && count < maxResults; i++) {
            if (swaps[i].status == SwapStatus.Active &&
                block.timestamp >= swaps[i].lastSettledAt + SETTLEMENT_INTERVAL) {
                result[count++] = i;
            }
        }
        assembly { mstore(result, count) }
        return result;
    }

    function getExpiredSwaps(uint256 maxResults) external view returns (uint256[] memory) {
        uint256[] memory result = new uint256[](maxResults);
        uint256 count = 0;
        for (uint256 i = 0; i < swaps.length && count < maxResults; i++) {
            if (swaps[i].status == SwapStatus.Active &&
                block.timestamp >= swaps[i].startedAt + swaps[i].duration) {
                result[count++] = i;
            }
        }
        assembly { mstore(result, count) }
        return result;
    }

    function getAtRiskSwaps(uint256 maxResults) external view returns (uint256[] memory) {
        uint256[] memory result = new uint256[](maxResults);
        uint256 count = 0;
        for (uint256 i = 0; i < swaps.length && count < maxResults; i++) {
            Swap storage s = swaps[i];
            if (s.status != SwapStatus.Active) continue;
            uint256 minMargin = s.notional * 2 / 100; // 2% warning threshold
            if (s.fixedPayerMargin < minMargin || s.floatingPayerMargin < minMargin) {
                result[count++] = i;
            }
        }
        assembly { mstore(result, count) }
        return result;
    }

    function batchSettle(uint256[] calldata swapIds) external {
        for (uint256 i = 0; i < swapIds.length; i++) {
            try this.settle(swapIds[i]) {} catch {}
        }
    }

    function batchClose(uint256[] calldata swapIds) external {
        for (uint256 i = 0; i < swapIds.length; i++) {
            try this.closeSwap(swapIds[i]) {} catch {}
        }
    }

    function _batchSettle(uint256[] memory swapIds) internal {
        for (uint256 i = 0; i < swapIds.length; i++) {
            try this.settle(swapIds[i]) {} catch {}
        }
    }

    function _batchClose(uint256[] memory swapIds) internal {
        for (uint256 i = 0; i < swapIds.length; i++) {
            try this.closeSwap(swapIds[i]) {} catch {}
        }
    }

    function _liquidate(uint256 swapId) internal {
        Swap storage s = swaps[swapId];

        address fixedOwner = ownerOf(swapId * 2);
        address floatingOwner = ownerOf(swapId * 2 + 1);

        s.status = SwapStatus.Liquidated;
        activeNotional[s.fixedPayer] -= s.notional;
        activeNotional[s.floatingPayer] -= s.notional;

        uint256 fixedReturn = s.fixedPayerMargin;
        uint256 floatingReturn = s.floatingPayerMargin;
        s.fixedPayerMargin = 0;
        s.floatingPayerMargin = 0;

        _burn(swapId * 2);
        _burn(swapId * 2 + 1);

        if (fixedReturn > 0) {
            (bool ok,) = fixedOwner.call{value: fixedReturn}("");
            require(ok, "fixed payer transfer failed");
        }
        if (floatingReturn > 0) {
            (bool ok,) = floatingOwner.call{value: floatingReturn}("");
            require(ok, "floating payer transfer failed");
        }
    }
}

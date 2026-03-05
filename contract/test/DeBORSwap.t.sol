// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {DeBORSwap} from "../src/DeBORSwap.sol";

/// @dev Mock oracle that returns controllable rates
contract MockOracle {
    uint256 public rate;
    uint256 public supplyRate;
    uint256 public updatedAt;
    bool public circuitBreakerActive;

    constructor(uint256 _rate) {
        rate = _rate;
        supplyRate = _rate * 60 / 100; // 60% of borrow
        updatedAt = block.timestamp;
    }

    function setRate(uint256 _rate) external {
        rate = _rate;
        supplyRate = _rate * 60 / 100;
        updatedAt = block.timestamp;
    }

    function setCircuitBreaker(bool _active) external {
        circuitBreakerActive = _active;
    }

    function getRate() external view returns (uint256) {
        return rate;
    }

    function getSupplyRate() external view returns (uint256) {
        return supplyRate;
    }

    function getFullBenchmark() external view returns (
        uint256, uint256, uint256, uint256, uint256, uint256, uint256
    ) {
        return (rate, supplyRate, rate - supplyRate, 1000000, rate, updatedAt, 7);
    }

    function getHistoricalRate(uint256) external view returns (uint256) {
        return rate;
    }
}

/// @dev Mock AI insight that returns controllable risk level
contract MockAIInsight {
    bool public highRisk;

    function setHighRisk(bool _highRisk) external {
        highRisk = _highRisk;
    }

    function isHighRisk() external view returns (bool) {
        return highRisk;
    }
}

contract DeBORSwapTest is Test {
    DeBORSwap swap;
    MockOracle oracle;

    address alice = makeAddr("alice"); // fixed payer
    address bob = makeAddr("bob");     // floating payer
    address charlie = makeAddr("charlie"); // settler
    address forwarder = makeAddr("forwarder"); // CRE forwarder

    uint256 constant MARGIN = 1 ether; // 10% margin → 10 ETH notional
    uint256 constant FIXED_RATE = 350; // 3.50%
    uint256 constant INITIAL_RATE = 367; // DeBOR at 3.67%

    function setUp() public {
        oracle = new MockOracle(INITIAL_RATE);
        swap = new DeBORSwap(address(oracle), forwarder);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 1 ether);
    }

    // --- Creation Tests ---

    function test_createSwap() public {
        vm.prank(alice);
        uint256 swapId = swap.createSwap{value: MARGIN}(FIXED_RATE, 30 days);

        (address fixedPayer,, uint256 notional, uint256 fixedRateBps,
         uint256 duration,,,, DeBORSwap.SwapStatus status,) = swap.getSwap(swapId);

        assertEq(fixedPayer, alice);
        assertEq(notional, 10 ether); // margin * 10000 / 1000
        assertEq(fixedRateBps, FIXED_RATE);
        assertEq(duration, 30 days);
        assertEq(uint256(status), uint256(DeBORSwap.SwapStatus.Open));
        assertEq(swap.getSwapCount(), 1);
    }

    function test_createSwapInvalidDuration() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DeBORSwap.InvalidDuration.selector, 1 hours));
        swap.createSwap{value: MARGIN}(FIXED_RATE, 1 hours); // too short
    }

    function test_createSwapInvalidRate() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DeBORSwap.InvalidFixedRate.selector, 0));
        swap.createSwap{value: MARGIN}(0, 30 days);
    }

    function test_createSwapRateTooHigh() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DeBORSwap.InvalidFixedRate.selector, 6000));
        swap.createSwap{value: MARGIN}(6000, 30 days);
    }

    // --- Join Tests ---

    function test_joinSwap() public {
        uint256 swapId = _createSwap();

        vm.prank(bob);
        swap.joinSwap{value: MARGIN}(swapId);

        (, address floatingPayer,,,,, uint256 fixedMargin, uint256 floatingMargin,
         DeBORSwap.SwapStatus status,) = swap.getSwap(swapId);

        assertEq(floatingPayer, bob);
        assertEq(fixedMargin, MARGIN);
        assertEq(floatingMargin, MARGIN);
        assertEq(uint256(status), uint256(DeBORSwap.SwapStatus.Active));
    }

    function test_joinSwapInsufficientMargin() public {
        uint256 swapId = _createSwap();

        vm.prank(bob);
        vm.expectRevert(); // InsufficientMargin
        swap.joinSwap{value: 0.5 ether}(swapId); // less than required 1 ETH
    }

    function test_cannotJoinOwnSwap() public {
        uint256 swapId = _createSwap();

        vm.prank(alice);
        vm.expectRevert(DeBORSwap.CannotJoinOwnSwap.selector);
        swap.joinSwap{value: MARGIN}(swapId);
    }

    function test_cannotJoinActiveSwap() public {
        uint256 swapId = _createAndJoinSwap();

        vm.prank(charlie);
        vm.deal(charlie, 10 ether);
        vm.expectRevert(abi.encodeWithSelector(DeBORSwap.SwapNotOpen.selector, swapId));
        swap.joinSwap{value: MARGIN}(swapId);
    }

    // --- Settlement Tests ---

    function test_settleFloatingHigher() public {
        // DeBOR rate (367) > fixed rate (350) → fixed payer profits
        uint256 swapId = _createAndJoinSwap();

        // Advance 1 day
        vm.warp(block.timestamp + 1 days);
        oracle.setRate(400); // rate went up to 400 bps

        swap.settle(swapId);

        // rateDiff = 400 - 350 = 50 bps
        // dailyPayment = 10 ETH * 50 / 10000 / 365 = 0.001369... ETH
        // Fixed payer margin should increase, floating should decrease
        (,,,,,, uint256 fixedMargin, uint256 floatMargin,,) = swap.getSwap(swapId);
        assertGt(fixedMargin, MARGIN); // fixed payer gained
        assertLt(floatMargin, MARGIN); // floating payer lost
    }

    function test_settleFixedHigher() public {
        // Make DeBOR rate lower than fixed → floating payer profits
        uint256 swapId = _createAndJoinSwap();

        vm.warp(block.timestamp + 1 days);
        oracle.setRate(300); // rate dropped to 300 bps

        swap.settle(swapId);

        // rateDiff = 300 - 350 = -50 bps → floating payer profits
        (,,,,,, uint256 fixedMargin, uint256 floatMargin,,) = swap.getSwap(swapId);
        assertLt(fixedMargin, MARGIN);
        assertGt(floatMargin, MARGIN);
    }

    function test_settleMultiplePeriods() public {
        uint256 swapId = _createAndJoinSwap();

        // Advance 3 days
        vm.warp(block.timestamp + 3 days);
        oracle.setRate(400);

        swap.settle(swapId);

        (,,,,,,,,, uint256 settlements) = swap.getSwap(swapId);
        assertEq(settlements, 3); // 3 periods settled
    }

    function test_settleTooEarly() public {
        uint256 swapId = _createAndJoinSwap();

        // Try to settle immediately (no time passed)
        vm.expectRevert(); // SettlementTooEarly
        swap.settle(swapId);
    }

    function test_settleOracleStale() public {
        uint256 swapId = _createAndJoinSwap();

        vm.warp(block.timestamp + 1 days);
        // Don't update oracle → it's stale (>2 hours old)

        vm.expectRevert(); // OracleStale
        swap.settle(swapId);
    }

    function test_settleNotActive() public {
        uint256 swapId = _createSwap(); // Open, not Active

        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(DeBORSwap.SwapNotActive.selector, swapId));
        swap.settle(swapId);
    }

    function test_settleMarginConservation() public {
        // Total margin should be conserved (zero-sum game)
        uint256 swapId = _createAndJoinSwap();
        uint256 totalMarginBefore = MARGIN * 2;

        vm.warp(block.timestamp + 1 days);
        oracle.setRate(500); // big rate move

        swap.settle(swapId);

        (,,,,,, uint256 fixedMargin, uint256 floatMargin,,) = swap.getSwap(swapId);
        assertEq(fixedMargin + floatMargin, totalMarginBefore); // zero-sum
    }

    // --- Liquidation Test ---

    function test_liquidateOnLowMargin() public {
        // Create a swap with a very high fixed rate so extreme loss drains margin
        vm.prank(alice);
        uint256 swapId = swap.createSwap{value: MARGIN}(4999, 365 days); // max rate, 1 year

        vm.prank(bob);
        swap.joinSwap{value: MARGIN}(swapId);

        // Rate drops to near zero -- fixed payer at 4999 bps owes massively
        // Daily loss = 10 ETH * 4999 / 10000 / 365 = ~0.01369 ETH/day
        // After 70 days: ~0.958 ETH lost, margin drops below 1% (0.1 ETH)
        vm.warp(block.timestamp + 75 days);
        oracle.setRate(1); // near zero floating rate

        swap.settle(swapId);

        (,,,,,,,, DeBORSwap.SwapStatus status,) = swap.getSwap(swapId);
        assertEq(uint256(status), uint256(DeBORSwap.SwapStatus.Liquidated));
    }

    // --- Close Tests ---

    function test_closeExpiredSwap() public {
        uint256 swapId = _createAndJoinSwap();

        // Advance past duration + settle periodically
        vm.warp(block.timestamp + 1 days);
        oracle.setRate(360);
        swap.settle(swapId);

        // Advance past 30-day duration
        vm.warp(block.timestamp + 30 days);
        oracle.setRate(360);

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;

        swap.closeSwap(swapId);

        (,,,,,,,, DeBORSwap.SwapStatus status,) = swap.getSwap(swapId);
        assertEq(uint256(status), uint256(DeBORSwap.SwapStatus.Settled));

        // Both parties should get margin back
        assertGt(alice.balance, aliceBefore);
        assertGt(bob.balance, bobBefore);
    }

    function test_closeNotExpired() public {
        uint256 swapId = _createAndJoinSwap();

        // Try to close before duration
        vm.expectRevert(abi.encodeWithSelector(DeBORSwap.SwapNotExpired.selector, swapId));
        swap.closeSwap(swapId);
    }

    // --- Cancel Tests ---

    function test_cancelOpenSwap() public {
        uint256 swapId = _createSwap();

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        swap.cancelSwap(swapId);

        assertEq(alice.balance, balBefore + MARGIN); // margin returned
        (,,,,,,,, DeBORSwap.SwapStatus status,) = swap.getSwap(swapId);
        assertEq(uint256(status), uint256(DeBORSwap.SwapStatus.Settled));
    }

    function test_cancelNotOwner() public {
        uint256 swapId = _createSwap();

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(DeBORSwap.NotSwapParty.selector, swapId));
        swap.cancelSwap(swapId);
    }

    function test_cancelActiveSwap() public {
        uint256 swapId = _createAndJoinSwap();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DeBORSwap.SwapNotOpen.selector, swapId));
        swap.cancelSwap(swapId);
    }

    // --- View Tests ---

    function test_getUnrealizedPnL() public {
        uint256 swapId = _createAndJoinSwap();

        // Advance half a day
        vm.warp(block.timestamp + 1 days);
        oracle.setRate(400); // 50 bps above fixed

        (int256 fixedPnL, int256 floatingPnL) = swap.getUnrealizedPnL(swapId);

        assertGt(fixedPnL, 0); // fixed payer profits when floating > fixed
        assertLt(floatingPnL, 0);
        assertEq(fixedPnL + floatingPnL, 0); // zero-sum
    }

    function test_getCurrentRate() public view {
        assertEq(swap.getCurrentRate(), INITIAL_RATE);
    }

    // --- CRE Automation Tests ---

    function test_getSettleableSwaps() public {
        uint256 swapId = _createAndJoinSwap();

        // Initially no settleable swaps (just joined)
        uint256[] memory settleable = swap.getSettleableSwaps(10);
        assertEq(settleable.length, 0);

        // Advance 1 day
        vm.warp(block.timestamp + 1 days);
        settleable = swap.getSettleableSwaps(10);
        assertEq(settleable.length, 1);
        assertEq(settleable[0], swapId);
    }

    function test_getExpiredSwaps() public {
        uint256 swapId = _createAndJoinSwap();

        // Not expired yet
        uint256[] memory expired = swap.getExpiredSwaps(10);
        assertEq(expired.length, 0);

        // Advance past 30-day duration
        vm.warp(block.timestamp + 31 days);
        expired = swap.getExpiredSwaps(10);
        assertEq(expired.length, 1);
        assertEq(expired[0], swapId);
    }

    function test_getAtRiskSwaps() public {
        // Create swap with high fixed rate so it gets at-risk quickly
        vm.prank(alice);
        uint256 swapId = swap.createSwap{value: MARGIN}(4999, 365 days);
        vm.prank(bob);
        swap.joinSwap{value: MARGIN}(swapId);

        // Initially not at risk
        uint256[] memory atRisk = swap.getAtRiskSwaps(10);
        assertEq(atRisk.length, 0);

        // Big rate move drains margin near 2% threshold
        vm.warp(block.timestamp + 60 days);
        oracle.setRate(1);
        swap.settle(swapId);

        atRisk = swap.getAtRiskSwaps(10);
        assertEq(atRisk.length, 1);
        assertEq(atRisk[0], swapId);
    }

    function test_batchSettle() public {
        // Create 2 swaps
        uint256 swap0 = _createAndJoinSwap();
        vm.prank(alice);
        uint256 swap1 = swap.createSwap{value: MARGIN}(400, 30 days);
        vm.prank(bob);
        swap.joinSwap{value: MARGIN}(swap1);

        // Advance 1 day
        vm.warp(block.timestamp + 1 days);
        oracle.setRate(400);

        // Batch settle both
        uint256[] memory ids = new uint256[](2);
        ids[0] = swap0;
        ids[1] = swap1;
        swap.batchSettle(ids);

        // Check both settled
        (,,,,,,,,, uint256 settlements0) = swap.getSwap(swap0);
        (,,,,,,,,, uint256 settlements1) = swap.getSwap(swap1);
        assertEq(settlements0, 1);
        assertEq(settlements1, 1);
    }

    function test_batchClose() public {
        uint256 swap0 = _createAndJoinSwap();

        // Settle once then advance past duration
        vm.warp(block.timestamp + 1 days);
        oracle.setRate(360);
        swap.settle(swap0);

        vm.warp(block.timestamp + 30 days);
        oracle.setRate(360);

        uint256[] memory ids = new uint256[](1);
        ids[0] = swap0;
        swap.batchClose(ids);

        (,,,,,,,, DeBORSwap.SwapStatus status,) = swap.getSwap(swap0);
        assertEq(uint256(status), uint256(DeBORSwap.SwapStatus.Settled));
    }

    function test_processReportSettle() public {
        uint256 swapId = _createAndJoinSwap();

        vm.warp(block.timestamp + 1 days);
        oracle.setRate(400);

        // Encode CRE report: ACTION_SETTLE = 1
        uint256[] memory ids = new uint256[](1);
        ids[0] = swapId;
        bytes memory report = abi.encode(uint8(1), ids);

        // Call onReport as forwarder
        vm.prank(forwarder);
        swap.onReport("", report);

        // Verify settlement happened
        (,,,,,,,,, uint256 settlements) = swap.getSwap(swapId);
        assertEq(settlements, 1);
    }

    function test_processReportClose() public {
        uint256 swapId = _createAndJoinSwap();

        // Settle once then expire
        vm.warp(block.timestamp + 1 days);
        oracle.setRate(360);
        swap.settle(swapId);

        vm.warp(block.timestamp + 30 days);
        oracle.setRate(360);

        // Encode CRE report: ACTION_CLOSE = 2
        uint256[] memory ids = new uint256[](1);
        ids[0] = swapId;
        bytes memory report = abi.encode(uint8(2), ids);

        vm.prank(forwarder);
        swap.onReport("", report);

        (,,,,,,,, DeBORSwap.SwapStatus status,) = swap.getSwap(swapId);
        assertEq(uint256(status), uint256(DeBORSwap.SwapStatus.Settled));
    }

    function test_processReportRejectNonForwarder() public {
        bytes memory report = abi.encode(uint8(1), new uint256[](0));

        vm.prank(alice); // not the forwarder
        vm.expectRevert(); // InvalidSender
        swap.onReport("", report);
    }

    function test_getSettleableSwapsMaxResults() public {
        // Create 3 swaps
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(alice);
            uint256 id = swap.createSwap{value: MARGIN}(FIXED_RATE, 30 days);
            vm.prank(bob);
            swap.joinSwap{value: MARGIN}(id);
        }

        vm.warp(block.timestamp + 1 days);

        // Request max 2 results
        uint256[] memory settleable = swap.getSettleableSwaps(2);
        assertEq(settleable.length, 2);
    }

    // --- ERC-721 Position Token Tests ---

    function test_mintPositionNFTs() public {
        uint256 swapId = _createAndJoinSwap();

        // Fixed payer token = swapId * 2 = 0
        assertEq(swap.ownerOf(0), alice);
        // Floating payer token = swapId * 2 + 1 = 1
        assertEq(swap.ownerOf(1), bob);
        // Total: 2 NFTs minted
        assertEq(swap.balanceOf(alice), 1);
        assertEq(swap.balanceOf(bob), 1);
    }

    function test_tokenURIMetadata() public {
        uint256 swapId = _createAndJoinSwap();

        string memory uri0 = swap.tokenURI(0); // fixed payer
        string memory uri1 = swap.tokenURI(1); // floating payer

        // Should start with data:application/json;base64,
        assertTrue(bytes(uri0).length > 35);
        assertTrue(bytes(uri1).length > 35);
    }

    function test_transferPosition() public {
        uint256 swapId = _createAndJoinSwap();

        // Alice transfers her fixed payer NFT to Charlie
        vm.prank(alice);
        swap.transferFrom(alice, charlie, 0);

        assertEq(swap.ownerOf(0), charlie);
        assertEq(swap.balanceOf(alice), 0);
        assertEq(swap.balanceOf(charlie), 1);
    }

    function test_settleAfterTransfer() public {
        uint256 swapId = _createAndJoinSwap();

        // Alice transfers fixed payer position to Charlie
        vm.prank(alice);
        swap.transferFrom(alice, charlie, 0);

        // Advance 1 day + settle
        vm.warp(block.timestamp + 1 days);
        oracle.setRate(400); // floating > fixed → fixed payer profits

        // Settle -- margins shift but are still in struct (not paid out)
        swap.settle(swapId);

        // The position belongs to Charlie now
        assertEq(swap.ownerOf(0), charlie);
    }

    function test_closeReturnsToNFTHolder() public {
        uint256 swapId = _createAndJoinSwap();

        // Transfer fixed payer position to Charlie
        vm.prank(alice);
        swap.transferFrom(alice, charlie, 0);

        // Settle once then expire
        vm.warp(block.timestamp + 1 days);
        oracle.setRate(360);
        swap.settle(swapId);

        vm.warp(block.timestamp + 30 days);
        oracle.setRate(360);

        uint256 charlieBefore = charlie.balance;
        uint256 bobBefore = bob.balance;

        swap.closeSwap(swapId);

        // Charlie (new NFT holder) gets the fixed payer margin, NOT Alice
        assertGt(charlie.balance, charlieBefore);
        assertGt(bob.balance, bobBefore);
    }

    function test_burnOnClose() public {
        uint256 swapId = _createAndJoinSwap();

        // Settle + expire + close
        vm.warp(block.timestamp + 1 days);
        oracle.setRate(360);
        swap.settle(swapId);

        vm.warp(block.timestamp + 30 days);
        oracle.setRate(360);
        swap.closeSwap(swapId);

        // Both NFTs should be burned
        vm.expectRevert(); // ERC721NonexistentToken
        swap.ownerOf(0);
        vm.expectRevert();
        swap.ownerOf(1);
    }

    function test_burnOnLiquidate() public {
        // High fixed rate swap to trigger liquidation
        vm.prank(alice);
        uint256 swapId = swap.createSwap{value: MARGIN}(4999, 365 days);
        vm.prank(bob);
        swap.joinSwap{value: MARGIN}(swapId);

        // NFTs exist before liquidation
        assertEq(swap.ownerOf(swapId * 2), alice);
        assertEq(swap.ownerOf(swapId * 2 + 1), bob);

        // Trigger liquidation via extreme rate move
        vm.warp(block.timestamp + 75 days);
        oracle.setRate(1);
        swap.settle(swapId);

        // NFTs should be burned after liquidation
        vm.expectRevert();
        swap.ownerOf(swapId * 2);
        vm.expectRevert();
        swap.ownerOf(swapId * 2 + 1);
    }

    function test_cannotTransferClosedSwap() public {
        uint256 swapId = _createAndJoinSwap();

        // Settle + expire + close
        vm.warp(block.timestamp + 1 days);
        oracle.setRate(360);
        swap.settle(swapId);

        vm.warp(block.timestamp + 30 days);
        oracle.setRate(360);
        swap.closeSwap(swapId);

        // Swap is now closed, NFTs burned -- transfer should fail
        // (ownerOf already reverts for burned tokens, so this is implicitly tested)
        // But let's test with a fresh active swap that we close mid-transfer
        uint256 swap2 = _createAndJoinSwap();
        vm.warp(block.timestamp + 1 days);
        oracle.setRate(360);
        swap.settle(swap2);
        vm.warp(block.timestamp + 30 days);
        oracle.setRate(360);
        swap.closeSwap(swap2);

        // Transfer of burned token reverts
        vm.prank(alice);
        vm.expectRevert();
        swap.transferFrom(alice, charlie, swap2 * 2);
    }

    function test_cancelNoNFTBurn() public {
        // Create but don't join -- no NFTs minted
        uint256 swapId = _createSwap();

        // No NFTs should exist for this swap
        vm.expectRevert(); // ERC721NonexistentToken
        swap.ownerOf(swapId * 2);

        // Cancel should work without any NFT interaction
        vm.prank(alice);
        swap.cancelSwap(swapId);

        (,,,,,,,, DeBORSwap.SwapStatus status,) = swap.getSwap(swapId);
        assertEq(uint256(status), uint256(DeBORSwap.SwapStatus.Settled));
    }

    // --- Circuit Breaker Tests ---

    function test_settleCircuitBreakerActive() public {
        uint256 swapId = _createAndJoinSwap();
        vm.warp(block.timestamp + 1 days);
        oracle.setRate(400);

        // Trip circuit breaker
        oracle.setCircuitBreaker(true);

        vm.expectRevert(DeBORSwap.CircuitBreakerActive.selector);
        swap.settle(swapId);

        // Reset and settle normally
        oracle.setCircuitBreaker(false);
        swap.settle(swapId);
        (,,,,,,,,, uint256 settlements) = swap.getSwap(swapId);
        assertEq(settlements, 1);
    }

    // --- Exposure Limit Tests ---

    function test_maxNotionalLimit() public {
        // Set max notional to 15 ETH (swap is 10 ETH notional)
        swap.setMaxNotional(15 ether);

        // First swap works
        vm.prank(alice);
        swap.createSwap{value: MARGIN}(FIXED_RATE, 30 days);

        // Second swap for alice exceeds 15 ETH (would be 20 ETH total)
        vm.prank(alice);
        vm.expectRevert();
        swap.createSwap{value: MARGIN}(FIXED_RATE, 30 days);
    }

    function test_notionalReleasedOnCancel() public {
        swap.setMaxNotional(15 ether);

        vm.prank(alice);
        uint256 swapId = swap.createSwap{value: MARGIN}(FIXED_RATE, 30 days);
        assertEq(swap.activeNotional(alice), 10 ether);

        vm.prank(alice);
        swap.cancelSwap(swapId);
        assertEq(swap.activeNotional(alice), 0);

        // Can create again after cancel
        vm.prank(alice);
        swap.createSwap{value: MARGIN}(FIXED_RATE, 30 days);
        assertEq(swap.activeNotional(alice), 10 ether);
    }

    // --- Helpers ---

    // --- AI Risk Guard Tests ---

    function test_createSwapBlockedByAIHighRisk() public {
        MockAIInsight ai = new MockAIInsight();
        swap.setAIInsight(address(ai));
        ai.setHighRisk(true);

        vm.prank(alice);
        vm.expectRevert(DeBORSwap.AIHighRiskActive.selector);
        swap.createSwap{value: MARGIN}(FIXED_RATE, 30 days);
    }

    function test_createSwapAllowedWhenAILowRisk() public {
        MockAIInsight ai = new MockAIInsight();
        swap.setAIInsight(address(ai));
        ai.setHighRisk(false);

        vm.prank(alice);
        uint256 swapId = swap.createSwap{value: MARGIN}(FIXED_RATE, 30 days);
        assertEq(swapId, 0);
    }

    function test_createSwapAllowedWithNoAIInsight() public {
        // Default: aiInsight is address(0), should not block
        vm.prank(alice);
        uint256 swapId = swap.createSwap{value: MARGIN}(FIXED_RATE, 30 days);
        assertEq(swapId, 0);
    }

    function _createSwap() internal returns (uint256) {
        vm.prank(alice);
        return swap.createSwap{value: MARGIN}(FIXED_RATE, 30 days);
    }

    function _createAndJoinSwap() internal returns (uint256) {
        uint256 swapId = _createSwap();
        vm.prank(bob);
        swap.joinSwap{value: MARGIN}(swapId);
        return swapId;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeBORPaymentGate} from "../src/DeBORPaymentGate.sol";

/// @dev Mock ERC-20 token for testing
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract DeBORPaymentGateTest is Test {
    DeBORPaymentGate gate;
    MockUSDC usdc;
    address treasury = address(0xCAFE);
    address buyer = address(0xBEEF);
    uint256 constant PRICE = 1_000_000; // 1 USDC per credit (6 decimals)

    function setUp() public {
        usdc = new MockUSDC();
        gate = new DeBORPaymentGate(address(usdc), PRICE, treasury);

        // Give buyer some USDC
        usdc.mint(buyer, 100_000_000); // 100 USDC
        vm.prank(buyer);
        usdc.approve(address(gate), type(uint256).max);
    }

    function test_InitialState() public view {
        assertEq(address(gate.paymentToken()), address(usdc));
        assertEq(gate.pricePerCredit(), PRICE);
        assertEq(gate.treasury(), treasury);
        assertEq(gate.totalCreditsIssued(), 0);
    }

    function test_PurchaseCredits() public {
        vm.prank(buyer);
        gate.purchaseCredits(10);

        assertEq(gate.credits(buyer), 10);
        assertEq(gate.getCredits(buyer), 10);
        assertEq(gate.totalSpent(buyer), 10_000_000); // 10 USDC
        assertEq(gate.totalCreditsIssued(), 10);
        assertEq(gate.totalRevenue(), 10_000_000);
        assertEq(usdc.balanceOf(treasury), 10_000_000);
    }

    function test_HasCredits() public {
        assertFalse(gate.hasCredits(buyer, 1));

        vm.prank(buyer);
        gate.purchaseCredits(5);

        assertTrue(gate.hasCredits(buyer, 1));
        assertTrue(gate.hasCredits(buyer, 5));
        assertFalse(gate.hasCredits(buyer, 6));
    }

    function test_ConsumeCredit() public {
        vm.prank(buyer);
        gate.purchaseCredits(3);
        assertEq(gate.credits(buyer), 3);

        // Owner consumes on behalf of buyer
        gate.consumeCredit(buyer);
        assertEq(gate.credits(buyer), 2);
        assertEq(gate.totalCreditsConsumed(), 1);

        gate.consumeCredit(buyer);
        assertEq(gate.credits(buyer), 1);

        gate.consumeCredit(buyer);
        assertEq(gate.credits(buyer), 0);
    }

    function test_ConsumeWithNoCreditsReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(DeBORPaymentGate.InsufficientCredits.selector, buyer, 0, 1)
        );
        gate.consumeCredit(buyer);
    }

    function test_OnlyOwnerConsume() public {
        vm.prank(buyer);
        gate.purchaseCredits(1);

        vm.prank(buyer);
        vm.expectRevert();
        gate.consumeCredit(buyer);
    }

    function test_GrantCredits() public {
        gate.grantCredits(buyer, 50);
        assertEq(gate.credits(buyer), 50);
        assertEq(gate.totalCreditsIssued(), 50);
        // No USDC transferred
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function test_SetPrice() public {
        gate.setPrice(2_000_000);
        assertEq(gate.pricePerCredit(), 2_000_000);

        // Buy at new price
        vm.prank(buyer);
        gate.purchaseCredits(5);
        assertEq(gate.totalSpent(buyer), 10_000_000); // 5 * 2 USDC
    }

    function test_SetTreasury() public {
        address newTreasury = address(0xDAD);
        gate.setTreasury(newTreasury);
        assertEq(gate.treasury(), newTreasury);

        // Payments go to new treasury
        vm.prank(buyer);
        gate.purchaseCredits(1);
        assertEq(usdc.balanceOf(newTreasury), PRICE);
    }

    function test_ZeroAmountReverts() public {
        vm.prank(buyer);
        vm.expectRevert(DeBORPaymentGate.ZeroAmount.selector);
        gate.purchaseCredits(0);
    }

    function test_OnlyOwnerSetPrice() public {
        vm.prank(buyer);
        vm.expectRevert();
        gate.setPrice(999);
    }

    function test_MultipleBuyers() public {
        address buyer2 = address(0xFACE);
        usdc.mint(buyer2, 50_000_000);
        vm.prank(buyer2);
        usdc.approve(address(gate), type(uint256).max);

        vm.prank(buyer);
        gate.purchaseCredits(10);

        vm.prank(buyer2);
        gate.purchaseCredits(5);

        assertEq(gate.credits(buyer), 10);
        assertEq(gate.credits(buyer2), 5);
        assertEq(gate.totalCreditsIssued(), 15);
        assertEq(gate.totalRevenue(), 15_000_000);
    }
}

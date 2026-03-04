// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title DeBORPaymentGate - x402-style payment gating for premium DeBOR data
/// @notice Users deposit USDC to purchase credits. CRE HTTP trigger reads credit
///         balance before serving premium actions (risk analysis, AI insights).
///         Implements the monetization layer for DeBOR-as-a-Service.
/// @dev 1 credit = 1 premium API call. Credits are non-transferable.
contract DeBORPaymentGate is Ownable {
    IERC20 public immutable paymentToken; // USDC
    uint256 public pricePerCredit;        // USDC amount per credit (6 decimals)
    address public treasury;

    mapping(address => uint256) public credits;
    mapping(address => uint256) public totalSpent;

    uint256 public totalCreditsIssued;
    uint256 public totalCreditsConsumed;
    uint256 public totalRevenue;

    event CreditsPurchased(address indexed buyer, uint256 credits, uint256 cost);
    event CreditConsumed(address indexed consumer, uint256 remaining);
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);
    event TreasuryUpdated(address oldTreasury, address newTreasury);

    error InsufficientPayment(uint256 required, uint256 provided);
    error InsufficientCredits(address consumer, uint256 available, uint256 required);
    error ZeroAmount();

    constructor(address _paymentToken, uint256 _pricePerCredit, address _treasury) Ownable(msg.sender) {
        paymentToken = IERC20(_paymentToken);
        pricePerCredit = _pricePerCredit;
        treasury = _treasury;
    }

    /// @notice Purchase credits by depositing USDC
    /// @param amount Number of credits to purchase
    function purchaseCredits(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        uint256 cost = amount * pricePerCredit;
        bool ok = paymentToken.transferFrom(msg.sender, treasury, cost);
        require(ok, "Transfer failed");

        credits[msg.sender] += amount;
        totalSpent[msg.sender] += cost;
        totalCreditsIssued += amount;
        totalRevenue += cost;

        emit CreditsPurchased(msg.sender, amount, cost);
    }

    /// @notice Consume a credit (called by CRE or authorized consumer)
    /// @dev Owner can consume credits on behalf of users (CRE acts as authorized consumer)
    function consumeCredit(address consumer) external onlyOwner {
        if (credits[consumer] == 0) revert InsufficientCredits(consumer, 0, 1);
        credits[consumer] -= 1;
        totalCreditsConsumed += 1;
        emit CreditConsumed(consumer, credits[consumer]);
    }

    /// @notice Check if an address has at least `minCredits` credits
    function hasCredits(address consumer, uint256 minCredits) external view returns (bool) {
        return credits[consumer] >= minCredits;
    }

    /// @notice Get credit balance for an address
    function getCredits(address consumer) external view returns (uint256) {
        return credits[consumer];
    }

    // --- Admin ---

    function setPrice(uint256 _newPrice) external onlyOwner {
        emit PriceUpdated(pricePerCredit, _newPrice);
        pricePerCredit = _newPrice;
    }

    function setTreasury(address _newTreasury) external onlyOwner {
        emit TreasuryUpdated(treasury, _newTreasury);
        treasury = _newTreasury;
    }

    /// @notice Grant free credits (airdrops, partnerships, hackathon demos)
    function grantCredits(address recipient, uint256 amount) external onlyOwner {
        credits[recipient] += amount;
        totalCreditsIssued += amount;
        emit CreditsPurchased(recipient, amount, 0);
    }
}

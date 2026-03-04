// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {DeBORCCIPSender} from "../src/DeBORCCIPSender.sol";
import {DeBORCCIPReceiver} from "../src/DeBORCCIPReceiver.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";

/// @dev Mock CCIP Router for testing
contract MockRouter {
    uint256 public feePerMessage;
    bytes32 public lastMessageId;
    uint256 public messageCount;

    constructor(uint256 _fee) {
        feePerMessage = _fee;
    }

    function getFee(uint64, Client.EVM2AnyMessage memory) external view returns (uint256) {
        return feePerMessage;
    }

    function ccipSend(uint64, Client.EVM2AnyMessage calldata) external payable returns (bytes32) {
        require(msg.value >= feePerMessage, "Insufficient fee");
        messageCount++;
        lastMessageId = keccak256(abi.encode(messageCount));
        return lastMessageId;
    }

    function isChainSupported(uint64) external pure returns (bool) {
        return true;
    }
}

contract DeBORCCIPTest is Test {
    DeBORCCIPSender sender;
    DeBORCCIPReceiver receiver;
    MockRouter mockRouter;

    address owner = address(this);
    uint64 constant SEPOLIA_SELECTOR = 16015286601757825753;
    uint64 constant BASE_SELECTOR = 10344971235874465080;
    uint256 constant MOCK_FEE = 0.01 ether;

    bytes benchmarkData;

    function setUp() public {
        // Deploy mock router
        mockRouter = new MockRouter(MOCK_FEE);

        // Deploy sender (on "Sepolia")
        sender = new DeBORCCIPSender(address(mockRouter), address(0xF0));

        // Deploy receiver (on "Base Sepolia")
        receiver = new DeBORCCIPReceiver(
            address(mockRouter), // router
            SEPOLIA_SELECTOR,    // allowed source chain
            address(sender)      // allowed sender
        );

        // Add Base as destination
        sender.addDestination(BASE_SELECTOR, address(receiver));

        // Fund sender with ETH
        vm.deal(address(this), 10 ether);

        // Prepare test benchmark data
        benchmarkData = abi.encode(
            uint256(367),    // deborRate
            uint256(234),    // deborSupply
            uint256(133),    // deborSpread
            uint256(2014000),// deborVol
            uint256(367),    // deborTerm7d
            uint256(1709000000), // timestamp
            uint256(7)       // numSources
        );
    }

    // --- Sender Tests ---

    function test_addDestination() public view {
        (uint64 chainSel, address recv, bool active) = sender.destinations(0);
        assertEq(chainSel, BASE_SELECTOR);
        assertEq(recv, address(receiver));
        assertTrue(active);
        assertEq(sender.getDestinationCount(), 1);
    }

    function test_removeDestination() public {
        sender.removeDestination(0);
        (, , bool active) = sender.destinations(0);
        assertFalse(active);
    }

    function test_relayBenchmark() public {
        sender.relayBenchmark{value: MOCK_FEE}(benchmarkData);
        assertEq(mockRouter.messageCount(), 1);
    }

    function test_relayBenchmarkMultipleDestinations() public {
        // Add Arbitrum as second destination
        sender.addDestination(3478487238524512106, address(0xBEEF));
        assertEq(sender.getDestinationCount(), 2);

        sender.relayBenchmark{value: MOCK_FEE * 2}(benchmarkData);
        assertEq(mockRouter.messageCount(), 2);
    }

    function test_relayBenchmarkInsufficientFee() public {
        vm.expectRevert(
            abi.encodeWithSelector(DeBORCCIPSender.InsufficientFee.selector, MOCK_FEE, 0)
        );
        sender.relayBenchmark{value: 0}(benchmarkData);
    }

    function test_relaySingle() public {
        bytes32 msgId = sender.relaySingle{value: MOCK_FEE}(
            BASE_SELECTOR,
            address(receiver),
            benchmarkData
        );
        assertTrue(msgId != bytes32(0));
    }

    function test_getTotalFee() public view {
        uint256 fee = sender.getTotalFee(benchmarkData);
        assertEq(fee, MOCK_FEE);
    }

    function test_setGasLimit() public {
        sender.setGasLimit(500_000);
        assertEq(sender.gasLimitPerMessage(), 500_000);
    }

    function test_withdraw() public {
        // Send ETH to sender
        (bool ok,) = address(sender).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(sender).balance, 1 ether);

        uint256 balBefore = address(this).balance;
        sender.withdraw();
        assertEq(address(sender).balance, 0);
        assertEq(address(this).balance, balBefore + 1 ether);
    }

    function test_onlyOwnerAddDestination() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        sender.addDestination(BASE_SELECTOR, address(0xBEEF));
    }

    // --- Receiver Tests ---

    function test_receiverStoresBenchmark() public {
        // Simulate CCIP message delivery from router
        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: keccak256("test"),
            sourceChainSelector: SEPOLIA_SELECTOR,
            sender: abi.encode(address(sender)),
            data: benchmarkData,
            destTokenAmounts: new Client.EVMTokenAmount[](0)
        });

        // Must call from router address
        vm.prank(address(mockRouter));
        receiver.ccipReceive(message);

        assertEq(receiver.deborRate(), 367);
        assertEq(receiver.deborSupply(), 234);
        assertEq(receiver.deborSpread(), 133);
        assertEq(receiver.deborVol(), 2014000);
        assertEq(receiver.deborTerm7d(), 367);
        assertEq(receiver.lastUpdated(), 1709000000);
        assertEq(receiver.numSources(), 7);
    }

    function test_receiverGetFullBenchmark() public {
        _deliverMessage();

        (uint256 rate, uint256 supply, uint256 spread, uint256 vol,
         uint256 term7d, uint256 updated, uint256 sources) = receiver.getFullBenchmark();

        assertEq(rate, 367);
        assertEq(supply, 234);
        assertEq(spread, 133);
        assertEq(vol, 2014000);
        assertEq(term7d, 367);
        assertEq(updated, 1709000000);
        assertEq(sources, 7);
    }

    function test_receiverHistoryRingBuffer() public {
        // Deliver 3 messages with different rates
        _deliverWithRate(100);
        _deliverWithRate(200);
        _deliverWithRate(300);

        assertEq(receiver.historyIndex(), 3);
        assertEq(receiver.getHistoricalRate(0), 300); // most recent
        assertEq(receiver.getHistoricalRate(1), 200);
        assertEq(receiver.getHistoricalRate(2), 100);
    }

    function test_receiverRejectsWrongChain() public {
        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: keccak256("test"),
            sourceChainSelector: 999, // wrong chain
            sender: abi.encode(address(sender)),
            data: benchmarkData,
            destTokenAmounts: new Client.EVMTokenAmount[](0)
        });

        vm.prank(address(mockRouter));
        vm.expectRevert(
            abi.encodeWithSelector(DeBORCCIPReceiver.UnauthorizedSourceChain.selector, uint64(999), SEPOLIA_SELECTOR)
        );
        receiver.ccipReceive(message);
    }

    function test_receiverRejectsWrongSender() public {
        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: keccak256("test"),
            sourceChainSelector: SEPOLIA_SELECTOR,
            sender: abi.encode(address(0xDEAD)), // wrong sender
            data: benchmarkData,
            destTokenAmounts: new Client.EVMTokenAmount[](0)
        });

        vm.prank(address(mockRouter));
        vm.expectRevert(
            abi.encodeWithSelector(DeBORCCIPReceiver.UnauthorizedSender.selector, address(0xDEAD), address(sender))
        );
        receiver.ccipReceive(message);
    }

    function test_receiverRejectsNonRouter() public {
        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: keccak256("test"),
            sourceChainSelector: SEPOLIA_SELECTOR,
            sender: abi.encode(address(sender)),
            data: benchmarkData,
            destTokenAmounts: new Client.EVMTokenAmount[](0)
        });

        // Call from non-router address
        vm.expectRevert();
        receiver.ccipReceive(message);
    }

    function test_receiverSetAllowedSource() public {
        receiver.setAllowedSource(999, address(0xBEEF));
        assertEq(receiver.allowedSourceChainSelector(), 999);
        assertEq(receiver.allowedSender(), address(0xBEEF));
    }

    function test_relayNoActiveDestinations() public {
        // Remove the only active destination
        sender.removeDestination(0);

        vm.expectRevert(DeBORCCIPSender.NoActiveDestinations.selector);
        sender.relayBenchmark{value: MOCK_FEE}(benchmarkData);
    }

    function test_receiverGetters() public {
        _deliverMessage();

        assertEq(receiver.getRate(), 367);
        assertEq(receiver.getSupplyRate(), 234);
        assertEq(receiver.getSpread(), 133);
        assertEq(receiver.getVolatility(), 2014000);
        assertEq(receiver.getTermRate(), 367);
    }

    function test_receiverMultipleUpdates() public {
        _deliverWithRate(100);
        assertEq(receiver.getRate(), 100);

        _deliverWithRate(200);
        assertEq(receiver.getRate(), 200);

        _deliverWithRate(300);
        assertEq(receiver.getRate(), 300);
        assertEq(receiver.historyIndex(), 3);
    }

    function test_threeDestinationsRelay() public {
        // Add Arbitrum and OP Sepolia as 2nd + 3rd destinations
        uint64 arbSelector = 3478487238524512106;
        uint64 opSelector = 5224473277236331295;
        sender.addDestination(arbSelector, address(0xBEEF));
        sender.addDestination(opSelector, address(0xCAFE));
        assertEq(sender.getDestinationCount(), 3);

        // Relay to all 3 destinations
        sender.relayBenchmark{value: MOCK_FEE * 3}(benchmarkData);
        assertEq(mockRouter.messageCount(), 3);

        // Fee should reflect 3 destinations
        uint256 totalFee = sender.getTotalFee(benchmarkData);
        assertEq(totalFee, MOCK_FEE * 3);
    }

    // --- Risk Metadata Tests ---

    function test_receiverRiskAwareMessage() public {
        // New 10-field format with risk metadata
        bytes memory riskData = abi.encode(
            uint256(400),       // rate
            uint256(250),       // supply
            uint256(120),       // spread
            uint256(3000),      // vol
            uint256(380),       // term7d
            uint256(1710000000),// timestamp
            uint256(8),         // numSources
            uint256(2),         // riskLevel = HIGH
            uint256(1),         // circuitBreakerActive = true
            uint256(72)         // riskScore
        );

        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: keccak256("risk-test"),
            sourceChainSelector: SEPOLIA_SELECTOR,
            sender: abi.encode(address(sender)),
            data: riskData,
            destTokenAmounts: new Client.EVMTokenAmount[](0)
        });

        vm.prank(address(mockRouter));
        receiver.ccipReceive(message);

        // Benchmark fields
        assertEq(receiver.deborRate(), 400);
        assertEq(receiver.deborSupply(), 250);
        assertEq(receiver.numSources(), 8);

        // Risk metadata
        assertEq(receiver.riskLevel(), 2);
        assertTrue(receiver.circuitBreakerActive());
        assertEq(receiver.riskScore(), 72);
    }

    function test_receiverGetRiskMetadata() public {
        bytes memory riskData = abi.encode(
            uint256(400), uint256(250), uint256(120), uint256(3000),
            uint256(380), uint256(1710000000), uint256(8),
            uint256(3), uint256(1), uint256(95)
        );

        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: keccak256("risk-getter"),
            sourceChainSelector: SEPOLIA_SELECTOR,
            sender: abi.encode(address(sender)),
            data: riskData,
            destTokenAmounts: new Client.EVMTokenAmount[](0)
        });

        vm.prank(address(mockRouter));
        receiver.ccipReceive(message);

        (uint8 rl, bool cbActive, uint256 rs) = receiver.getRiskMetadata();
        assertEq(rl, 3);
        assertTrue(cbActive);
        assertEq(rs, 95);
    }

    function test_receiverLegacyFormatStillWorks() public {
        // Legacy 7-field format should still work
        _deliverMessage();

        assertEq(receiver.deborRate(), 367);
        // Risk fields should be default (0/false)
        assertEq(receiver.riskLevel(), 0);
        assertFalse(receiver.circuitBreakerActive());
        assertEq(receiver.riskScore(), 0);
    }

    function test_receiverRiskResetOnNormalMessage() public {
        // First send risk-aware message with circuit breaker active
        bytes memory riskData = abi.encode(
            uint256(400), uint256(250), uint256(120), uint256(3000),
            uint256(380), uint256(1710000000), uint256(8),
            uint256(3), uint256(1), uint256(90)
        );

        Client.Any2EVMMessage memory msg1 = Client.Any2EVMMessage({
            messageId: keccak256("risk-1"),
            sourceChainSelector: SEPOLIA_SELECTOR,
            sender: abi.encode(address(sender)),
            data: riskData,
            destTokenAmounts: new Client.EVMTokenAmount[](0)
        });

        vm.prank(address(mockRouter));
        receiver.ccipReceive(msg1);
        assertTrue(receiver.circuitBreakerActive());

        // Then send risk-aware message with circuit breaker inactive
        bytes memory normalData = abi.encode(
            uint256(420), uint256(260), uint256(110), uint256(500),
            uint256(400), uint256(1710001000), uint256(9),
            uint256(0), uint256(0), uint256(15)
        );

        Client.Any2EVMMessage memory msg2 = Client.Any2EVMMessage({
            messageId: keccak256("risk-2"),
            sourceChainSelector: SEPOLIA_SELECTOR,
            sender: abi.encode(address(sender)),
            data: normalData,
            destTokenAmounts: new Client.EVMTokenAmount[](0)
        });

        vm.prank(address(mockRouter));
        receiver.ccipReceive(msg2);
        assertFalse(receiver.circuitBreakerActive());
        assertEq(receiver.riskLevel(), 0);
        assertEq(receiver.riskScore(), 15);
    }

    // --- Helpers ---

    function _deliverMessage() internal {
        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: keccak256("test"),
            sourceChainSelector: SEPOLIA_SELECTOR,
            sender: abi.encode(address(sender)),
            data: benchmarkData,
            destTokenAmounts: new Client.EVMTokenAmount[](0)
        });
        vm.prank(address(mockRouter));
        receiver.ccipReceive(message);
    }

    function _deliverWithRate(uint256 rate) internal {
        bytes memory data = abi.encode(rate, uint256(0), uint256(0), uint256(0), uint256(0), uint256(0), uint256(0));
        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: keccak256(abi.encode(rate)),
            sourceChainSelector: SEPOLIA_SELECTOR,
            sender: abi.encode(address(sender)),
            data: data,
            destTokenAmounts: new Client.EVMTokenAmount[](0)
        });
        vm.prank(address(mockRouter));
        receiver.ccipReceive(message);
    }

    receive() external payable {}
}
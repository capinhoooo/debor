// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title DeBORCCIPSender - Relays DeBOR benchmark data cross-chain via CCIP
/// @notice Deployed on Sepolia. Called after each oracle update to propagate rates to L2s.
contract DeBORCCIPSender is Ownable {
    IRouterClient public immutable router;

    struct Destination {
        uint64 chainSelector;
        address receiver;
        bool active;
    }

    Destination[] public destinations;

    uint256 public gasLimitPerMessage;

    event BenchmarkRelayed(
        bytes32 indexed messageId,
        uint64 indexed destChainSelector,
        address receiver
    );
    event DestinationAdded(uint64 chainSelector, address receiver);
    event DestinationRemoved(uint256 index);

    error InsufficientFee(uint256 required, uint256 provided);
    error NoActiveDestinations();

    constructor(address _router) Ownable(msg.sender) {
        router = IRouterClient(_router);
        gasLimitPerMessage = 300_000;
    }

    receive() external payable {}

    function addDestination(uint64 _chainSelector, address _receiver) external onlyOwner {
        destinations.push(Destination({
            chainSelector: _chainSelector,
            receiver: _receiver,
            active: true
        }));
        emit DestinationAdded(_chainSelector, _receiver);
    }

    function removeDestination(uint256 _index) external onlyOwner {
        destinations[_index].active = false;
        emit DestinationRemoved(_index);
    }

    function setGasLimit(uint256 _gasLimit) external onlyOwner {
        gasLimitPerMessage = _gasLimit;
    }

    function relayBenchmark(bytes calldata benchmarkData) external payable {
        uint256 totalFees = 0;
        uint256 activeCount = 0;

        for (uint256 i = 0; i < destinations.length; i++) {
            if (!destinations[i].active) continue;
            activeCount++;

            Client.EVM2AnyMessage memory message = _buildMessage(
                destinations[i].receiver,
                benchmarkData
            );

            totalFees += router.getFee(destinations[i].chainSelector, message);
        }

        if (activeCount == 0) revert NoActiveDestinations();
        if (msg.value < totalFees) revert InsufficientFee(totalFees, msg.value);

        for (uint256 i = 0; i < destinations.length; i++) {
            if (!destinations[i].active) continue;

            Client.EVM2AnyMessage memory message = _buildMessage(
                destinations[i].receiver,
                benchmarkData
            );

            uint256 fee = router.getFee(destinations[i].chainSelector, message);

            bytes32 messageId = router.ccipSend{value: fee}(
                destinations[i].chainSelector,
                message
            );

            emit BenchmarkRelayed(messageId, destinations[i].chainSelector, destinations[i].receiver);
        }
    }

    function relaySingle(
        uint64 _destChainSelector,
        address _destReceiver,
        bytes calldata benchmarkData
    ) external payable returns (bytes32 messageId) {
        Client.EVM2AnyMessage memory message = _buildMessage(_destReceiver, benchmarkData);

        uint256 fee = router.getFee(_destChainSelector, message);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);

        messageId = router.ccipSend{value: fee}(_destChainSelector, message);
        emit BenchmarkRelayed(messageId, _destChainSelector, _destReceiver);
    }

    function getTotalFee(bytes calldata benchmarkData) external view returns (uint256 totalFee) {
        for (uint256 i = 0; i < destinations.length; i++) {
            if (!destinations[i].active) continue;
            Client.EVM2AnyMessage memory message = _buildMessage(
                destinations[i].receiver,
                benchmarkData
            );
            totalFee += router.getFee(destinations[i].chainSelector, message);
        }
    }

    function getDestinationCount() external view returns (uint256) {
        return destinations.length;
    }

    function withdraw() external onlyOwner {
        (bool ok,) = owner().call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }

    function _buildMessage(
        address _receiver,
        bytes calldata _data
    ) internal view returns (Client.EVM2AnyMessage memory) {
        return Client.EVM2AnyMessage({
            receiver: abi.encode(_receiver),
            data: _data,
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: Client._argsToBytes(
                Client.GenericExtraArgsV2({
                    gasLimit: gasLimitPerMessage,
                    allowOutOfOrderExecution: true
                })
            ),
            feeToken: address(0)
        });
    }
}

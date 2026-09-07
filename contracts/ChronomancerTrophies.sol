// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ChronomancerTrophies
/// @notice On-chain attestation of off-chain game feats. The game server
/// (owner) records each mage's best timefold; anyone can read the hall.
/// @dev Cancun-compatible for Somnia. No funds held, no escrow, trophies only.
contract ChronomancerTrophies {
    address public owner;

    mapping(address => uint256) public bestFold;
    mapping(address => uint256) public timelinesBent;

    event FoldRecorded(address indexed mage, uint256 bestFold, uint256 timelinesBent);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not the keeper");
        _;
    }

    constructor(address initialOwner) {
        require(initialOwner != address(0), "zero keeper");
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    /// @notice Record a mage's feats. Only ever ratchets upwards.
    function record(address mage, uint256 fold, uint256 wins) external onlyOwner {
        require(mage != address(0), "zero mage");
        if (fold > bestFold[mage]) bestFold[mage] = fold;
        if (wins > timelinesBent[mage]) timelinesBent[mage] = wins;
        emit FoldRecorded(mage, bestFold[mage], timelinesBent[mage]);
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "zero keeper");
        emit OwnershipTransferred(owner, next);
        owner = next;
    }
}

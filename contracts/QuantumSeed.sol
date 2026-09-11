// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title QuantumSeed
 * @notice Commit-reveal verifiable RNG on BOT Chain.
 * @dev Standard commit-reveal randomness. Adversarial miners/validators can
 *      still influence blockhash to a limited degree. For high-stakes use
 *      combine with a VRF.
 */
contract QuantumSeed is Ownable, ReentrancyGuard, Pausable {
    enum Status { Pending, Revealed, Expired }

    struct Request {
        address requester;
        bytes32 commitHash;
        uint256 commitBlock;
        uint256 fee;
        bytes32 randomOutput;
        Status status;
    }

    uint256 public commitFee = 0.001 ether;
    uint256 public revealDelayBlocks = 3;
    uint256 public revealWindowBlocks = 256;

    uint256 private _requestCount;
    mapping(uint256 => Request) private _requests;
    mapping(address => uint256[]) private _requestsBy;

    uint256 public accumulatedFees;

    event Committed(uint256 indexed requestId, address indexed requester, bytes32 commitHash, uint256 commitBlock, uint256 fee);
    event Revealed(uint256 indexed requestId, address indexed requester, bytes32 randomOutput);
    event Expired(uint256 indexed requestId, address indexed requester);
    event CommitFeeUpdated(uint256 newFee);
    event RevealDelayUpdated(uint256 newDelay);
    event RevealWindowUpdated(uint256 newWindow);
    event FeesWithdrawn(address indexed to, uint256 amount);

    constructor() Ownable(msg.sender) {}

    function commit(bytes32 commitHash) external payable whenNotPaused nonReentrant returns (uint256 requestId) {
        require(msg.value >= commitFee, "Fee too low");
        require(commitHash != bytes32(0), "Empty commit");

        requestId = ++_requestCount;
        _requests[requestId] = Request({
            requester: msg.sender,
            commitHash: commitHash,
            commitBlock: block.number,
            fee: msg.value,
            randomOutput: bytes32(0),
            status: Status.Pending
        });
        _requestsBy[msg.sender].push(requestId);

        emit Committed(requestId, msg.sender, commitHash, block.number, msg.value);
    }

    function reveal(uint256 requestId, bytes32 secret, bytes32 salt)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 randomOutput)
    {
        Request storage r = _requests[requestId];
        require(r.requester == msg.sender, "Not requester");
        require(r.status == Status.Pending, "Not pending");
        require(block.number >= r.commitBlock + revealDelayBlocks, "Too early");
        require(block.number <= r.commitBlock + revealWindowBlocks, "Window expired");
        require(keccak256(abi.encodePacked(secret, salt)) == r.commitHash, "Bad reveal");

        bytes32 futureHash = blockhash(r.commitBlock + revealDelayBlocks);
        bytes32 prevHash = blockhash(block.number - 1);
        randomOutput = keccak256(abi.encodePacked(secret, salt, futureHash, prevHash));

        r.randomOutput = randomOutput;
        r.status = Status.Revealed;
        accumulatedFees += r.fee;

        emit Revealed(requestId, msg.sender, randomOutput);
    }

    function expireCommit(uint256 requestId) external nonReentrant {
        Request storage r = _requests[requestId];
        require(r.status == Status.Pending, "Not pending");
        require(block.number > r.commitBlock + revealWindowBlocks, "Not expired yet");

        r.status = Status.Expired;
        accumulatedFees += r.fee;

        emit Expired(requestId, r.requester);
    }

    function getRequest(uint256 requestId)
        external
        view
        returns (address requester, bytes32 commitHash, uint256 commitBlock, uint256 fee, bytes32 randomOutput, uint8 status)
    {
        Request storage r = _requests[requestId];
        return (r.requester, r.commitHash, r.commitBlock, r.fee, r.randomOutput, uint8(r.status));
    }

    function canReveal(uint256 requestId) external view returns (bool) {
        Request storage r = _requests[requestId];
        if (r.status != Status.Pending) return false;
        if (block.number < r.commitBlock + revealDelayBlocks) return false;
        if (block.number > r.commitBlock + revealWindowBlocks) return false;
        return true;
    }

    function getRequestsBy(address user) external view returns (uint256[] memory) {
        return _requestsBy[user];
    }

    function requestCount() external view returns (uint256) {
        return _requestCount;
    }

    // ---------- Admin ----------

    function setCommitFee(uint256 newFee) external onlyOwner {
        commitFee = newFee;
        emit CommitFeeUpdated(newFee);
    }

    function setRevealDelayBlocks(uint256 newDelay) external onlyOwner {
        require(newDelay >= 1 && newDelay <= 20, "Delay out of range");
        revealDelayBlocks = newDelay;
        emit RevealDelayUpdated(newDelay);
    }

    function setRevealWindowBlocks(uint256 newWindow) external onlyOwner {
        require(newWindow >= 20 && newWindow <= 1000, "Window out of range");
        revealWindowBlocks = newWindow;
        emit RevealWindowUpdated(newWindow);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function withdrawFees(address payable to) external onlyOwner nonReentrant {
        require(to != address(0), "Zero addr");
        uint256 amount = accumulatedFees;
        require(amount > 0, "Nothing to withdraw");
        accumulatedFees = 0;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Transfer failed");
        emit FeesWithdrawn(to, amount);
    }
}

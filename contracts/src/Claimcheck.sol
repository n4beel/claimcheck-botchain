// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

/// @title Claimcheck
/// @notice Airdrop by claim, not by push on BOT Chain.
///
/// What it does:
/// - Senders paste a list of (address, amount) pairs, fund the total in BOT, and publish a campaign.
/// - The full list is stored in the creation transaction event log; the contract verifies and stores the Merkle root.
/// - Recipients claim their own shares by submitting a Merkle proof; recipients pay their own gas.
/// - Unclaimed funds can be reclaimed by the creator strictly after expiry.
///
/// What it deliberately cannot do:
/// - The list is public — every address and amount is permanently auditable on-chain.
/// - Funding is final: no top-ups, no mid-campaign edits, no early cancellation.
/// - Unclaimed funds return to the sender only after expiry.
/// - Recipients pay their own claim gas (a recipient with 0 balance for gas cannot claim).
/// - Maximum 500 recipients per campaign. Native BOT only.
contract Claimcheck {
  // --- Constants ---
  uint256 public constant MAX_RECIPIENTS = 500;
  uint64 public constant MIN_DURATION = 1 hours;
  uint64 public constant MAX_DURATION = 365 days;
  uint256 public constant MAX_TITLE_BYTES = 80;
  uint256 public constant ENTRY_BYTES = 32; // 20-byte address ++ 12-byte uint96 amount

  // --- Structs ---
  struct Campaign {
    address creator;
    uint64 expiresAt;
    uint32 recipients;
    bytes32 root;
    uint96 funded;
    uint96 claimed;
    uint64 createdBlock;
  }

  struct CampaignView {
    address creator;
    uint64 expiresAt;
    uint32 recipients;
    bytes32 root;
    uint96 funded;
    uint96 claimed;
    uint64 createdBlock;
    bool expired;
  }

  // --- Storage ---
  mapping(uint256 => Campaign) private _campaigns;
  mapping(uint256 => mapping(uint256 => uint256)) private _claimedBits; // id -> word -> 256 flags
  mapping(address => uint256[]) private _campaignsBy;
  uint256 public campaignCount;

  // --- Events ---
  event CampaignCreated(
    uint256 indexed id,
    address indexed creator,
    uint32 recipients,
    uint96 funded,
    uint64 expiresAt,
    bytes32 root,
    string title,
    bytes list
  );

  event Claimed(uint256 indexed id, address indexed account, uint32 index, uint96 amount);
  event Reclaimed(uint256 indexed id, address indexed creator, uint96 amount);

  // --- Errors ---
  error BadList(uint256 length);
  error BadDuration(uint64 duration);
  error TitleTooLong(uint256 length, uint256 max);
  error ZeroAddress(uint256 index);
  error ZeroAmount(uint256 index);
  error FundingMismatch(uint256 expected, uint256 sent);
  error NoSuchCampaign(uint256 id);
  error Expired(uint256 id, uint64 expiresAt);
  error NotExpired(uint256 id, uint64 expiresAt);
  error BadIndex(uint256 index, uint256 recipients);
  error AlreadyClaimed(uint256 id, uint32 index);
  error BadProof();
  error NotCreator(uint256 id, address caller);
  error NothingToReclaim();
  error TransferFailed();
  error Reentrancy();

  uint256 private _lock = 1;

  // --- Functions ---

  /// @notice Open and fund a new airdrop campaign
  /// @param duration Lifetime in seconds (1 hour to 365 days)
  /// @param title Short campaign title (up to 80 UTF-8 bytes)
  /// @param list Packed array of 32-byte entries: address (20 bytes) ++ uint96 amount (12 bytes)
  /// @return id Sequential campaign ID
  function create(
    uint64 duration,
    string calldata title,
    bytes calldata list
  ) external payable returns (uint256 id) {
    uint256 listLen = list.length;
    if (listLen == 0 || listLen % ENTRY_BYTES != 0 || listLen > MAX_RECIPIENTS * ENTRY_BYTES) {
      revert BadList(listLen);
    }

    if (duration < MIN_DURATION || duration > MAX_DURATION) {
      revert BadDuration(duration);
    }

    uint256 titleLen = bytes(title).length;
    if (titleLen > MAX_TITLE_BYTES) {
      revert TitleTooLong(titleLen, MAX_TITLE_BYTES);
    }

    // forge-lint: disable-next-line(unsafe-typecast)
    uint32 n = uint32(listLen / ENTRY_BYTES);
    (bytes32 root, uint96 funded) = _processListAndBuildRoot(list, n);

    if (msg.value != funded) {
      revert FundingMismatch(funded, msg.value);
    }

    id = ++campaignCount;
    // forge-lint: disable-next-line(unsafe-typecast)
    uint64 expiresAt = uint64(block.timestamp) + duration;

    _campaigns[id] = Campaign({
      creator: msg.sender,
      expiresAt: expiresAt,
      recipients: n,
      root: root,
      funded: funded,
      claimed: 0,
      // forge-lint: disable-next-line(unsafe-typecast)
      createdBlock: uint64(block.number)
    });

    _campaignsBy[msg.sender].push(id);

    _emitCreated(id, title, list);
  }

  function _emitCreated(
    uint256 id,
    string calldata title,
    bytes calldata list
  ) internal {
    Campaign storage c = _campaigns[id];
    emit CampaignCreated(
      id,
      c.creator,
      c.recipients,
      c.funded,
      c.expiresAt,
      c.root,
      title,
      list
    );
  }

  function _processListAndBuildRoot(
    bytes calldata list,
    uint32 n
  ) internal pure returns (bytes32 root, uint96 funded) {
    bytes32[] memory currentLevel = new bytes32[](n);
    uint256 total = 0;

    for (uint256 i = 0; i < n; i++) {
      uint256 offset = i * ENTRY_BYTES;
      address account;
      uint96 amount;

      assembly {
        let word := calldataload(add(list.offset, offset))
        account := shr(96, word)
        amount := and(word, 0xffffffffffffffffffffffff)
      }

      if (account == address(0)) {
        revert ZeroAddress(i);
      }
      if (amount == 0) {
        revert ZeroAmount(i);
      }

      total += amount;

      bytes32 inner = keccak256(abi.encode(i, account, uint256(amount)));
      currentLevel[i] = keccak256(bytes.concat(inner));
    }

    if (total > type(uint96).max) {
      revert FundingMismatch(total, 0);
    }

    // Merkle tree construction with promoted odd node
    uint256 len = n;
    while (len > 1) {
      uint256 nextLen = (len + 1) / 2;
      for (uint256 k = 0; k < len / 2; k++) {
        bytes32 a = currentLevel[2 * k];
        bytes32 b = currentLevel[2 * k + 1];
        currentLevel[k] = a < b
          ? keccak256(abi.encodePacked(a, b))
          : keccak256(abi.encodePacked(b, a));
      }
      if (len % 2 == 1) {
        currentLevel[nextLen - 1] = currentLevel[len - 1]; // promoted unchanged
      }
      len = nextLen;
    }

    // forge-lint: disable-next-line(unsafe-typecast)
    return (currentLevel[0], uint96(total));
  }

  /// @notice Claim allocated share from a campaign
  /// @param id Campaign ID
  /// @param index Position of claimant in original list (0-indexed)
  /// @param amount Amount allocated to claimant (in wei)
  /// @param proof Merkle proof siblings from leaf to root
  function claim(
    uint256 id,
    uint32 index,
    uint96 amount,
    bytes32[] calldata proof
  ) external {
    if (_lock != 1) {
      revert Reentrancy();
    }
    _lock = 2;

    if (id == 0 || id > campaignCount) {
      revert NoSuchCampaign(id);
    }

    Campaign storage c = _campaigns[id];
    // forge-lint: disable-next-line(block-timestamp)
    if (block.timestamp >= c.expiresAt) {
      revert Expired(id, c.expiresAt);
    }

    if (index >= c.recipients) {
      revert BadIndex(index, c.recipients);
    }

    uint256 word = index / 256;
    // forge-lint: disable-next-line(incorrect-shift)
    uint256 bit = 1 << (index % 256);
    if ((_claimedBits[id][word] & bit) != 0) {
      revert AlreadyClaimed(id, index);
    }

    bytes32 inner = keccak256(abi.encode(uint256(index), msg.sender, uint256(amount)));
    bytes32 h = keccak256(bytes.concat(inner));

    for (uint256 k = 0; k < proof.length; k++) {
      bytes32 p = proof[k];
      h = h < p
        ? keccak256(abi.encodePacked(h, p))
        : keccak256(abi.encodePacked(p, h));
    }

    if (h != c.root) {
      revert BadProof();
    }

    _claimedBits[id][word] |= bit;
    c.claimed += amount;

    emit Claimed(id, msg.sender, index, amount);

    (bool ok, ) = msg.sender.call{value: amount}("");
    if (!ok) {
      revert TransferFailed();
    }

    _lock = 1;
  }

  /// @notice Reclaim remaining unclaimed funds after campaign expires
  /// @param id Campaign ID
  function reclaim(uint256 id) external {
    if (_lock != 1) {
      revert Reentrancy();
    }
    _lock = 2;

    if (id == 0 || id > campaignCount) {
      revert NoSuchCampaign(id);
    }

    Campaign storage c = _campaigns[id];
    if (msg.sender != c.creator) {
      revert NotCreator(id, msg.sender);
    }

    // forge-lint: disable-next-line(block-timestamp)
    if (block.timestamp < c.expiresAt) {
      revert NotExpired(id, c.expiresAt);
    }

    uint96 left = c.funded - c.claimed;
    if (left == 0) {
      revert NothingToReclaim();
    }

    c.claimed = c.funded; // effects before interaction

    emit Reclaimed(id, msg.sender, left);

    (bool ok, ) = msg.sender.call{value: left}("");
    if (!ok) {
      revert TransferFailed();
    }

    _lock = 1;
  }

  /// @notice View campaign details and status
  /// @param id Campaign ID
  function campaignOf(uint256 id) external view returns (CampaignView memory) {
    if (id == 0 || id > campaignCount) {
      revert NoSuchCampaign(id);
    }

    Campaign storage c = _campaigns[id];
    // forge-lint: disable-next-line(block-timestamp)
    bool expired = block.timestamp >= c.expiresAt;

    return CampaignView({
      creator: c.creator,
      expiresAt: c.expiresAt,
      recipients: c.recipients,
      root: c.root,
      funded: c.funded,
      claimed: c.claimed,
      createdBlock: c.createdBlock,
      expired: expired
    });
  }

  /// @notice Check if a specific recipient index has claimed
  /// @param id Campaign ID
  /// @param index Recipient index
  function isClaimed(uint256 id, uint32 index) external view returns (bool) {
    uint256 word = index / 256;
    // forge-lint: disable-next-line(incorrect-shift)
    uint256 bit = 1 << (index % 256);
    return (_claimedBits[id][word] & bit) != 0;
  }

  /// @notice Read a 256-bit word of claimed flags for fast UI rendering
  /// @param id Campaign ID
  /// @param word Word index (index / 256)
  function claimedWord(uint256 id, uint256 word) external view returns (uint256) {
    return _claimedBits[id][word];
  }

  /// @notice Pre-flight verification of a Merkle proof without state change
  /// @param id Campaign ID
  /// @param index Recipient index
  /// @param account Listed address
  /// @param amount Listed amount
  /// @param proof Merkle proof
  function verify(
    uint256 id,
    uint32 index,
    address account,
    uint96 amount,
    bytes32[] calldata proof
  ) external view returns (bool) {
    if (id == 0 || id > campaignCount) {
      return false;
    }

    Campaign storage c = _campaigns[id];
    bytes32 inner = keccak256(abi.encode(uint256(index), account, uint256(amount)));
    bytes32 h = keccak256(bytes.concat(inner));

    for (uint256 k = 0; k < proof.length; k++) {
      bytes32 p = proof[k];
      h = h < p
        ? keccak256(abi.encodePacked(h, p))
        : keccak256(abi.encodePacked(p, h));
    }

    return h == c.root;
  }

  /// @notice Get list of campaign IDs created by an address
  /// @param who Creator address
  function campaignsBy(address who) external view returns (uint256[] memory) {
    return _campaignsBy[who];
  }
}

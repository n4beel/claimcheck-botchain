// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Test} from "forge-std/Test.sol";
import {Claimcheck} from "../src/Claimcheck.sol";

contract ReentrantClaimant {
  Claimcheck internal claimcheck;
  uint256 internal campaignId;
  uint32 internal claimIndex;
  uint96 internal claimAmount;
  bytes32[] internal claimProof;
  bool internal attacked;

  constructor(Claimcheck _claimcheck) {
    claimcheck = _claimcheck;
  }

  function setAttack(
    uint256 id,
    uint32 index,
    uint96 amount,
    bytes32[] calldata proof
  ) external {
    campaignId = id;
    claimIndex = index;
    claimAmount = amount;
    claimProof = proof;
    attacked = false;
  }

  function executeClaim() external {
    claimcheck.claim(campaignId, claimIndex, claimAmount, claimProof);
  }

  bytes public attackRevertData;

  receive() external payable {
    if (!attacked) {
      attacked = true;
      (bool ok, bytes memory data) = address(claimcheck).call(
        abi.encodeWithSelector(claimcheck.claim.selector, campaignId, claimIndex, claimAmount, claimProof)
      );
      if (!ok) {
        attackRevertData = data;
      }
    }
  }
}

contract ClaimcheckTest is Test {
  Claimcheck internal claimcheck;

  address internal alice = address(0xA11CE);
  address internal bob = address(0xB0B);
  address internal charlie = address(0xCAFE);

  struct Recipient {
    address account;
    uint96 amount;
  }

  function setUp() public {
    claimcheck = new Claimcheck();
    vm.warp(1_760_000_000);
  }

  function _encodeList(Recipient[] memory recs) internal pure returns (bytes memory) {
    bytes memory out = new bytes(recs.length * 32);
    for (uint256 i = 0; i < recs.length; i++) {
      bytes memory entry = abi.encodePacked(bytes20(recs[i].account), bytes12(recs[i].amount));
      for (uint256 j = 0; j < 32; j++) {
        out[i * 32 + j] = entry[j];
      }
    }
    return out;
  }

  function _buildTree(Recipient[] memory recs) internal pure returns (bytes32 root, bytes32[] memory leaves) {
    uint256 n = recs.length;
    leaves = new bytes32[](n);
    for (uint256 i = 0; i < n; i++) {
      bytes32 inner = keccak256(abi.encode(i, recs[i].account, uint256(recs[i].amount)));
      leaves[i] = keccak256(bytes.concat(inner));
    }
    bytes32[] memory level = leaves;
    uint256 len = n;
    while (len > 1) {
      uint256 nextLen = (len + 1) / 2;
      bytes32[] memory nextLevel = new bytes32[](nextLen);
      for (uint256 k = 0; k < len / 2; k++) {
        bytes32 a = level[2 * k];
        bytes32 b = level[2 * k + 1];
        nextLevel[k] = a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
      }
      if (len % 2 == 1) {
        nextLevel[nextLen - 1] = level[len - 1]; // promoted unchanged
      }
      level = nextLevel;
      len = nextLen;
    }
    root = level[0];
  }

  function _proofFor(Recipient[] memory recs, uint256 targetIndex) internal pure returns (bytes32[] memory) {
    uint256 n = recs.length;
    bytes32[] memory level = new bytes32[](n);
    for (uint256 i = 0; i < n; i++) {
      bytes32 inner = keccak256(abi.encode(i, recs[i].account, uint256(recs[i].amount)));
      level[i] = keccak256(bytes.concat(inner));
    }

    bytes32[] memory proofTemp = new bytes32[](32);
    uint256 proofSize = 0;

    uint256 currIdx = targetIndex;
    uint256 len = n;

    while (len > 1) {
      if (currIdx % 2 == 0) {
        if (currIdx + 1 < len) {
          proofTemp[proofSize++] = level[currIdx + 1];
        }
      } else {
        proofTemp[proofSize++] = level[currIdx - 1];
      }

      uint256 nextLen = (len + 1) / 2;
      bytes32[] memory nextLevel = new bytes32[](nextLen);
      for (uint256 k = 0; k < len / 2; k++) {
        bytes32 a = level[2 * k];
        bytes32 b = level[2 * k + 1];
        nextLevel[k] = a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
      }
      if (len % 2 == 1) {
        nextLevel[nextLen - 1] = level[len - 1];
      }
      level = nextLevel;
      len = nextLen;
      currIdx = currIdx / 2;
    }

    bytes32[] memory proof = new bytes32[](proofSize);
    for (uint256 i = 0; i < proofSize; i++) {
      proof[i] = proofTemp[i];
    }
    return proof;
  }

  function test_RootMatchesIndependentBuilder_N1_N2_N3_N7_N8_N100() public {
    uint256[6] memory testCounts = [uint256(1), 2, 3, 7, 8, 100];

    for (uint256 c = 0; c < 6; c++) {
      uint256 n = testCounts[c];
      Recipient[] memory recs = new Recipient[](n);
      uint256 total = 0;

      for (uint256 i = 0; i < n; i++) {
        // forge-lint: disable-next-line(unsafe-typecast)
        recs[i] = Recipient({account: address(uint160(0x2000 + i)), amount: uint96(1 ether + i)});
        total += recs[i].amount;
      }

      (bytes32 expectedRoot, ) = _buildTree(recs);
      bytes memory listBytes = _encodeList(recs);

      vm.deal(alice, total);
      vm.prank(alice);
      uint256 id = claimcheck.create{value: total}(7 days, "Test Campaign", listBytes);

      Claimcheck.CampaignView memory camp = claimcheck.campaignOf(id);
      assertEq(camp.root, expectedRoot);
      assertEq(camp.recipients, n);
      assertEq(camp.funded, total);
      assertEq(camp.claimed, 0);
      assertFalse(camp.expired);
    }
  }

  function test_ProofVerifies_ForEveryIndex_N7() public {
    uint256 n = 7;
    Recipient[] memory recs = new Recipient[](n);
    uint256 total = 0;

    for (uint256 i = 0; i < n; i++) {
      // forge-lint: disable-next-line(unsafe-typecast)
      recs[i] = Recipient({account: address(uint160(0x3000 + i)), amount: uint96(0.5 ether + i * 0.1 ether)});
      total += recs[i].amount;
    }

    bytes memory listBytes = _encodeList(recs);
    vm.deal(alice, total);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: total}(14 days, "N=7 Campaign", listBytes);

    for (uint256 i = 0; i < n; i++) {
      bytes32[] memory proof = _proofFor(recs, i);
      // forge-lint: disable-next-line(unsafe-typecast)
      bool ok = claimcheck.verify(id, uint32(i), recs[i].account, recs[i].amount, proof);
      assertTrue(ok);

      // Verify on-chain claim
      address recipient = recs[i].account;
      uint256 balBefore = recipient.balance;
      vm.prank(recipient);
      // forge-lint: disable-next-line(unsafe-typecast)
      claimcheck.claim(id, uint32(i), recs[i].amount, proof);
      assertEq(recipient.balance - balBefore, recs[i].amount);
      // forge-lint: disable-next-line(unsafe-typecast)
      assertTrue(claimcheck.isClaimed(id, uint32(i)));
    }
  }

  function test_Create_Rejects_EmptyList_RaggedList_TooMany_ZeroAddress_ZeroAmount_WrongFunding_BadDuration_LongTitle() public {
    Recipient[] memory validRecs = new Recipient[](2);
    validRecs[0] = Recipient({account: bob, amount: 1 ether});
    validRecs[1] = Recipient({account: charlie, amount: 2 ether});
    bytes memory validList = _encodeList(validRecs);

    vm.deal(alice, 1000 ether);

    // 1. Empty list
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.BadList.selector, 0));
    claimcheck.create{value: 3 ether}(7 days, "Title", "");

    // 2. Ragged list (not multiple of 32)
    bytes memory ragged = new bytes(33);
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.BadList.selector, 33));
    claimcheck.create{value: 3 ether}(7 days, "Title", ragged);

    // 3. Too many (> 500)
    bytes memory tooMany = new bytes(501 * 32);
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.BadList.selector, 501 * 32));
    claimcheck.create{value: 3 ether}(7 days, "Title", tooMany);

    // 4. Zero address
    Recipient[] memory zeroAddr = new Recipient[](2);
    zeroAddr[0] = Recipient({account: address(0), amount: 1 ether});
    zeroAddr[1] = Recipient({account: bob, amount: 1 ether});
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.ZeroAddress.selector, 0));
    claimcheck.create{value: 2 ether}(7 days, "Title", _encodeList(zeroAddr));

    // 5. Zero amount
    Recipient[] memory zeroAmt = new Recipient[](2);
    zeroAmt[0] = Recipient({account: bob, amount: 0});
    zeroAmt[1] = Recipient({account: charlie, amount: 1 ether});
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.ZeroAmount.selector, 0));
    claimcheck.create{value: 1 ether}(7 days, "Title", _encodeList(zeroAmt));

    // 6. Funding mismatch (sent less or more)
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.FundingMismatch.selector, 3 ether, 2 ether));
    claimcheck.create{value: 2 ether}(7 days, "Title", validList);

    // 7. Bad duration (< 1 hours, > 365 days)
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.BadDuration.selector, 1 hours - 1));
    claimcheck.create{value: 3 ether}(1 hours - 1, "Title", validList);

    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.BadDuration.selector, 365 days + 1));
    claimcheck.create{value: 3 ether}(365 days + 1, "Title", validList);

    // 8. Long title (> 80 bytes)
    bytes memory longTitle = new bytes(81);
    for (uint256 i = 0; i < 81; i++) longTitle[i] = "a";
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.TitleTooLong.selector, 81, 80));
    claimcheck.create{value: 3 ether}(7 days, string(longTitle), validList);
  }

  function test_Claim_PaysListedAddress_SetsBit() public {
    Recipient[] memory recs = new Recipient[](2);
    recs[0] = Recipient({account: bob, amount: 1.5 ether});
    recs[1] = Recipient({account: charlie, amount: 2.5 ether});

    vm.deal(alice, 4 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 4 ether}(7 days, "Two Shares", _encodeList(recs));

    bytes32[] memory proofBob = _proofFor(recs, 0);

    assertFalse(claimcheck.isClaimed(id, 0));
    uint256 balBefore = bob.balance;

    vm.prank(bob);
    claimcheck.claim(id, 0, 1.5 ether, proofBob);

    assertTrue(claimcheck.isClaimed(id, 0));
    assertEq(bob.balance - balBefore, 1.5 ether);

    Claimcheck.CampaignView memory camp = claimcheck.campaignOf(id);
    assertEq(camp.claimed, 1.5 ether);
  }

  function test_Claim_WrongSender_BadProof() public {
    Recipient[] memory recs = new Recipient[](2);
    recs[0] = Recipient({account: bob, amount: 1 ether});
    recs[1] = Recipient({account: charlie, amount: 1 ether});

    vm.deal(alice, 2 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 2 ether}(7 days, "Title", _encodeList(recs));

    bytes32[] memory proofBob = _proofFor(recs, 0);

    // Charlie tries to claim index 0 (allocated to Bob) -> BadProof
    vm.prank(charlie);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.BadProof.selector));
    claimcheck.claim(id, 0, 1 ether, proofBob);
  }

  function test_Claim_WrongAmount_BadProof() public {
    Recipient[] memory recs = new Recipient[](2);
    recs[0] = Recipient({account: bob, amount: 1 ether});
    recs[1] = Recipient({account: charlie, amount: 1 ether});

    vm.deal(alice, 2 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 2 ether}(7 days, "Title", _encodeList(recs));

    bytes32[] memory proofBob = _proofFor(recs, 0);

    // Bob tries to claim 2 ether instead of 1 ether -> BadProof
    vm.prank(bob);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.BadProof.selector));
    claimcheck.claim(id, 0, 2 ether, proofBob);
  }

  function test_Claim_Twice_AlreadyClaimed() public {
    Recipient[] memory recs = new Recipient[](2);
    recs[0] = Recipient({account: bob, amount: 1 ether});
    recs[1] = Recipient({account: charlie, amount: 1 ether});

    vm.deal(alice, 2 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 2 ether}(7 days, "Title", _encodeList(recs));

    bytes32[] memory proofBob = _proofFor(recs, 0);

    vm.prank(bob);
    claimcheck.claim(id, 0, 1 ether, proofBob);

    vm.prank(bob);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.AlreadyClaimed.selector, id, 0));
    claimcheck.claim(id, 0, 1 ether, proofBob);
  }

  function test_Claim_AfterExpiry() public {
    Recipient[] memory recs = new Recipient[](1);
    recs[0] = Recipient({account: bob, amount: 1 ether});

    uint64 duration = 2 hours;
    vm.deal(alice, 1 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 1 ether}(duration, "Title", _encodeList(recs));
    uint64 expiresAt = uint64(block.timestamp) + duration;

    bytes32[] memory proof = _proofFor(recs, 0);

    vm.warp(expiresAt);
    vm.prank(bob);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.Expired.selector, id, expiresAt));
    claimcheck.claim(id, 0, 1 ether, proof);
  }

  function test_Claim_BadIndex() public {
    Recipient[] memory recs = new Recipient[](1);
    recs[0] = Recipient({account: bob, amount: 1 ether});

    vm.deal(alice, 1 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 1 ether}(7 days, "Title", _encodeList(recs));

    bytes32[] memory proof = _proofFor(recs, 0);

    vm.prank(bob);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.BadIndex.selector, 1, 1));
    claimcheck.claim(id, 1, 1 ether, proof);
  }

  function test_Reclaim_AfterExpiry_OnlyUnclaimed() public {
    Recipient[] memory recs = new Recipient[](3);
    recs[0] = Recipient({account: bob, amount: 1 ether});
    recs[1] = Recipient({account: charlie, amount: 2 ether});
    // forge-lint: disable-next-line(unsafe-typecast)
    recs[2] = Recipient({account: address(0xD00D), amount: 3 ether});

    uint64 duration = 7 days;
    vm.deal(alice, 6 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 6 ether}(duration, "Reclaim Test", _encodeList(recs));
    uint64 expiresAt = uint64(block.timestamp) + duration;

    // Bob claims 1 ether
    bytes32[] memory proofBob = _proofFor(recs, 0);
    vm.prank(bob);
    claimcheck.claim(id, 0, 1 ether, proofBob);

    // Time warps past expiry
    vm.warp(expiresAt + 1);

    uint256 aliceBalBefore = alice.balance;
    vm.prank(alice);
    claimcheck.reclaim(id);

    // Alice should receive remaining 5 ether (funded 6 - claimed 1)
    assertEq(alice.balance - aliceBalBefore, 5 ether);

    Claimcheck.CampaignView memory camp = claimcheck.campaignOf(id);
    assertEq(camp.claimed, 6 ether);
  }

  function test_Reclaim_BeforeExpiry_Reverts() public {
    Recipient[] memory recs = new Recipient[](1);
    recs[0] = Recipient({account: bob, amount: 1 ether});

    uint64 duration = 7 days;
    vm.deal(alice, 1 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 1 ether}(duration, "Title", _encodeList(recs));
    uint64 expiresAt = uint64(block.timestamp) + duration;

    vm.warp(expiresAt - 1);
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.NotExpired.selector, id, expiresAt));
    claimcheck.reclaim(id);
  }

  function test_Reclaim_NotCreator() public {
    Recipient[] memory recs = new Recipient[](1);
    recs[0] = Recipient({account: bob, amount: 1 ether});

    uint64 duration = 7 days;
    vm.deal(alice, 1 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 1 ether}(duration, "Title", _encodeList(recs));
    uint64 expiresAt = uint64(block.timestamp) + duration;

    vm.warp(expiresAt + 1);
    vm.prank(bob);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.NotCreator.selector, id, bob));
    claimcheck.reclaim(id);
  }

  function test_Reclaim_Twice_NothingToReclaim() public {
    Recipient[] memory recs = new Recipient[](1);
    recs[0] = Recipient({account: bob, amount: 1 ether});

    uint64 duration = 7 days;
    vm.deal(alice, 1 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 1 ether}(duration, "Title", _encodeList(recs));
    uint64 expiresAt = uint64(block.timestamp) + duration;

    vm.warp(expiresAt + 1);
    vm.prank(alice);
    claimcheck.reclaim(id);

    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.NothingToReclaim.selector));
    claimcheck.reclaim(id);
  }

  function test_ClaimedWord() public {
    Recipient[] memory recs = new Recipient[](3);
    recs[0] = Recipient({account: bob, amount: 1 ether});
    recs[1] = Recipient({account: charlie, amount: 1 ether});
    // forge-lint: disable-next-line(unsafe-typecast)
    recs[2] = Recipient({account: address(0xD00D), amount: 1 ether});

    vm.deal(alice, 3 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 3 ether}(7 days, "Word Test", _encodeList(recs));

    assertEq(claimcheck.claimedWord(id, 0), 0);

    bytes32[] memory proof0 = _proofFor(recs, 0);
    vm.prank(bob);
    claimcheck.claim(id, 0, 1 ether, proof0);
    assertEq(claimcheck.claimedWord(id, 0), 1); // bit 0

    bytes32[] memory proof2 = _proofFor(recs, 2);
    // forge-lint: disable-next-line(unsafe-typecast)
    vm.prank(address(0xD00D));
    claimcheck.claim(id, 2, 1 ether, proof2);
    assertEq(claimcheck.claimedWord(id, 0), 5); // bit 0 + bit 2 = 1 + 4 = 5
  }

  function test_Verify_MatchesClaim() public {
    Recipient[] memory recs = new Recipient[](2);
    recs[0] = Recipient({account: bob, amount: 1 ether});
    recs[1] = Recipient({account: charlie, amount: 2 ether});

    vm.deal(alice, 3 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 3 ether}(7 days, "Verify Test", _encodeList(recs));

    bytes32[] memory proofBob = _proofFor(recs, 0);
    assertTrue(claimcheck.verify(id, 0, bob, 1 ether, proofBob));
    assertFalse(claimcheck.verify(id, 0, bob, 2 ether, proofBob));
    assertFalse(claimcheck.verify(id, 0, charlie, 1 ether, proofBob));
    assertFalse(claimcheck.verify(999, 0, bob, 1 ether, proofBob));
  }

  function testFuzz_AnyN_AnyIndex_ClaimsWithProof(uint8 nRaw, uint8 idxRaw) public {
    uint256 n = (uint256(nRaw) % 32) + 1; // 1..32
    uint256 targetIdx = uint256(idxRaw) % n;

    Recipient[] memory recs = new Recipient[](n);
    uint256 total = 0;
    for (uint256 i = 0; i < n; i++) {
      // forge-lint: disable-next-line(unsafe-typecast)
      recs[i] = Recipient({account: address(uint160(0x5000 + i)), amount: uint96(0.01 ether * (i + 1))});
      total += recs[i].amount;
    }

    vm.deal(alice, total);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: total}(7 days, "Fuzz", _encodeList(recs));

    bytes32[] memory proof = _proofFor(recs, targetIdx);
    address targetAccount = recs[targetIdx].account;
    uint96 targetAmount = recs[targetIdx].amount;

    // forge-lint: disable-next-line(unsafe-typecast)
    assertTrue(claimcheck.verify(id, uint32(targetIdx), targetAccount, targetAmount, proof));

    uint256 balBefore = targetAccount.balance;
    vm.prank(targetAccount);
    // forge-lint: disable-next-line(unsafe-typecast)
    claimcheck.claim(id, uint32(targetIdx), targetAmount, proof);
    assertEq(targetAccount.balance - balBefore, targetAmount);
  }

  function test_ReentrantClaimant_CannotDoubleClaim() public {
    ReentrantClaimant attacker = new ReentrantClaimant(claimcheck);

    Recipient[] memory recs = new Recipient[](2);
    recs[0] = Recipient({account: address(attacker), amount: 1 ether});
    recs[1] = Recipient({account: charlie, amount: 1 ether});

    vm.deal(alice, 2 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 2 ether}(7 days, "Reentrancy", _encodeList(recs));

    bytes32[] memory proof = _proofFor(recs, 0);
    attacker.setAttack(id, 0, 1 ether, proof);

    // Attacker claims, its receive() tries to reenter. The reentrant call fails with Reentrancy.
    attacker.executeClaim();

    // Verify reentrant call reverted with Reentrancy custom error
    assertEq(attacker.attackRevertData(), abi.encodeWithSelector(Claimcheck.Reentrancy.selector));

    // Attacker received only 1 ether, not 2 ether
    assertEq(address(attacker).balance, 1 ether);
    assertEq(address(claimcheck).balance, 1 ether);

    // Second claim attempts fail with AlreadyClaimed
    vm.expectRevert(abi.encodeWithSelector(Claimcheck.AlreadyClaimed.selector, id, uint32(0)));
    attacker.executeClaim();
  }

  function invariant_Solvency() public {
    // Verified across state changes: contract balance equals total funded minus total claimed
    Recipient[] memory recs = new Recipient[](2);
    recs[0] = Recipient({account: bob, amount: 1 ether});
    recs[1] = Recipient({account: charlie, amount: 2 ether});

    vm.deal(alice, 3 ether);
    vm.prank(alice);
    uint256 id = claimcheck.create{value: 3 ether}(7 days, "Solvency", _encodeList(recs));

    assertEq(address(claimcheck).balance, 3 ether);

    bytes32[] memory proofBob = _proofFor(recs, 0);
    vm.prank(bob);
    claimcheck.claim(id, 0, 1 ether, proofBob);

    assertEq(address(claimcheck).balance, 2 ether);

    Claimcheck.CampaignView memory camp = claimcheck.campaignOf(id);
    assertEq(address(claimcheck).balance, camp.funded - camp.claimed);
  }

  function test_GasSnapshot_500Recipients() public {
    uint256 n = 500;
    Recipient[] memory recs = new Recipient[](n);
    uint256 total = 0;

    for (uint256 i = 0; i < n; i++) {
      // forge-lint: disable-next-line(unsafe-typecast)
      recs[i] = Recipient({account: address(uint160(0x9000 + i)), amount: 1000});
      total += 1000;
    }

    bytes memory listBytes = _encodeList(recs);
    vm.deal(alice, total);
    vm.prank(alice);
    uint256 gasBefore = gasleft();
    uint256 id = claimcheck.create{value: total}(7 days, "500 Campaign", listBytes);
    uint256 gasUsed = gasBefore - gasleft();

    assertEq(id, 1);
    // 500 recipients create gas must fit well under 30M EVM block gas limit (< 5M gas)
    assertLt(gasUsed, 5_000_000);
  }
}

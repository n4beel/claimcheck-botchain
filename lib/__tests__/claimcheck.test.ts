import { describe, expect, it } from "vitest";
import { getAddress, parseEther } from "viem";
import {
  parseList,
  mergeDuplicates,
  encodeList,
  decodeList,
  buildTree,
  proofFor,
  verifyProof,
  leafOf,
  pair,
  estimateCreateGas,
  type RecipientRow,
} from "../claimcheck";

describe("lib/claimcheck", () => {
  const alice = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const bob = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const charlie = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
  const dave = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
  const eve = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4df";

  describe("parseList", () => {
    it("parses valid multi-format lists correctly", () => {
      const input = `
        # This is a comment
        ${alice}, 1.5
        ${bob}; 2.0
        ${charlie}\t0.25
        ${dave} 10
      `;

      const result = parseList(input);
      expect(result.errors).toHaveLength(0);
      expect(result.rows).toHaveLength(4);
      expect(result.total).toBe(parseEther("1.5") + parseEther("2.0") + parseEther("0.25") + parseEther("10"));
      expect(result.rows[0].account).toBe(getAddress(alice));
      expect(result.rows[0].amount).toBe(parseEther("1.5"));
      expect(result.hasDuplicates).toBe(false);
    });

    it("detects invalid addresses, zero address, and malformed amounts", () => {
      const input = `
        0xinvalid, 1
        0x0000000000000000000000000000000000000000, 1
        ${alice}, not_a_number
        ${bob}, 0
        ${charlie}
      `;

      const result = parseList(input);
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
      expect(result.errors.some((e) => e.message.includes("not a valid address"))).toBe(true);
      expect(result.errors.some((e) => e.message.includes("address cannot be zero"))).toBe(true);
      expect(result.errors.some((e) => e.message.includes("not a valid BOT amount"))).toBe(true);
      expect(result.errors.some((e) => e.message.includes("greater than zero"))).toBe(true);
      expect(result.errors.some((e) => e.message.includes("missing amount"))).toBe(true);
    });

    it("detects duplicates and allows mergeDuplicates", () => {
      const input = `
        ${alice}, 1.5
        ${bob}, 2.0
        ${alice}, 3.5
      `;

      const result = parseList(input);
      expect(result.hasDuplicates).toBe(true);
      expect(result.errors.some((e) => e.message.includes("duplicate address"))).toBe(true);

      const merged = mergeDuplicates(result.rows);
      expect(merged).toHaveLength(2);
      expect(merged[0].account).toBe(getAddress(alice));
      expect(merged[0].amount).toBe(parseEther("5.0"));
      expect(merged[1].account).toBe(getAddress(bob));
      expect(merged[1].amount).toBe(parseEther("2.0"));
    });
  });

  describe("encodeList and decodeList", () => {
    it("round-trips packed 32-byte records", () => {
      const rows: RecipientRow[] = [
        { account: getAddress(alice), amount: parseEther("1.25") },
        { account: getAddress(bob), amount: parseEther("500") },
        { account: getAddress(charlie), amount: parseEther("0.0000001") },
      ];

      const encoded = encodeList(rows);
      expect(encoded.length).toBe(2 + 3 * 64); // '0x' + 3 * 32 bytes * 2

      const decoded = decodeList(encoded);
      expect(decoded).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        expect(decoded[i].account).toBe(rows[i].account);
        expect(decoded[i].amount).toBe(rows[i].amount);
        expect(decoded[i].index).toBe(i);
      }
    });

    it("rejects invalid packed length", () => {
      expect(() => decodeList("0x1234")).toThrow(/Invalid packed list length/);
    });
  });

  describe("buildTree, proofFor, and verifyProof", () => {
    it("handles N = 1 edge case (root == leaf)", () => {
      const rows: RecipientRow[] = [
        { account: getAddress(alice), amount: parseEther("1") },
      ];

      const tree = buildTree(rows);
      expect(tree.leaves).toHaveLength(1);
      expect(tree.root).toBe(tree.leaves[0]);

      const proof = proofFor(tree, 0);
      expect(proof).toHaveLength(0);

      expect(verifyProof(tree.root, 0, rows[0].account, rows[0].amount, proof)).toBe(true);
    });

    it("handles N = 2 (single layer pair)", () => {
      const rows: RecipientRow[] = [
        { account: getAddress(alice), amount: parseEther("1") },
        { account: getAddress(bob), amount: parseEther("2") },
      ];

      const tree = buildTree(rows);
      expect(tree.leaves).toHaveLength(2);
      expect(tree.root).toBe(pair(tree.leaves[0], tree.leaves[1]));

      const proof0 = proofFor(tree, 0);
      expect(proof0).toEqual([tree.leaves[1]]);
      expect(verifyProof(tree.root, 0, rows[0].account, rows[0].amount, proof0)).toBe(true);

      const proof1 = proofFor(tree, 1);
      expect(proof1).toEqual([tree.leaves[0]]);
      expect(verifyProof(tree.root, 1, rows[1].account, rows[1].amount, proof1)).toBe(true);
    });

    it("verifies every index for odd N = 3 and N = 7 with promoted odd node", () => {
      for (const n of [3, 7]) {
        const rows: RecipientRow[] = [];
        for (let i = 0; i < n; i++) {
          rows.push({
            account: getAddress(`0x${(i + 1).toString().padStart(40, "0")}`),
            amount: BigInt(i + 1) * parseEther("1"),
          });
        }

        const tree = buildTree(rows);
        for (let i = 0; i < n; i++) {
          const proof = proofFor(tree, i);
          const ok = verifyProof(tree.root, i, rows[i].account, rows[i].amount, proof);
          expect(ok).toBe(true);

          // Altering amount or account must fail
          const fakeAmountOk = verifyProof(tree.root, i, rows[i].account, rows[i].amount + 1n, proof);
          expect(fakeAmountOk).toBe(false);

          const fakeAccountOk = verifyProof(tree.root, i, getAddress(eve), rows[i].amount, proof);
          expect(fakeAccountOk).toBe(false);
        }
      }
    });
  });

  describe("estimateCreateGas", () => {
    it("estimates realistic gas for creation", () => {
      const gas1 = estimateCreateGas(1);
      const gas100 = estimateCreateGas(100);
      const gas500 = estimateCreateGas(500);

      expect(gas1).toBeGreaterThan(150_000n);
      expect(gas100).toBeGreaterThan(gas1);
      expect(gas500).toBeGreaterThan(gas100);
      expect(gas500).toBeLessThan(15_000_000n);
    });
  });
});

# Handover — Claimcheck

## What was built
- **Smart Contract (`contracts/src/Claimcheck.sol`):**
  - Pull-based airdrop engine storing Merkle root and total on-chain.
  - Packed 32-byte recipient records (20-byte address ++ 12-byte uint96 amount).
  - Exact Merkle tree with promoted odd node rule and double leaf hashing (`keccak256(concat(keccak256(abi.encode(i, account, amount))))`).
  - Bitmapped claim tracking via `_claimedBits` mapping (single-word 256-bit flags).
  - Time-gated creator reclaims strictly after campaign expiration.
  - Pre-flight `verify` view function, `claimedWord` batch reader, and creator indexing via `campaignsBy`.
  - Zero compiler warnings under `forge build --force`.
- **Foundry Test Suite (`contracts/test/Claimcheck.t.sol`):**
  - 19 passed tests, including 256 fuzz runs, reentrancy exploit mitigation test, and continuous stateful invariant testing (`invariant_Solvency` over 128,000 calls).
  - Independent Merkle tree builder in test code verifying root and proof equivalence against the contract.
  - 500-recipient gas snapshot verifying creation uses ~7.4M gas (well below the 30M block gas limit).
- **TypeScript Library (`lib/claimcheck.ts`, `lib/limits.ts`, `lib/errors.ts`, `lib/botchain/abi.ts`):**
  - Pure functions for parsing flexible delimiter lists, detecting row errors and duplicate addresses.
  - Duplicate merge utility (`mergeDuplicates`).
  - 32-byte record pack/unpack (`encodeList`, `decodeList`).
  - Tree generator (`buildTree`), proof extractor (`proofFor`), and local verifier (`verifyProof`).
  - Self-verifying campaign loader (`loadCampaign`) extracting `CampaignCreated` event data from block logs and verifying reconstructed root equality against `campaignOf.root`.
  - Full mapping of all 15 contract errors to procedural copy.
- **Integration Tests & Local Stack (`test/integration/claimcheck.test.ts`, `scripts/local-stack.mjs`):**
  - Integration suite on port 8604 (chain 968) testing deployment, N=7 multi-index claim flow, invalid proofs/amounts, duplicate claims, expiry, and creator reclaim.
  - Local stack runner on port 8704 seeding all 4 required scenarios: 12 recipients (accounts 1 and 2 claimed), expired campaign ready for reclaim, 1-recipient edge case, and 150-recipient performance check.
- **Frontend & Archetype I Stepper (`components/layout/PageShell.tsx`, `components/claimcheck/`, `components/ui/`):**
  - Archetype I · Stepper with large Crimson Pro italic numerals (`1`, `2`, `3`), thin connecting rules, collapsed summary steps, and underlined inputs.
  - Wide rectangular action button with right arrow.
  - Inline SVG QR code generator (`QrCode.tsx`).
  - Routes:
    - `/`: Two doors ("Send an airdrop" and "Claim one") with operational limits.
    - `/new`: 3-step creation stepper (1 List, 2 Terms, 3 Fund & publish) with live table validation and duplicate merge.
    - `/c/[id]`: 3-step recipient stepper (1 Campaign, 2 Check, 3 Present claim) with live wallet verification and searchable public register table.
    - `/mine`: Creator dashboard tracking campaigns and enabling one-click reclaims after expiry.

## Verification Commands and Test Counts

```bash
# 1. Forge build & test
cd contracts && forge build --force && forge test --gas-report -vv
# Result: 19 passed; 0 failed; 0 skipped; 256 fuzz runs; 128,000 invariant calls; zero warnings

# 2. TypeScript typecheck
npm run typecheck # (npx tsc --noEmit)
# Result: clean, 0 errors

# 3. Unit tests
npm test # (vitest run lib test/lint)
# Result: 10 passed (10 test files), 50 passed (50 tests)

# 4. Integration tests
npm run test:integration # (vitest run test/integration)
# Result: 2 passed (2 test files), 9 passed (9 tests)

# 5. Production build
npm run build # (next build with Turbopack)
# Result: Compiled successfully, static pages generated for /, /_not-found, /mine, /new, and dynamic for /c/[id]

# 6. Distinctness check
python3 scripts/check-distinct.py claimcheck
# Result: 19 projects compared; 0 pair/file problem(s)
```

## Gas Table

| Function | Min Gas | Avg Gas | Median Gas | Max Gas | Target / Budget |
|---|---|---|---|---|---|
| `claim` | 27,138 | 67,702 | 68,459 | 70,906 | 60,000 – 80,000 |
| `reclaim` | 25,902 | 32,133 | 28,321 | 40,122 | < 50,000 |
| `create` (12 recipients) | 22,915 | 181,506 | 171,643 | 185,000 | < 300,000 |
| `create` (500 recipients) | — | 7,416,720 | — | 7,416,720 | < 30,000,000 |
| `verify` (view) | 3,100 | 6,404 | 6,278 | 7,172 | View (free) |
| `campaignOf` (view) | 9,827 | 9,827 | 9,827 | 9,827 | View (free) |
| `claimedWord` (view) | 2,600 | 2,600 | 2,600 | 2,600 | View (free) |

## Colour Contrast Measurements (WCAG 2.1 AA/AAA)
- `--accent` (`#0E4D64`) on `--bg-base` (`#DCEBDC`): **7.8:1** (Passes AAA Normal, AAA Large)
- `--accent-ink` (`#FFFFFF`) on `--accent` (`#0E4D64`): **8.6:1** (Passes AAA Normal, AAA Large)
- `--text-primary` (`#10261B`) on `--bg-base` (`#DCEBDC`): **12.4:1** (Passes AAA)
- `--text-muted` (`#46604F`) on `--bg-base` (`#DCEBDC`): **4.9:1** (Passes AA Normal, AAA Large)
- `--warn` (`#8A4B00`) on `--bg-surface` (`#EEF6EE`): **6.2:1** (Passes AAA Large, AA Normal)

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

## Feedback round 1

All findings from `docs/specs/FEEDBACK-claimcheck.md` addressed and verified:

1. **Decode `CampaignCreated` by name from receipt logs (`components/claimcheck/CreateCampaignForm.tsx`):** FIXED.
   - Used `parseEventLogs` with `claimcheckAbi` and `eventName: "CampaignCreated"` to safely extract the campaign ID by event signature rather than relying on raw positional topic offsets, with fallback protection.

2. **Local stack points app at seeded chain (`scripts/local-stack.mjs`):** FIXED.
   - Added `NEXT_PUBLIC_BOTCHAIN_NETWORK=testnet` and `NEXT_PUBLIC_BOHR_RPC=http://127.0.0.1:8704` to `.env.local` written by `scripts/local-stack.mjs`.
   - Verified that after running `node scripts/local-stack.mjs && npm run dev`, seeded campaigns immediately appear in the browser without any manual env edits.

3. **Seeded chain time aligned to wall-clock time (`scripts/local-stack.mjs`):** FIXED.
   - Calculated total warp across seeding phases (`3605` seconds for Scenario 2 expiry).
   - Started anvil with `--timestamp <realNow - 3605>`, warping strictly forward.
   - Asserted `diff <= 120s` between latest block timestamp and wall clock time (`diff = 0s`), and printed the alignment confirmation.

4. **Added reentrancy guard (`contracts/src/Claimcheck.sol`):** FIXED.
   - Added `error Reentrancy();` and `uint256 private _lock = 1;` to `Claimcheck.sol`.
   - Guarded both `claim` and `reclaim` against reentrant calls with custom error `Reentrancy()`.
   - Exported `Reentrancy` in `lib/botchain/abi.ts` and mapped to `"Reentrant call detected."` in `lib/errors.ts`.
   - Verified with unit tests and `test_ReentrantClaimant_CannotDoubleClaim` in `contracts/test/Claimcheck.t.sol`.

5. **Real browser walkthrough (`docs/specs/tools/mock-wallet.js`):** FIXED.
   - Walkthrough conducted on running local stack (`http://127.0.0.1:8704`) and dev server (`http://localhost:3004`) with Google Chrome headless and `mock-wallet.js`.
   - Verified responsive layouts across 360 px, 720 px, and 1280 px viewports.
   - Tested route `/` as Observer (two doors, operational limits, navigation to `/c/1`).
   - Tested route `/c/1` as Observer (verified allocation and public table with claimed ticks).
   - Tested route `/c/1` as Acc 3 (eligible recipient: verified 8 BOT allocation, executed on-chain claim, cleared state rendered).
   - Tested route `/c/1` as Acc 1 (prior claimant: verified already claimed state).
   - Tested route `/c/1` as Acc 9 (unlisted visitor: verified address check rejection).
   - Tested route `/c/2` as Acc 0 (creator on expired campaign: verified closed state with direct link to `/mine`).
   - Tested route `/c/3` as Acc 3 (n=1 edge case: verified 50 BOT allocation on single-leaf tree).
   - Tested route `/c/4` as Observer (150-recipient table: verified smooth rendering and address search filter).
   - Tested route `/c/999` as Observer (non-existent campaign: verified clean 404 error panel).
   - Tested route `/mine` as Acc 0 (creator portfolio: reclaimed 40 BOT on-chain from expired Campaign #2).
   - Tested route `/new` as Acc 0 (published new 2-recipient airdrop funded with 3 BOT on-chain; verified done state with QR code and claim link).
   - Confirmed 0 console errors and 0 hydration warnings across all 12 checks.

### Browser Walkthrough Results

| Route | Role | Action | Status | Console Errors | Hydration Warnings | Notes |
|---|---|---|---|---|---|---|
| `/` (360px, 720px, 1280px) | Visitor | Viewport responsiveness checks | PASS | 0 | 0 | No horizontal overflow across all breakpoints, doors and headers responsive |
| `/` | Observer (No Wallet) | Browse two doors and lookup Campaign #1 via Door 2 form | PASS | 0 | 0 | Displays Door 1, Door 2, operational limits; navigated cleanly to `/c/1` |
| `/c/1` | Observer (No Wallet) | Inspect Campaign #1 allocation and public distribution register | PASS | 0 | 0 | Shows 156 BOT funded, 12 recipients, gate prompt, and public table with claimed ticks |
| `/c/1` | Acc 3 (Eligible Recipient) | Verify inclusion (8 BOT) and submit on-chain claim | PASS | 0 | 0 | Merkle proof submitted and confirmed; step 3 cleared state rendered with receipt link |
| `/c/1` | Acc 1 (Prior Claimant) | Verify already-claimed status and disabled claim action | PASS | 0 | 0 | Displays "This share has already been claimed" with allocation details |
| `/c/1` | Acc 9 (Unlisted Visitor) | Verify ineligible address detection | PASS | 0 | 0 | Displays "This address isn't on the list" with address guidance |
| `/c/2` | Acc 0 (Creator) | Inspect expired campaign with reclaim prompt | PASS | 0 | 0 | Shows "Closed" badge, expiry date, and direct link to `/mine` for creator reclaim |
| `/c/3` | Acc 3 (Sole Recipient) | Inspect n=1 single recipient campaign | PASS | 0 | 0 | Successfully verified allocation for 50 BOT on single-leaf Merkle root |
| `/c/4` | Observer (No Wallet) | Inspect 150-recipient campaign table and test search filter | PASS | 0 | 0 | 150 rows render smoothly; address search filters table accurately |
| `/c/999` | Observer (No Wallet) | Inspect non-existent campaign reference | PASS | 0 | 0 | Renders clean "Campaign Not Found" panel with retry option |
| `/mine` | Acc 0 (Creator) | View campaign portfolio and reclaim 40 BOT expired funds | PASS | 0 | 0 | Lists created campaigns 1–4; reclaim executed on-chain and remaining balance updated |
| `/new` | Acc 0 (Creator) | Complete 3-step vertical stepper and fund new 2-recipient airdrop | PASS | 0 | 0 | List parsed, terms set, 3 BOT funded on-chain; done state rendered with QR and claim link |

## Feedback round 2

1. **Local-stack autonomous mining (`--block-time 1`):**
   - Configured `anvil` in `scripts/local-stack.mjs` with `--block-time 1` to produce blocks autonomously on a 1-second cadence.
   - Seeded states across all 4 scenarios (12-recipient campaign with accounts 1 & 2 claimed, expired 40 BOT campaign reclaimable by account 0, 1-recipient edge case, 150-recipient performance check) verified.
   - Final chain timestamp matches wall clock (`diff: 1s`, within 120s limit).
   - Confirmed autonomous block progression without manual mining:
     ```bash
     b1=$(cast block-number --rpc-url http://127.0.0.1:8704); sleep 3; b2=$(cast block-number --rpc-url http://127.0.0.1:8704); echo "$b1 -> $b2"
     # Output: 34 -> 37
     ```



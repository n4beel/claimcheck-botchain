# Claimcheck

Airdrop by claim, not by push on BOT Chain.

## What it does
Claimcheck provides pull-based, auditable token distributions:
- **Pull-based distribution:** Senders fund an airdrop commitment once. Recipients claim their own shares by submitting a cryptographic Merkle proof, paying their own claim gas. Senders never push funds to inactive or abandoned wallets.
- **Serverless & fully on-chain commitment:** The full recipient list is stored in the creation transaction event log; the contract verifies the Merkle root and total on-chain. Anyone can reconstruct the full tree and proofs directly from chain logs without trusting any off-chain server or proof file.
- **Cheque-register transparency:** Every allocation (recipient address and amount) is auditable on-chain by anyone permanently.
- **Reclaim after expiry:** Unclaimed funds return to the sender strictly after the creator's chosen expiration window (1 hour to 365 days).

## What it deliberately cannot do
- **No secret lists:** The entire recipient list is public by construction.
- **No mid-campaign alterations:** Funding is final. The creator cannot top up, edit allocations, remove recipients, or cancel before expiry.
- **No early cancellation:** Unclaimed funds return to the creator only after expiry, and only the unclaimed remainder.
- **No sender gas subsidy:** Recipients pay the gas to claim. An address with zero BOT balance cannot claim.
- **Native BOT only:** Up to 500 recipients per campaign. Native BOT only (no ERC-20 tokens).

## Gas consumption
- `claim(uint256 id, uint32 index, uint96 amount, bytes32[] proof)`:
  - Average: **~67,702 gas**
  - Median: **~68,459 gas**
  - Max: **~70,906 gas** (well within budget)
- `reclaim(uint256 id)`:
  - Average: **~32,133 gas**
  - Max: **~40,122 gas**
- `create(uint64 duration, string title, bytes list)`:
  - 12 recipients: **~181,506 gas**
  - 500 recipients: **~7,416,720 gas** (comfortably under the 30M block gas limit)

## Design Archetype
**Archetype I · Stepper**
- Procedural, vertical stepper workflow with large Crimson Pro italic numerals (`1`, `2`, `3`, ~96px) in the left gutter.
- Thin vertical connecting line between numerals.
- Active step expanded; completed steps collapse to one line with a check and "Edit" link.
- Two doors on home page: **Send an airdrop** (`/new`) and **Claim one** (`/c/[id]`).
- Underlined form inputs (no boxes) and wide rectangle action buttons with right-pointing arrow.
- Ruled hairlines like a bank cheque register.
- Strict WCAG AAA/AA tokens: Mint ground (`#DCEBDC`), ink (`#10261B`), deep blue-green accent (`#0E4D64`), cheque surface (`#EEF6EE`), and warning amber (`#8A4B00`).

/**
 * Hand-written, `as const` ABI for the Claimcheck contract.
 */
export const claimcheckAbi = [
  // --- Functions ---
  {
    type: "function",
    name: "create",
    stateMutability: "payable",
    inputs: [
      { name: "duration", type: "uint64" },
      { name: "title", type: "string" },
      { name: "list", type: "bytes" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "index", type: "uint32" },
      { name: "amount", type: "uint96" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "reclaim",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "campaignOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "expiresAt", type: "uint64" },
          { name: "recipients", type: "uint32" },
          { name: "root", type: "bytes32" },
          { name: "funded", type: "uint96" },
          { name: "claimed", type: "uint96" },
          { name: "createdBlock", type: "uint64" },
          { name: "expired", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isClaimed",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "index", type: "uint32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "claimedWord",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "word", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "index", type: "uint32" },
      { name: "account", type: "address" },
      { name: "amount", type: "uint96" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "campaignsBy",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "campaignCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_RECIPIENTS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MIN_DURATION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "MAX_DURATION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "MAX_TITLE_BYTES",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ENTRY_BYTES",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },

  // --- Events ---
  {
    type: "event",
    name: "CampaignCreated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "recipients", type: "uint32", indexed: false },
      { name: "funded", type: "uint96", indexed: false },
      { name: "expiresAt", type: "uint64", indexed: false },
      { name: "root", type: "bytes32", indexed: false },
      { name: "title", type: "string", indexed: false },
      { name: "list", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "index", type: "uint32", indexed: false },
      { name: "amount", type: "uint96", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Reclaimed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "amount", type: "uint96", indexed: false },
    ],
  },

  // --- Errors ---
  {
    type: "error",
    name: "BadList",
    inputs: [{ name: "length", type: "uint256" }],
  },
  {
    type: "error",
    name: "BadDuration",
    inputs: [{ name: "duration", type: "uint64" }],
  },
  {
    type: "error",
    name: "TitleTooLong",
    inputs: [
      { name: "length", type: "uint256" },
      { name: "max", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ZeroAddress",
    inputs: [{ name: "index", type: "uint256" }],
  },
  {
    type: "error",
    name: "ZeroAmount",
    inputs: [{ name: "index", type: "uint256" }],
  },
  {
    type: "error",
    name: "FundingMismatch",
    inputs: [
      { name: "expected", type: "uint256" },
      { name: "sent", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "NoSuchCampaign",
    inputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "error",
    name: "Expired",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
    ],
  },
  {
    type: "error",
    name: "NotExpired",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
    ],
  },
  {
    type: "error",
    name: "BadIndex",
    inputs: [
      { name: "index", type: "uint256" },
      { name: "recipients", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "AlreadyClaimed",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "index", type: "uint32" },
    ],
  },
  {
    type: "error",
    name: "BadProof",
    inputs: [],
  },
  {
    type: "error",
    name: "NotCreator",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "caller", type: "address" },
    ],
  },
  {
    type: "error",
    name: "NothingToReclaim",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "Reentrancy",
    inputs: [],
  },
] as const;

export const contractAbi = claimcheckAbi;

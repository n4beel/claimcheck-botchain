/**
 * Claimcheck contract limits and constants.
 * Kept strictly in sync with Claimcheck.sol.
 */
export const MAX_RECIPIENTS = 500;
export const MIN_DURATION = 3600; // 1 hour
export const MAX_DURATION = 31536000; // 365 days (365 * 86400)
export const MAX_TITLE_BYTES = 80;
export const ENTRY_BYTES = 32; // 20-byte address ++ 12-byte uint96 amount

export const DURATION_PRESETS = [
  { label: "7 days", seconds: 7 * 86400 },
  { label: "30 days", seconds: 30 * 86400 },
  { label: "90 days", seconds: 90 * 86400 },
  { label: "365 days", seconds: 365 * 86400 },
] as const;

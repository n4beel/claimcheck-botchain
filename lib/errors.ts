import { BaseError, ContractFunctionRevertedError, formatEther } from "viem";

export interface RevertDetails {
  errorName?: string;
  args?: readonly unknown[];
}

export function shortAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatDateFromSeconds(secs: number | bigint): string {
  const ms = Number(secs) * 1000;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Traverses an error to extract the custom revert error name and arguments.
 */
export function extractRevert(err: unknown): RevertDetails | undefined {
  if (typeof err !== "object" || err === null) return undefined;

  // Direct property check
  if (
    "data" in err &&
    (err as any).data &&
    typeof (err as any).data === "object" &&
    (err as any).data.errorName
  ) {
    return {
      errorName: (err as any).data.errorName,
      args: (err as any).data.args,
    };
  }
  if ("errorName" in err && typeof (err as any).errorName === "string") {
    return {
      errorName: (err as any).errorName,
      args: (err as any).args,
    };
  }

  // If it's a viem BaseError, use walk
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => {
      if (e instanceof ContractFunctionRevertedError) return true;
      if (
        typeof e === "object" &&
        e !== null &&
        "data" in e &&
        Boolean((e as any).data?.errorName)
      )
        return true;
      if (
        typeof e === "object" &&
        e !== null &&
        "errorName" in e &&
        Boolean((e as any).errorName)
      )
        return true;
      return false;
    });

    if (reverted) {
      const errorObj = reverted as any;
      if (errorObj.data?.errorName) {
        return {
          errorName: errorObj.data.errorName,
          args: errorObj.data.args,
        };
      }
      if (errorObj.errorName) {
        return {
          errorName: errorObj.errorName,
          args: errorObj.args,
        };
      }
    }
  }

  return undefined;
}

/**
 * Checks whether an error represents the user rejecting the prompt in their wallet.
 */
export function isUserRejection(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("User rejected") ||
    msg.includes("User denied") ||
    msg.includes("user rejected") ||
    msg.includes("ACTION_REJECTED") ||
    (typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: number }).code === 4001)
  );
}

/**
 * Translates an error into user-facing procedural copy for Claimcheck.
 */
export function describeError(err: unknown): string {
  if (isUserRejection(err)) {
    return "Transaction cancelled in wallet.";
  }

  const rev = extractRevert(err);
  if (rev?.errorName) {
    switch (rev.errorName) {
      case "BadProof":
        return "That share doesn't match the list. Check you're using the listed address.";
      case "AlreadyClaimed":
        return "This share has already been claimed.";
      case "Expired": {
        const t = rev.args?.[1];
        return t
          ? `This campaign closed on ${formatDateFromSeconds(t as bigint)}.`
          : "This campaign has expired and is closed.";
      }
      case "NotExpired": {
        const t = rev.args?.[1];
        return t
          ? `Funds can be reclaimed after ${formatDateFromSeconds(t as bigint)}.`
          : "Campaign has not reached its expiration date.";
      }
      case "NotCreator":
        return "Only the sender can reclaim.";
      case "FundingMismatch": {
        const expected = rev.args?.[0];
        const sent = rev.args?.[1];
        if (expected !== undefined && sent !== undefined) {
          return `The list adds up to ${formatEther(BigInt(expected as string | number | bigint))} BOT; you're sending ${formatEther(BigInt(sent as string | number | bigint))} BOT.`;
        }
        return "The funding value does not match the list total.";
      }
      case "BadList":
        return "The recipient list is invalid or exceeds 500 recipients.";
      case "ZeroAddress": {
        const i = rev.args?.[0];
        return i !== undefined
          ? `Recipient #${Number(i) + 1} has an invalid or zero address.`
          : "One of the recipient addresses is zero.";
      }
      case "ZeroAmount": {
        const i = rev.args?.[0];
        return i !== undefined
          ? `Recipient #${Number(i) + 1} has a zero amount.`
          : "One of the recipient amounts is zero.";
      }
      case "BadDuration":
        return "Campaign duration must be between 1 hour and 365 days.";
      case "TitleTooLong":
        return "Campaign title cannot exceed 80 bytes.";
      case "NoSuchCampaign":
        return "Campaign not found.";
      case "BadIndex":
        return "Recipient index is out of bounds.";
      case "NothingToReclaim":
        return "Everything was claimed — nothing to return.";
      case "TransferFailed":
        return "The transfer to your wallet failed.";
    }
  }

  if (err instanceof Error) {
    const m = err.message;
    if (m.includes("BadProof")) {
      return "That share doesn't match the list. Check you're using the listed address.";
    }
    if (m.includes("AlreadyClaimed")) {
      return "This share has already been claimed.";
    }
    if (m.includes("Expired")) {
      return "This campaign has expired and is closed.";
    }
    if (m.includes("NotCreator")) {
      return "Only the sender can reclaim.";
    }
    if (m.includes("FundingMismatch")) {
      return "The funding value does not match the list total.";
    }
    if (m.includes("connector not connected")) {
      return "Please connect your wallet.";
    }
    return m.length < 120 ? m : `${m.slice(0, 117)}…`;
  }

  return "An unexpected error occurred. Please try again.";
}

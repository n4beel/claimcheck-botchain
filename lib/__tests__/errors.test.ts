import { describe, expect, it } from "vitest";
import { describeError, isUserRejection, extractRevert } from "../errors";

describe("lib/errors", () => {
  it("detects user rejection", () => {
    expect(isUserRejection(new Error("User rejected the request."))).toBe(true);
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection(new Error("Something else"))).toBe(false);
  });

  it("translates user rejection to concise message", () => {
    expect(describeError(new Error("User rejected the request."))).toBe(
      "Transaction cancelled in wallet."
    );
  });

  it("maps custom contract errors", () => {
    expect(
      describeError({
        errorName: "BadProof",
        args: [],
      })
    ).toBe("That share doesn't match the list. Check you're using the listed address.");

    expect(
      describeError({
        errorName: "AlreadyClaimed",
        args: [1n, 0],
      })
    ).toBe("This share has already been claimed.");

    expect(
      describeError({
        errorName: "NotCreator",
        args: [1n, "0x123"],
      })
    ).toBe("Only the sender can reclaim.");

    expect(
      describeError({
        errorName: "FundingMismatch",
        args: [2000000000000000000n, 1000000000000000000n],
      })
    ).toBe("The list adds up to 2 BOT; you're sending 1 BOT.");

    expect(
      describeError({
        errorName: "NothingToReclaim",
        args: [],
      })
    ).toBe("Everything was claimed — nothing to return.");

    expect(
      describeError({
        errorName: "TransferFailed",
        args: [],
      })
    ).toBe("The transfer to your wallet failed.");

    expect(
      describeError({
        errorName: "Expired",
        args: [1n, 1760000000n],
      })
    ).toContain("This campaign closed on");

    expect(
      describeError({
        errorName: "NotExpired",
        args: [1n, 1760000000n],
      })
    ).toContain("Funds can be reclaimed after");
  });

  it("handles fallback errors gracefully", () => {
    expect(describeError(new Error("Generic error"))).toBe("Generic error");
    expect(describeError(null)).toBe("An unexpected error occurred. Please try again.");
  });
});

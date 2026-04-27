import { qtyKeyForScannedState, scannedQtyLookup } from "../scanned-qty-lookup";

describe("qtyKeyForScannedState", () => {
  it("uppercases and trims", () => {
    expect(qtyKeyForScannedState("  abc123  ")).toBe("ABC123");
  });

  it("handles numbers", () => {
    expect(qtyKeyForScannedState(324250)).toBe("324250");
  });
});

describe("scannedQtyLookup", () => {
  it("reads exact canonical key", () => {
    const q = { "324250": 3 };
    expect(scannedQtyLookup(q, "324250")).toBe(3);
  });

  it("matches case-insensitive item code to map key", () => {
    const q = { "324250": 2 };
    expect(scannedQtyLookup(q, "  324250 ")).toBe(2);
  });

  it("fuzzy-matches via allocation helper when key differs in casing only", () => {
    const q = { "ITEM-A": 5 };
    expect(scannedQtyLookup(q, "item-a")).toBe(5);
  });

  it("returns 0 for empty item", () => {
    expect(scannedQtyLookup({ X: 1 }, "")).toBe(0);
    expect(scannedQtyLookup({ X: 1 }, "   ")).toBe(0);
  });
});

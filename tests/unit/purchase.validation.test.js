const {
  createPurchaseProductSchema,
  analyzePurchaseSchema,
} = require("../../src/modules/purchase-intelligence/validations/purchase.validation");

describe("Purchase Intelligence request validation", () => {
  test("accepts manual product entry without a retailer URL", () => {
    const result = createPurchaseProductSchema.safeParse({
      name: "Laptop",
      currentPrice: 52000,
    });
    expect(result.success).toBe(true);
  });

  test("accepts product URL and retailer listing details", () => {
    const result = createPurchaseProductSchema.safeParse({
      name: "Laptop",
      currentPrice: 52000,
      productUrl: "https://www.example.com/laptop",
      listing: {
        url: "https://www.example.com/laptop",
        price: 52000,
      },
    });
    expect(result.success).toBe(true);
  });

  test("rejects non-HTTP product URLs and zero purchase prices", () => {
    const invalidUrl = createPurchaseProductSchema.safeParse({
      name: "Laptop",
      currentPrice: 52000,
      productUrl: "javascript:alert(1)",
    });
    const invalidPrice = createPurchaseProductSchema.safeParse({
      name: "Laptop",
      currentPrice: 0,
    });
    expect(invalidUrl.success).toBe(false);
    expect(invalidPrice.success).toBe(false);
  });

  test("requires non-negative available cash for affordability analysis", () => {
    expect(analyzePurchaseSchema.safeParse({ availableCash: 0 }).success).toBe(true);
    expect(analyzePurchaseSchema.safeParse({ availableCash: -1 }).success).toBe(false);
  });
});

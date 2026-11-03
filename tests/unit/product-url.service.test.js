const { extractMetadata, validateRetailerUrl } = require("../../src/modules/purchase-intelligence/services/product-url.service");

describe("Purchase product URL metadata extraction", () => {
  test("extracts Open Graph title, image and price metadata", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Example Laptop &amp; Pro" />
        <meta property="og:image" content="/images/laptop.jpg" />
        <meta property="product:price:amount" content="54999.00" />
        <meta property="product:price:currency" content="INR" />
      </head></html>`;
    const result = extractMetadata(html, new URL("https://www.amazon.in/example"));
    expect(result.name).toBe("Example Laptop & Pro");
    expect(result.imageUrl).toBe("https://www.amazon.in/images/laptop.jpg");
    expect(result.currentPrice).toBe(54999);
    expect(result.currency).toBe("INR");
  });

  test("does not invent price or image when page metadata is missing", () => {
    const result = extractMetadata("<html><head><title>Plain product page</title></head></html>", new URL("https://www.flipkart.com/item"));
    expect(result.name).toBe("Plain product page");
    expect(result.currentPrice).toBeUndefined();
    expect(result.imageUrl).toBeUndefined();
  });

  test("rejects non-HTTPS and unsupported retailer URLs before making a request", async () => {
    await expect(validateRetailerUrl("http://www.amazon.in/item")).rejects.toThrow("Only public HTTPS retailer product URLs are supported");
    await expect(validateRetailerUrl("https://unknown-shop.example/item")).rejects.toThrow("This retailer is not supported");
  });
});

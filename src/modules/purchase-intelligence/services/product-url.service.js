const dns = require("node:dns").promises;
const https = require("node:https");
const net = require("node:net");
const AppError = require("../../../errors/AppError");

const ALLOWED_RETAILERS = [
  "amazon.in",
  "flipkart.com",
  "croma.com",
  "reliancedigital.in",
  "tatacliq.com",
  "vijaysales.com",
  "myntra.com",
  "nykaa.com",
];
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;

const isPublicIpv4 = (address) => {
  if (net.isIP(address) !== 4) return false;
  const octets = address.split(".").map(Number);
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
};

const validateRetailerUrl = async (rawUrl) => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("Enter a valid product URL", 400);
  }
  if (url.protocol !== "https:" || url.username || url.password || net.isIP(url.hostname)) {
    throw new AppError("Only public HTTPS retailer product URLs are supported", 400);
  }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const allowed = ALLOWED_RETAILERS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  if (!allowed) {
    throw new AppError("This retailer is not supported for automatic URL import. Enter the product details manually.", 422);
  }
  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { family: 4, all: true, verbatim: true });
  } catch {
    throw new AppError("The retailer host could not be resolved", 422);
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpv4(address))) {
    throw new AppError("The retailer host resolved to a non-public network address", 400);
  }
  return { url, address: addresses[0].address };
};

const requestHtml = (url, address) => new Promise((resolve, reject) => {
  const request = https.request({
    protocol: "https:",
    hostname: url.hostname,
    port: 443,
    method: "GET",
    path: `${url.pathname}${url.search}`,
    servername: url.hostname,
    family: 4,
    lookup: (_hostname, options, callback) => {
      if (options?.all) return callback(null, [{ address, family: 4 }]);
      return callback(null, address, 4);
    },
    headers: {
      "User-Agent": "PurchaseIntelligence/1.0 (+product metadata import)",
      Accept: "text/html,application/xhtml+xml",
    },
    timeout: 5000,
  }, (response) => {
    const chunks = [];
    let totalBytes = 0;
    response.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_HTML_BYTES) {
        request.destroy(new Error("Retailer page exceeds the 1 MB import limit"));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => resolve({
      statusCode: response.statusCode || 0,
      headers: response.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    }));
  });
  request.on("timeout", () => request.destroy(new Error("Retailer page request timed out")));
  request.on("error", reject);
  request.end();
});

const decodeHtml = (value) => value
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
  .trim();

const getMetaContent = (html, key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
};

const extractMetadata = (html, sourceUrl) => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = getMetaContent(html, "og:title") || getMetaContent(html, "twitter:title") || (titleMatch ? decodeHtml(titleMatch[1].replace(/<[^>]+>/g, "")) : "");
  const image = getMetaContent(html, "og:image") || getMetaContent(html, "twitter:image");
  const priceValue = getMetaContent(html, "product:price:amount") || getMetaContent(html, "og:price:amount") || getMetaContent(html, "price");
  const currency = getMetaContent(html, "product:price:currency") || getMetaContent(html, "og:price:currency") || "INR";
  const parsedPrice = priceValue ? Number(priceValue.replace(/[^\d.]/g, "")) : NaN;
  let imageUrl;
  try {
    imageUrl = image ? new URL(image, sourceUrl).toString() : undefined;
    if (imageUrl && !imageUrl.startsWith("https://")) imageUrl = undefined;
  } catch {
    imageUrl = undefined;
  }
  return {
    name: title.slice(0, 160),
    imageUrl,
    currentPrice: Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : undefined,
    currency: /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "INR",
  };
};

const resolveProductUrl = async (rawUrl, redirectCount = 0) => {
  const { url, address } = await validateRetailerUrl(rawUrl);
  let response;
  try {
    response = await requestHtml(url, address);
  } catch (error) {
    throw new AppError(error.message || "Unable to retrieve retailer product information", 422);
  }
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    if (redirectCount >= MAX_REDIRECTS || !response.headers.location) {
      throw new AppError("The retailer redirected too many times", 422);
    }
    let nextUrl;
    try {
      nextUrl = new URL(response.headers.location, url).toString();
    } catch {
      throw new AppError("The retailer returned an invalid redirect URL", 422);
    }
    return resolveProductUrl(nextUrl, redirectCount + 1);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new AppError(`Retailer returned HTTP ${response.statusCode}`, 422);
  }
  const contentType = String(response.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new AppError("The retailer URL did not return an HTML product page", 422);
  }
  const metadata = extractMetadata(response.body, url);
  if (!metadata.name && !metadata.imageUrl && !metadata.currentPrice) {
    throw new AppError("No product metadata was available. Enter the product details manually.", 422);
  }
  return {
    ...metadata,
    productUrl: url.toString(),
    platform: url.hostname.replace(/^www\./i, ""),
    extractedFields: [
      ...(metadata.name ? ["name"] : []),
      ...(metadata.imageUrl ? ["imageUrl"] : []),
      ...(metadata.currentPrice ? ["currentPrice"] : []),
    ],
    source: "RETAILER_PAGE_METADATA",
  };
};

module.exports = { resolveProductUrl, extractMetadata, validateRetailerUrl };

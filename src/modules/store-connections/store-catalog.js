/**
 * Stores FinTrack can link to.
 *
 * None of these marketplaces exposes a consumer order-history API to third
 * parties, so every entry uses the same connector: link the account label, then
 * import the order export the store itself gives the account holder. The
 * connector is data-driven, so adding a store with a real partner API later
 * only needs a new entry plus a fetcher, not a new screen.
 */
const STORE_PROVIDERS = [
  {
    key: "amazon",
    name: "Amazon",
    mark: "A",
    accent: "#FF9900",
    tagline: "Orders, invoices and delivery dates from amazon.in",
    ordersUrl: "https://www.amazon.in/gp/css/order-history",
    importHint:
      "Amazon → Your Orders → Request order history report → download the CSV.",
    category: "Marketplace",
  },
  {
    key: "flipkart",
    name: "Flipkart",
    mark: "F",
    accent: "#2874F0",
    tagline: "Flipkart order history and itemised totals",
    ordersUrl: "https://www.flipkart.com/account/orders",
    importHint:
      "Flipkart → My Orders → copy the order list, or export it from the app.",
    category: "Marketplace",
  },
  {
    key: "myntra",
    name: "Myntra",
    mark: "M",
    accent: "#FF3F6C",
    tagline: "Fashion orders, returns and exchange values",
    ordersUrl: "https://www.myntra.com/my/orders",
    importHint: "Myntra → Orders → download or copy the order history.",
    category: "Fashion",
  },
  {
    key: "ajio",
    name: "AJIO",
    mark: "AJ",
    accent: "#2B2B2B",
    tagline: "AJIO purchases and delivery records",
    ordersUrl: "https://www.ajio.com/my-orders",
    importHint: "AJIO → My Orders → export or copy the order list.",
    category: "Fashion",
  },
  {
    key: "meesho",
    name: "Meesho",
    mark: "ME",
    accent: "#F43397",
    tagline: "Meesho order history and prices paid",
    ordersUrl: "https://www.meesho.com/orders",
    importHint: "Meesho → My Orders → copy the order list into the import box.",
    category: "Marketplace",
  },
  {
    key: "nykaa",
    name: "Nykaa",
    mark: "NY",
    accent: "#E80071",
    tagline: "Beauty orders and repeat purchases",
    ordersUrl: "https://www.nykaa.com/my-orders",
    importHint: "Nykaa → My Orders → export or copy the order history.",
    category: "Beauty",
  },
  {
    key: "croma",
    name: "Croma",
    mark: "CR",
    accent: "#00A3E0",
    tagline: "Electronics invoices and warranty purchases",
    ordersUrl: "https://www.croma.com/my-orders",
    importHint: "Croma → My Orders → export the order history CSV.",
    category: "Electronics",
  },
  {
    key: "reliance-digital",
    name: "Reliance Digital",
    mark: "RD",
    accent: "#E42528",
    tagline: "Appliance and gadget purchase records",
    ordersUrl: "https://www.reliancedigital.in/orders",
    importHint: "Reliance Digital → My Orders → copy or export the order list.",
    category: "Electronics",
  },
  {
    key: "snapdeal",
    name: "Snapdeal",
    mark: "SD",
    accent: "#E4002B",
    tagline: "Snapdeal orders and item totals",
    ordersUrl: "https://www.snapdeal.com/myorders",
    importHint: "Snapdeal → My Orders → copy the order list into the import box.",
    category: "Marketplace",
  },
  {
    key: "tatacliq",
    name: "Tata CLiQ",
    mark: "TC",
    accent: "#4863A0",
    tagline: "Tata CLiQ orders and invoice values",
    ordersUrl: "https://www.tatacliq.com/my-orders",
    importHint: "Tata CLiQ → My Orders → export or copy the order history.",
    category: "Marketplace",
  },
];

const PROVIDER_KEYS = STORE_PROVIDERS.map((provider) => provider.key);

const findProvider = (key) =>
  STORE_PROVIDERS.find((provider) => provider.key === String(key).toLowerCase());

module.exports = {
  STORE_PROVIDERS,
  PROVIDER_KEYS,
  findProvider,
};

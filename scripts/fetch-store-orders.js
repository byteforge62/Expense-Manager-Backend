#!/usr/bin/env node
/**
 * Fetches a store's order history from the store itself and imports it into
 * FinTrack, so orders no longer have to be copied into the import box by hand.
 *
 * No marketplace offers a consumer order API to third parties, so the only
 * honest automatic read is the account holder's own signed-in session. This
 * script launches a dedicated Chrome profile, lets the user sign in once (the
 * profile is reused afterwards), reads the order cards the page renders, and
 * posts them to `POST /api/store-connections/:id/import`. Session cookies stay
 * inside that local profile: nothing about the store login reaches FinTrack.
 *
 * Usage
 *   node scripts/fetch-store-orders.js --store amazon --email you@mail.com
 *   node scripts/fetch-store-orders.js --store flipkart --email you@mail.com --account you@mail.com
 *   node scripts/fetch-store-orders.js --store amazon --dry-run
 *
 * Common flags
 *   --store <key>      Store key from the catalog (amazon, flipkart, ...)  [required]
 *   --url <address>    Page to read instead of the catalog's orders URL
 *   --account <label>  Account label to link if the store is not linked yet
 *   --email <address>  FinTrack sign-in email      (or FINTRACK_EMAIL)
 *   --password <text>  FinTrack password           (or FINTRACK_PASSWORD)
 *   --token <jwt>      Reuse an existing session instead of signing in
 *   --api <origin>     FinTrack API origin         (or FINTRACK_API)
 *   --wait <seconds>   How long to wait for orders (default 300)
 *   --scroll <count>   Extra page scrolls to load more orders (default 6)
 *   --years <count>    Earlier years to sweep after the first page (default 4)
 *   --pages <count>    Pages to walk per year (default 3)
 *   --dry-run          Print what was found, import nothing
 *   --fetch-only       Read the orders and print them; skip the FinTrack import
 *   --json             Machine-readable output for the app's "Fetch orders" button
 *   --headless         Run Chrome without a window (only useful when signed in)
 *   --profile <dir>    Chrome profile directory (or FINTRACK_CHROME_PROFILE)
 *   --chrome <path>    Chrome/Edge executable (or CHROME_PATH)
 *   --port <number>    Local DevTools port (default 9333)
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const catalog = require("../src/modules/store-connections/store-catalog");

const DEFAULT_API = process.env.FINTRACK_API || "http://127.0.0.1:3001";
const DEFAULT_PROFILE = path.join(__dirname, "..", ".store-sync", "chrome-profile");
const POLL_MS = 2000;
const IMPORT_BATCH = 200;

/**
 * Order-id formats worth trying before falling back to the "Order #" label the
 * order card itself prints. Adding a store with a known format is one line.
 */
const ORDER_ID_PATTERNS = {
  amazon: ["\\b\\d{3}-\\d{7}-\\d{7}\\b"],
  flipkart: ["\\bOD\\d{10,}\\b"],
};

/**
 * Stores whose order history is paged with a `timeFilter=year-YYYY` parameter.
 * Their default view covers only a few recent months, so the script sweeps the
 * earlier years to reach the rest of the history.
 */
const YEAR_FILTER_STORES = new Set(["amazon"]);

const withYearFilter = (address, year, pageIndex) => {
  const url = new URL(address);

  url.searchParams.set("timeFilter", `year-${year}`);

  if (pageIndex > 0) url.searchParams.set("page", String(pageIndex));
  else url.searchParams.delete("page");

  return url.toString();
};

const VALUE_FLAGS = new Set([
  "store",
  "url",
  "account",
  "email",
  "password",
  "token",
  "api",
  "wait",
  "scroll",
  "years",
  "pages",
  "profile",
  "chrome",
  "port",
]);
const BOOLEAN_FLAGS = new Set(["dry-run", "headless", "help", "fetch-only", "json"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * In `--json` mode stdout carries one JSON document and nothing else, so the
 * progress prose is redirected to stderr.
 */
let jsonMode = false;

const log = (message) =>
  jsonMode ? process.stderr.write(message) : process.stdout.write(message);

const parseArgs = (argv) => {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) continue;

    const key = token.slice(2);

    if (BOOLEAN_FLAGS.has(key)) {
      args[key] = true;
      continue;
    }

    const value = argv[index + 1];

    if (VALUE_FLAGS.has(key) && value !== undefined && !value.startsWith("--")) {
      args[key] = value;
      index += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
};

const printUsage = () => {
  const keys = catalog.STORE_PROVIDERS.map((store) => store.key).join(", ");
  process.stdout.write(
    [
      "Fetch a store's orders into FinTrack using your own signed-in browser.",
      "",
      "  node scripts/fetch-store-orders.js --store amazon --email you@mail.com",
      "",
      `Stores: ${keys}`,
      "",
      "Flags: --url --account --password --token --api --wait --scroll --years",
      "       --pages --dry-run --headless --profile --chrome --port",
      "       --fetch-only --json",
      "",
      "A Chrome window opens at the store's order page. Sign in there if asked;",
      "the script reads the orders once they are on screen and then imports them.",
      "The profile is reused, so the next run needs no sign-in.",
      "",
    ].join("\n"),
  );
};

const apiCall = async (apiOrigin, endpoint, options = {}) => {
  const { method = "GET", token, body } = options;
  const headers = { Accept: "application/json" };

  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;

  try {
    response = await fetch(new URL(endpoint, apiOrigin), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      `Cannot reach the FinTrack API at ${apiOrigin} (${error.message}). Is the backend running?`,
      { cause: error },
    );
  }

  const text = await response.text();
  const payload = (() => {
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();

  if (!response.ok || payload?.success === false) {
    const detail =
      payload?.errors?.[0]?.message ||
      payload?.message ||
      `${response.status} ${response.statusText}`;

    throw new Error(`API ${method} ${endpoint} failed: ${detail}`);
  }

  return payload?.data ?? payload;
};

const signIn = async (apiOrigin, email, password) => {
  const data = await apiCall(apiOrigin, "/api/user/login", {
    method: "POST",
    body: { email, password },
  });

  if (!data?.token) {
    throw new Error("Sign-in did not return a session token.");
  }

  return data.token;
};

const resolveConnection = async (apiOrigin, token, store, accountLabel) => {
  const data = await apiCall(apiOrigin, "/api/store-connections", { token });
  const existing = (data?.connections || []).find(
    (connection) => connection.provider === store.key,
  );

  if (existing) return existing;

  if (!accountLabel) {
    throw new Error(
      `${store.name} is not linked to this account yet. Pass --account <email or phone used at ${store.name}> to link it.`,
    );
  }

  const created = await apiCall(apiOrigin, "/api/store-connections", {
    method: "POST",
    token,
    body: { provider: store.key, accountLabel },
  });

  process.stdout.write(`Linked ${store.name} as "${accountLabel}".\n`);

  return created;
};

/**
 * Runs inside the store page. Finds order cards from the id each card prints
 * (or carries as an attribute), then reads the product name, price, quantity
 * and date out of that card. Deliberately heuristic: stores restyle their order
 * pages often, and a wrong selector should degrade to "nothing found" rather
 * than import a malformed purchase.
 */
const extractOrdersInPage = (config) => {
  const { document } = globalThis;
  const body = document.body;

  if (!body) return [];

  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const pricePattern = /(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
  const datePattern =
    /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4})|(\d{1,2}[/-]\d{1,2}[/-]\d{4})|(\d{4}-\d{2}-\d{2})/i;
  const quantityPattern = /(?:qty|quantity)\s*[:.]?\s*(\d{1,3})/i;
  const statusPattern =
    /^(order(ed| placed)?|delivered|shipped|cancelled|canceled|returned|replaced|arriving|out for delivery|in transit|payment|paid|view|track|details|invoice|buy again|buy it again|need help|write a review|write a product review|refund|completed|pending|view order details|order details|archive order|track package|get product support|leave seller feedback|return or replace items|share gift receipt|view or edit your browsing history)$/i;
  const priceOnly =
    /^(?:₹|rs\.?|inr)?\s*[0-9][0-9,.]*\s*$|^(?:₹|rs\.?|inr)\s*[0-9][0-9,.]*/i;

  const idPatterns = (config.orderIdPatterns || []).map(
    (pattern) => new RegExp(pattern, "i"),
  );
  const labelledId =
    /(?:order|invoice|transaction)\s*(?:id|no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,30})/i;

  const findOrderId = (text) => {
    for (const pattern of idPatterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }

    const labelled = text.match(labelledId);
    return labelled ? labelled[1] : null;
  };

  const parsePrice = (text) => {
    const match = text.match(pricePattern);
    if (!match) return 0;

    const amount = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(amount) ? amount : 0;
  };

  const parseDate = (text) => {
    // Order cards also print unrelated dates (delivery windows, a "since"
    // label, even a 01/01/1970 placeholder). The order's own label is the one
    // worth reading, so the search starts there.
    const labelled = text.match(
      /(?:order(?:ed)?\s+placed|ordered\s+on|order\s+date|placed\s+on)\b/i,
    );
    const scope = labelled ? text.slice(labelled.index) : text;
    const match = scope.match(datePattern) || text.match(datePattern);

    if (!match) return undefined;

    const raw = match[0].replace(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/, "$3-$2-$1");
    const date = new Date(raw.replace(/,/g, "").replace(/\./g, ""));

    if (Number.isNaN(date.getTime())) return undefined;

    // A purchase cannot predate online shopping, and cannot be in the future:
    // either value means the card printed something that is not the order date.
    if (
      date.getUTCFullYear() < 2000 ||
      date.getTime() > Date.now() + 24 * 60 * 60 * 1000
    ) {
      return undefined;
    }

    return date.toISOString();
  };

  // Containers a rendered order card actually uses. Amazon prints
  // `.order-card.js-order-card`, Flipkart and the rest use their own hooks, so
  // the list stays additive and the text-walk below still covers unknown ones.
  const CARD_SELECTORS = [
    ".order-card",
    ".js-order-card",
    "[data-component='orderCard']",
    "[data-component='order-card']",
    "[data-order-id]",
    "[data-orderid]",
    "[data-ordernumber]",
    "[data-order]",
  ];
  const TITLE_SELECTORS = [
    ".yohtmlc-product-title",
    "[data-component='itemTitle']",
    ".product-title",
    ".item-title",
    ".a-link-normal.a-text-normal",
  ];
  const ID_SELECTORS = [
    ".yohtmlc-order-id",
    ".order-id",
    ".orderId",
    "[data-order-id]",
  ];
  // The order header prints the whole-order total ("TOTAL ₹444.00"). Reading
  // that is more accurate than the first price on the card, but it must not be
  // multiplied by a quantity afterwards.
  const totalPattern =
    /\b(?:order\s+total|grand\s+total|total|amount\s+paid)\b\s*:?\s*(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;

  const orderIdFor = (card) => {
    const attribute =
      card.getAttribute?.("data-order-id") ||
      card.getAttribute?.("data-orderid") ||
      card.getAttribute?.("data-ordernumber");

    if (attribute) {
      const fromAttribute = findOrderId(attribute) || clean(attribute);
      if (fromAttribute) return fromAttribute;
    }

    const slot = card.getAttribute?.("data-csa-c-slot-id") || "";
    const fromSlot = slot.match(/order-card\.([A-Z0-9-]{6,})$/i);
    if (fromSlot) return fromSlot[1];

    for (const selector of ID_SELECTORS) {
      for (const element of card.querySelectorAll(selector)) {
        const labelled = findOrderId(clean(element.textContent));
        if (labelled) return labelled;
      }
    }

    return findOrderId(clean(card.textContent));
  };

  const titleFor = (card) => {
    for (const selector of TITLE_SELECTORS) {
      for (const element of card.querySelectorAll(selector)) {
        const text = clean(element.textContent);

        if (text.length < 3) continue;
        if (datePattern.test(text) && clean(text.replace(datePattern, "")).length < 3) {
          continue;
        }

        return text;
      }
    }

    return "";
  };

  /** Climbs from the id's element to the card that also shows a price. */
  const cardFor = (element) => {
    let card = element;

    for (let depth = 0; depth < 8; depth += 1) {
      const parent = card.parentElement;

      if (!parent || parent === body) break;

      const parentText = clean(parent.textContent);

      if (parentText.length > 2400) break;

      card = parent;

      if (pricePattern.test(parentText) && parentText.length > 30) break;
    }

    return card;
  };

  const nameFor = (card, orderId) => {
    const candidates = [];

    for (const element of card.querySelectorAll("*")) {
      if (element.children.length > 0) continue;

      const text = clean(element.textContent);

      if (!text || text.length < 3 || text.length > 180) continue;
      if (orderId && text.includes(orderId)) continue;
      if (priceOnly.test(text) || statusPattern.test(text)) continue;
      // A delivery estimate is not a product name: skip text that is only a date.
      if (
        datePattern.test(text) &&
        clean(text.replace(datePattern, "")).length < 3
      ) {
        continue;
      }
      if (pricePattern.test(text) && text.length < 24) continue;
      if (!/[a-z]{3}/i.test(text)) continue;
      if (/^(qty|quantity|size|colour|color)\b/i.test(text)) continue;

      candidates.push(text);
    }

    candidates.sort((left, right) => right.length - left.length);

    return candidates[0] || "";
  };

  const orders = new Map();
  const cards = [];

  const hasCard = (card) =>
    cards.some((known) => known === card || known.contains(card));

  const readCard = (card) => {
    const text = clean(card.textContent);

    if (!text || text.length < 12) return;

    const orderId = orderIdFor(card);

    if (!orderId || orders.has(orderId)) return;

    const totalMatch = text.match(totalPattern);
    const totalPrice = totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : 0;
    const unitPrice = totalPrice > 0 ? totalPrice : parsePrice(text);

    if (!(unitPrice > 0)) return;

    const quantityMatch = text.match(quantityPattern);
    const name = titleFor(card) || nameFor(card, orderId);

    if (name.length < 3) return;

    orders.set(orderId, {
      orderId,
      name: name.slice(0, 160),
      unitPrice,
      quantity:
        totalPrice > 0
          ? 1
          : quantityMatch
            ? Math.max(Number(quantityMatch[1]) || 1, 1)
            : 1,
      purchaseDate: parseDate(text),
    });
  };

  for (const selector of CARD_SELECTORS) {
    for (const element of body.querySelectorAll(selector)) {
      if (hasCard(element)) continue;

      cards.push(element);
    }
  }

  // Fallback for a store whose card has no known class: the text that prints
  // the order id is climbed to a container that also shows a price.
  const walker = document.createTreeWalker(
    body,
    globalThis.NodeFilter.SHOW_TEXT,
  );
  let node = walker.nextNode();

  while (node) {
    const value = clean(node.nodeValue);

    if (value && value.length < 80 && node.parentElement) {
      if (findOrderId(value)) {
        const card = cardFor(node.parentElement);

        if (!hasCard(card)) cards.push(card);
      }
    }

    node = walker.nextNode();
  }

  cards.forEach(readCard);

  return Array.from(orders.values());
};

class CdpClient {
  static async connect(url) {
    if (typeof WebSocket === "undefined") {
      throw new Error(
        `This Node version has no WebSocket client (found ${process.version}). Node 22 or newer is required.`,
      );
    }

    const socket = new WebSocket(url);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out opening the DevTools socket.")),
        10000,
      );

      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Could not open the DevTools socket."));
        },
        { once: true },
      );
    });

    return new CdpClient(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();

    socket.addEventListener("message", (event) => {
      let message;

      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      const entry = this.pending.get(message.id);

      if (!entry) return;

      this.pending.delete(message.id);

      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      /* already closed */
    }
  }
}

const evaluateInPage = async (client, expression) => {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });

  if (result?.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        "The page evaluation failed.",
    );
  }

  return result?.result?.value;
};

const locateChrome = () => {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
};

const launchChrome = ({ chromePath, port, url, headless, profileDir }) => {
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    headless ? "--headless=new" : "--start-maximized",
    url,
  ];

  const child = spawn(chromePath, args, { stdio: "ignore" });

  child.on("error", (error) => {
    process.stderr.write(`Could not start Chrome: ${error.message}\n`);
  });

  return child;
};

const waitForDevTools = async (port, timeoutMs = 30000) => {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint);

      if (response.ok) return response.json();
    } catch {
      /* Chrome is still starting */
    }

    await sleep(400);
  }

  throw new Error(
    `Chrome never opened its DevTools port ${port}. Close other debugging sessions and try again.`,
  );
};

/**
 * Chrome briefly exposes an `about:blank` tab before the requested page
 * navigates, so the store's own tab is waited for instead of grabbing the first
 * one. A redirect (for example to a sign-in host) still falls back to whatever
 * page Chrome ended up on.
 */
const findPageTarget = async (port, wantedUrl, timeoutMs = 20000) => {
  const wantedHost = (() => {
    try {
      return new URL(wantedUrl).host;
    } catch {
      return "";
    }
  })();

  const deadline = Date.now() + timeoutMs;
  let fallback = null;

  while (Date.now() < deadline) {
    let pages;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();

      pages = targets.filter((target) => target.type === "page");
    } catch {
      pages = [];
    }

    const matching = pages.find(
      (page) => wantedHost && page.url.includes(wantedHost),
    );

    if (matching) return matching;

    fallback = pages.find((page) => page.url.startsWith("http")) || fallback;

    if (pages.length > 0 && !wantedHost) return fallback || pages[0];

    await sleep(300);
  }

  if (fallback) return fallback;

  throw new Error("Chrome opened no page to read.");
};

const readOrders = async (client, config) => {
  const expression = `(${extractOrdersInPage.toString()})(${JSON.stringify(config)})`;

  return evaluateInPage(client, expression);
};

const chunk = (items, size) => {
  const batches = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
};

const importOrders = async (apiOrigin, token, connectionId, orders) => {
  let imported = 0;
  let duplicates = 0;

  for (const batch of chunk(orders, IMPORT_BATCH)) {
    const result = await apiCall(
      apiOrigin,
      `/api/store-connections/${connectionId}/import`,
      { method: "POST", token, body: { orders: batch } },
    );

    imported += result?.imported ?? 0;
    duplicates += result?.duplicates ?? 0;
  }

  return { imported, duplicates };
};

const closeChrome = async (version, client) => {
  try {
    const browser = await CdpClient.connect(version.webSocketDebuggerUrl);
    await browser.send("Browser.close");
    browser.close();
  } catch {
    /* the window is already gone */
  }

  client?.close();
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  jsonMode = Boolean(args.json);

  if (args.help) {
    printUsage();
    return;
  }

  const storeKey = typeof args.store === "string" ? args.store.toLowerCase() : "";

  if (!storeKey) {
    printUsage();
    throw new Error("Pass --store <key>.");
  }

  const store = catalog.findProvider(storeKey);

  if (!store) {
    throw new Error(
      `Unknown store "${storeKey}". Known stores: ${catalog.PROVIDER_KEYS.join(", ")}.`,
    );
  }

  const apiOrigin = String(args.api || DEFAULT_API).replace(/\/+$/, "");
  const email = args.email || process.env.FINTRACK_EMAIL;
  const password = args.password || process.env.FINTRACK_PASSWORD;
  const targetUrl = args.url || store.ordersUrl;
  const waitSeconds = Number(args.wait || 300);
  const scrolls = Number(args.scroll ?? 6);
  const yearCount = Number(args.years ?? 4);
  const maxPages = Math.max(Number(args.pages || 3), 1);
  const port = Number(args.port || 9333);
  // Chrome wants an absolute --user-data-dir; a relative one silently fails to
  // open the DevTools port on Windows.
  const profileDir = path.resolve(
    args.profile || process.env.FINTRACK_CHROME_PROFILE || DEFAULT_PROFILE,
  );
  const chromePath = args.chrome || locateChrome();

  if (!chromePath) {
    throw new Error(
      "No Chrome or Edge executable found. Install Chrome or pass --chrome <path>.",
    );
  }

  let token = args.token || "";
  // The app's Fetch button runs this script without FinTrack credentials: it
  // only needs the store page, and the API imports what it returns.
  const fetchOnly = Boolean(args["fetch-only"]) || jsonMode;
  let connection = null;

  if (!fetchOnly) {
    if (!token) {
      if (!email || !password) {
        throw new Error(
          "Pass --email and --password (or set FINTRACK_EMAIL / FINTRACK_PASSWORD), or reuse a session with --token.",
        );
      }

      log(`Signing in to FinTrack as ${email}…\n`);
      token = await signIn(apiOrigin, email, password);
    }

    connection = await resolveConnection(
      apiOrigin,
      token,
      store,
      typeof args.account === "string" ? args.account : email,
    );
  }

  log(
    `Opening ${store.name} orders in Chrome (${profileDir}).\n` +
      (args.headless
        ? ""
        : "Sign in there if the page asks; the script continues automatically.\n"),
  );

  const child = launchChrome({
    chromePath,
    port,
    url: targetUrl,
    headless: Boolean(args.headless),
    profileDir,
  });

  let client;

  try {
    await waitForDevTools(port);

    const page = await findPageTarget(port, targetUrl);

    client = await CdpClient.connect(page.webSocketDebuggerUrl);
    await client.send("Runtime.enable");

    const config = {
      store: store.key,
      orderIdPatterns: ORDER_ID_PATTERNS[store.key] || [],
    };

    /**
     * Reads the order cards the current page shows, scrolling while the page
     * lazily renders more. Resolves to [] when nothing appears in time.
     */
    const collect = async (waitMs, scrollLimit) => {
      const deadline = Date.now() + waitMs;
      let found = [];
      let scrollCount = 0;
      let lastStatus = 0;

      while (Date.now() < deadline) {
        try {
          found = (await readOrders(client, config)) || [];
        } catch {
          found = [];
        }

        if (found.length > 0) return found;

        if (scrollCount < scrollLimit) {
          scrollCount += 1;

          try {
            await evaluateInPage(
              client,
              "window.scrollTo(0, document.body.scrollHeight); document.body.scrollHeight",
            );
          } catch {
            /* page still loading */
          }
        }

        if (Date.now() - lastStatus > 15000) {
          lastStatus = Date.now();

          let where = targetUrl;

          try {
            where = await evaluateInPage(client, "location.href");
          } catch {
            /* keep the requested URL */
          }

          log(`Waiting for order cards on ${where}…\n`);
        }

        await sleep(POLL_MS);
      }

      return found;
    };

    const ordersById = new Map();
    const addOrders = (found) =>
      found.forEach((order) => {
        if (!ordersById.has(order.orderId)) ordersById.set(order.orderId, order);
      });

    addOrders(await collect(waitSeconds * 1000, scrolls));

    if (ordersById.size === 0) {
      throw new Error(
        `No orders were found within ${waitSeconds}s. Sign in to ${store.name} in the Chrome window, open the order history, and run the script again (the profile keeps you signed in).`,
      );
    }

    // The first page is only the store's default window (a few recent months on
    // Amazon). Walk each year filter and its pages so older orders are kept
    // too. Two years in a row with nothing ends the sweep.
    if (yearCount > 0 && YEAR_FILTER_STORES.has(store.key) && !args.url) {
      const currentYear = new Date().getFullYear();
      let emptyYears = 0;

      for (let offset = 0; offset <= yearCount && emptyYears < 2; offset += 1) {
        const year = currentYear - offset;
        let pageIndex = 0;
        let pageOrders = [];

        while (pageIndex < maxPages) {
          await client.send("Page.navigate", {
            url: withYearFilter(store.ordersUrl, year, pageIndex),
          });
          await sleep(600);

          pageOrders = await collect(20000, 2);
          addOrders(pageOrders);

          log(
            `  ${year}${pageIndex > 0 ? ` page ${pageIndex + 1}` : ""}: ${pageOrders.length} order(s)\n`,
          );

          if (pageOrders.length === 0) break;
          if (pageIndex === 0) emptyYears = 0;

          const next = await evaluateInPage(
            client,
            `(() => {
              const anchor = Array.from(document.querySelectorAll("a[href]")).find(
                (element) =>
                  /^(next|next page|next ›|›|→)$/i.test((element.textContent || "").trim()) &&
                  /page=/.test(element.href) &&
                  !/a-disabled/.test(element.className || ""),
              );
              return anchor ? anchor.href : "";
            })()`,
          );

          if (!next) break;

          pageIndex += 1;
        }

        if (pageOrders.length === 0) emptyYears += 1;
      }
    }

    const orders = Array.from(ordersById.values());
    const total = orders.reduce(
      (sum, order) => sum + order.unitPrice * (order.quantity || 1),
      0,
    );

    log(
      `\nFound ${orders.length} order(s) worth ₹${total.toLocaleString("en-IN")}.\n`,
    );

    orders.slice(0, 10).forEach((order) => {
      log(
        `  • ${order.orderId}  ${order.name.slice(0, 52)}  ₹${order.unitPrice.toLocaleString("en-IN")}${order.quantity > 1 ? ` × ${order.quantity}` : ""}\n`,
      );
    });

    if (orders.length > 10) {
      log(`  … and ${orders.length - 10} more\n`);
    }

    if (jsonMode) {
      // Only the orders reach stdout; the API turns them into purchases once
      // the user confirms them in the app.
      process.stdout.write(
        `${JSON.stringify({ store: store.key, storeName: store.name, orders })}\n`,
      );
      return;
    }

    if (fetchOnly) {
      log("\nFetch only: nothing was imported.\n");
      return;
    }

    if (args["dry-run"]) {
      log("\nDry run: nothing was imported.\n");
      return;
    }

    const result = await importOrders(apiOrigin, token, connection._id, orders);

    process.stdout.write(
      `\nImported ${result.imported} order(s)` +
        (result.duplicates ? `, skipped ${result.duplicates} already recorded` : "") +
        ".\n",
    );
  } finally {
    const version = await waitForDevTools(port, 2000).catch(() => null);

    if (version) await closeChrome(version, client);
    else {
      client?.close();

      try {
        child.kill();
      } catch {
        /* already exited */
      }
    }
  }
};

main().catch((error) => {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify({ error: error.message })}\n`);
  } else {
    process.stderr.write(`\n${error.message}\n`);
  }

  process.exitCode = 1;
});

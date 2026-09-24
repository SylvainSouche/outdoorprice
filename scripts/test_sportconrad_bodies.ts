import axios from "axios";
import { pickUserAgent } from "/home/z/my-project/src/lib/scraper/http";

const ua = pickUserAgent();
const headers = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "X-Makaira-Instance": "live",
  "User-Agent": ua,
  Origin: "https://www.sport-conrad.com",
  Referer: "https://www.sport-conrad.com/en/search",
};

// Try different endpoints
const endpoints = [
  "https://sport-conrad.makaira.io/search/public",
  "https://sport-conrad.makaira.io/search",
  "https://sport-conrad.makaira.io/api/search",
  "https://sport-conrad.makaira.io/v1/search",
];

const body = {
  searchPhrase: "Dynafit",
  isSearch: true,
  enableAggregations: true,
  aggregations: {},
  sorting: {},
  count: "24",
  offset: "0",
  apiVersion: "2019.1.1",
  constraints: {},
  customFilter: {},
};

for (const ep of endpoints) {
  try {
    const res = await axios.post(ep, body, {
      headers, timeout: 10000, validateStatus: () => true,
    });
    const preview = JSON.stringify(res.data).slice(0, 250);
    console.log(`[POST ${ep}] → ${res.status} : ${preview}`);
  } catch (e: any) {
    console.log(`[POST ${ep}] → ERROR: ${e.message}`);
  }
}

// Try GET on the public search page (HTML)
console.log("\n--- GET HTML page ---");
try {
  const res = await axios.get("https://www.sport-conrad.com/en/search?q=Dynafit", {
    headers: { "User-Agent": ua, "Accept-Language": "en-US,en;q=0.9" },
    timeout: 10000,
    validateStatus: () => true,
  });
  console.log(`GET sport-conrad.com → ${res.status}, length: ${res.data?.length ?? 0}`);
} catch (e: any) {
  console.log("GET failed:", e.message);
}

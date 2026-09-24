// Test the protocol-generator.js with the all4cycling capture scenario
// Validates that:
//   - Shopify predictive-search HTML is properly captured (not truncated at 5000)
//   - Shopify /search? HTML response has JSON-LD ItemList extraction
//   - Result count is detected from <title>
//   - False-positive GraphQL queries (cart, consent) are NOT classified as search
//   - Shopify /products/<handle> URL is classified as product

import {
  generateProtocol,
  isSearchRequest,
  isProductRequest,
  extractJsonLdFromHtml,
  findItemListProducts,
  extractFirstProductCardHtml,
  detectResultCount,
  categorize,
  CATEGORY,
} from "../extension/protocol-generator.js";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log(`✅ ${name}`); pass++; }
  else { console.log(`❌ ${name}`); fail++; }
}

// ===== Test 1: false-positive GraphQL =====
const cartQuery = {
  url: "https://www.all4cycling.com/api/2026-04/graphql.json",
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: "\n      query GetSlideCartOffers {\n        shop {\n          metafield(namespace: \"$app:candyrack\", key: \"slide_cart_offers\") {\n            value\n          }\n        }\n      }\n    ",
  }),
  category: null,
};
check("Cart query NOT classified as search", !isSearchRequest(cartQuery));

const consentQuery = {
  url: "https://www.all4cycling.com/api/unstable/graphql.json",
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: "\n        query bannerQuery ($isPreviewMode: Boolean = false) @inContext(language: FR, country: FR) {\n          consentManagement {\n            banner {\n              enabled\n              position\n              title\n              text\n            }\n          }\n        }",
    variables: { isPreviewMode: false },
  }),
  category: null,
};
check("Consent banner query NOT classified as search", !isSearchRequest(consentQuery));

// ===== Test 2: Real Shopify search GET requests ARE classified as search =====
const predictiveSearch = {
  url: "https://www.all4cycling.com/fr/search/suggest?q=ca&resources%5Blimit%5D=6&resources%5Boptions%5D%5Bfields%5D=title,product_type,variants.title,vendor,variants.sku,tag&section_id=predictive-search",
  method: "GET",
  headers: {},
  body: "",
  category: null,
};
check("Shopify predictive search URL classified as search", isSearchRequest(predictiveSearch));

const searchPage = {
  url: "https://www.all4cycling.com/fr/search?options%5Bprefix%5D=last&q=castelli+giro",
  method: "GET",
  headers: {},
  body: "",
  category: null,
};
check("Shopify search page URL classified as search", isSearchRequest(searchPage));

// ===== Test 3: Shopify /products/<handle> classified as product =====
const productPage = {
  url: "https://www.all4cycling.com/fr/products/sottocasco-castelli-summer-skull-nero",
  method: "GET",
  headers: {},
  body: "",
  category: null,
};
check("Shopify /products/<handle> URL classified as product", isProductRequest(productPage));

// ===== Test 4: HTML not truncated at 5000 chars =====
const shopifySearchHtml = `<!doctype html>
<html lang="fr">
<head>
<title>Recherche : 231 résultats trouvés pour « castelli giro »</title>
<style>body { font-family: sans-serif; }</style>
</head>
<body>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "item": {
        "@type": "Product",
        "name": "Sottocasco Castelli Summer Skull - Noir",
        "image": "//www.all4cycling.com/cdn/shop/files/img1.jpg",
        "url": "https://www.all4cycling.com/fr/products/sottocasco-castelli-summer-skull-nero",
        "sku": "CSG4-001",
        "brand": { "@type": "Brand", "name": "Castelli" },
        "offers": {
          "@type": "AggregateOffer",
          "priceCurrency": "EUR",
          "lowPrice": "21.60",
          "highPrice": "27.00",
          "offerCount": 2
        }
      }
    },
    {
      "@type": "ListItem",
      "position": 2,
      "item": {
        "@type": "Product",
        "name": "Casquette Giro d'Italia 2026 Rosa",
        "image": "//www.all4cycling.com/cdn/shop/files/img2.jpg",
        "sku": "CGI-2026-ROS",
        "brand": { "@type": "Brand", "name": "Giro" },
        "offers": { "@type": "Offer", "price": "29.95", "priceCurrency": "EUR" }
      }
    }
  ]
}
</script>
<div class="search-results">
  <a class="predictive-result" href="/fr/products/sottocasco-castelli-summer-skull-nero?_pos=1">
    <img src="//www.all4cycling.com/cdn/shop/files/img1.jpg" alt="Sottocasco Castelli Summer Skull - Noir" />
    <h3 class="predictive-result__title">Sottocasco Castelli Summer Skull - Noir</h3>
    <span class="price__current">€21,60</span>
    <span class="price__was">€27,00</span>
    <span class="price__discount">-20%</span>
    <div class="predictive-result__sub-title">Castelli</div>
  </a>
</div>
</body>
</html>`;

// 4a. detectResultCount
const counts = detectResultCount(shopifySearchHtml);
check("Result count detected from <title>", counts.length > 0);
check("Result count is 231", counts.some((c) => c.count === 231));
console.log(`   Counts found: ${JSON.stringify(counts)}`);

// 4b. JSON-LD extraction
const jsonLdBlocks = extractJsonLdFromHtml(shopifySearchHtml);
check("JSON-LD block extracted from HTML", jsonLdBlocks.length > 0);
check("JSON-LD has @type ItemList", jsonLdBlocks[0]?.parsed?.["@type"] === "ItemList");

// 4c. find ItemList products
const itemLists = findItemListProducts(jsonLdBlocks);
check("ItemList products found", itemLists.length > 0);
check("ItemList sample is a Product", itemLists[0]?.sample?.["@type"] === "Product");
check("ItemList totalCount is 2", itemLists[0]?.totalCount === 2);
console.log(`   Sample product: ${itemLists[0]?.sample?.name}`);

// 4d. extractFirstProductCardHtml
const cardHtml = extractFirstProductCardHtml(shopifySearchHtml, 5000);
check("First product card HTML extracted", cardHtml !== null);
check("Card HTML contains product title", cardHtml?.includes("Sottocasco Castelli"));
check("Card HTML contains price", cardHtml?.includes("€21,60") || cardHtml?.includes("21,60"));

// ===== Test 5: End-to-end generateProtocol on the all4cycling scenario =====
const capturedRequests = [
  // 1. predictive search
  {
    ...predictiveSearch,
    responseStatus: 200,
    responseContentType: "text/html",
    responseBody: shopifySearchHtml,
  },
  // 2. main search page (1MB of HTML)
  {
    ...searchPage,
    responseStatus: 200,
    responseContentType: "text/html",
    responseBody: shopifySearchHtml.repeat(50),  // ~50KB
  },
  // 3. cart query (false positive)
  {
    ...cartQuery,
    responseStatus: 200,
    responseContentType: "application/json",
    responseBody: JSON.stringify({ data: { shop: { metafield: { value: "..." } } } }),
  },
  // 4. consent query (false positive)
  {
    ...consentQuery,
    responseStatus: 200,
    responseContentType: "application/json",
    responseBody: JSON.stringify({ data: { consentManagement: { banner: { enabled: true } } } }),
  },
];

// Re-categorize using the new heuristics
for (const r of capturedRequests) {
  r.category = categorize(r);
}

const searchCount = capturedRequests.filter((r) => r.category === CATEGORY.SEARCH).length;
const productCount = capturedRequests.filter((r) => r.category === CATEGORY.PRODUCT).length;
const otherCount = capturedRequests.filter((r) => r.category === CATEGORY.OTHER).length;
console.log(`\nCategorization: ${searchCount} search, ${productCount} product, ${otherCount} other (expected: 2 search, 0 product, 2 other)`);
check("2 search endpoints (down from 4 — false positives filtered)", searchCount === 2);
check("2 other endpoints (the false-positive GraphQL queries)", otherCount === 2);

const md = generateProtocol({ shopName: "all4cycling", requests: capturedRequests });
// Save the generated protocol
import { writeFileSync } from "node:fs";
writeFileSync("/tmp/test-all4cycling-protocol.md", md);
console.log(`\nGenerated protocol.md: ${md.length.toLocaleString()} chars (saved to /tmp/test-all4cycling-protocol.md)`);

check("Protocol mentions 231 results", md.includes("231"));
check("Protocol mentions 'ItemList schema.org'", md.includes("ItemList schema.org"));
check("Protocol mentions 'Sample product extrait du JSON-LD'", md.includes("Sample product extrait du JSON-LD"));
check("Protocol shows first product card HTML", md.includes("Première carte produit"));
check("Protocol shows 'Sottocasco Castelli Summer Skull'", md.includes("Sottocasco Castelli Summer Skull"));
check("Protocol does NOT include cart query in endpoint list (filtered out)", !md.includes("POST https://www.all4cycling.com/api/2026-04/graphql.json"));
check("Protocol does NOT include consent query in endpoint list (filtered out)", !md.includes("POST https://www.all4cycling.com/api/unstable/graphql.json"));
check("Response truncated at 50000 chars (not 5000)", md.includes("truncated at 50000 chars") || !md.includes("truncated at 5000 chars"));

console.log(`\n${pass}/${pass + fail} checks passed.`);
process.exit(fail > 0 ? 1 : 0);

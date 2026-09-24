// Scraper Snowleader (FR, EUR)
// --------------------------------------------------------------------------
// Protocole (cf. PROTOCOLES.md) :
//   POST https://api.snowleader.com/graphql/
//   Aucune authentification. En-tête Store: <store view> pour la langue.
//   Store view Store_View_COM_FR porte la langue française.
//
// Requête (GraphQL Magento) :
//   query productList($search:String!, $currentPage:Int=1, $pageSize:Int=24){
//     products(search:$search, currentPage:$currentPage, pageSize:$pageSize){
//       total_count
//       items {
//         __typename
//         id
//         sku
//         name
//         url_key
//         small_image { url }
//         price_range { minimum_price { final_price { value currency }
//                                        regular_price { value currency } } }
//         ... on ConfigurableProduct { configurable_options {
//           attribute_code values { value_index label } } }
//         bazaarvoice_rating { rating }
//       }
//     }
//   }
//
// Champs utiles :
//   price_range.minimum_price.final_price.value   → prix payé
//   price_range.minimum_price.regular_price.value → prix catalogue
//   url_key + ".html"                              → lien produit
//   configurable_options                          → tailles
//   bazaarvoice_rating                            → note client
//
// Pièges :
//   - configurable_options n'appartient pas à ProductInterface : sans le
//     fragment ... on ConfigurableProduct, GraphQL refuse la requête ENTIÈRE
//   - Aucun EAN publié, nulle part
//   - 403 après deux recherches rapprochées (on reste sous ce seuil)
// --------------------------------------------------------------------------
import axios from "axios";
import { SiteMeta, ProductResult, Scraper } from "../types";

import { pickUserAgent, absUrl } from "../http";

interface SlMoney { value?: number; currency?: string; }
interface SlOption { value_index?: number; label?: string; }
interface SlItem {
  id?: string | number;
  sku?: string;
  name?: string;
  url_key?: string;
  url_suffix?: string;
  small_image?: { url?: string };
  thumbnail?: { url?: string };
  image?: { url?: string };
  media_gallery?: { url?: string }[];
  price_range?: {
    minimum_price?: {
      final_price?: SlMoney;
      regular_price?: SlMoney;
      discount?: { percent_off?: number };
    };
  };
  configurable_options?: {
    attribute_code?: string;
    values?: SlOption[];
  }[];
  rating_summary?: number;
  review_count?: number;
}
interface SlResponse {
  data?: {
    products?: {
      total_count?: number;
      items?: SlItem[];
    };
  };
  errors?: { message?: string }[];
}

const QUERY = `query productList($search: String!, $currentPage: Int = 1, $pageSize: Int = 24) {
  products(search: $search, currentPage: $currentPage, pageSize: $pageSize) {
    total_count
    items {
      __typename
      id
      sku
      name
      url_key
      url_suffix
      small_image { url }
      thumbnail { url }
      image { url }
      price_range {
        minimum_price {
          final_price { value currency }
          regular_price { value currency }
          discount { percent_off amount_off }
        }
      }
      ... on ConfigurableProduct {
        configurable_options {
          attribute_code
          attribute_id
          label
          values { value_index label }
        }
      }
    }
  }
}`;

export const site: SiteMeta = {
  id: "snowleader",
  name: "Snowleader",
  baseUrl: "https://www.snowleader.com",
  country: "FR",
  currency: "EUR",
  accent: "bg-cyan-100 text-cyan-800 border-cyan-200",
  groups: ["all"],
};

export const scraper: Scraper = {
  site,
    capabilities: { engine: "graphql" },
  async search(query, signal) {
    const ua = pickUserAgent();
    const res = await axios.post<SlResponse>(
      "https://api.snowleader.com/graphql/",
      {
        query: QUERY,
        variables: { search: query, currentPage: 1, pageSize: 24 },
        operationName: "productList",
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Store: "Store_View_COM_FR",
          "User-Agent": ua,
          Origin: site.baseUrl,
          Referer: `${site.baseUrl}/`,
          "Accept-Language": "fr-FR,fr;q=0.9",
        },
        timeout: 25000,
        signal,
        validateStatus: (s) => s < 500,
      }
    );
    if (res.status === 403) {
      throw new Error("Snowleader: HTTP 403 — ralentir les requêtes (limite anti-abus)");
    }
    if (res.status >= 400) {
      throw new Error(`Snowleader: HTTP ${res.status}`);
    }
    if (res.data?.errors?.length) {
      throw new Error(`Snowleader GraphQL: ${res.data.errors.map((e) => e.message).join("; ")}`);
    }

    const items = res.data?.data?.products?.items ?? [];
    const products: ProductResult[] = [];
    const seen = new Set<string>();

    items.slice(0, 24).forEach((it) => {
      const title = (it.name || "").trim();
      if (!title) return;
      const urlKey = it.url_key || "";
      const urlSuffix = it.url_suffix || ".html";
      const href = urlKey
        ? absUrl(`/${urlKey}${urlSuffix}`, site.baseUrl)
        : null;
      if (!href || seen.has(href)) return;
      seen.add(href);

      const mp = it.price_range?.minimum_price;
      const price = mp?.final_price?.value ?? null;
      const originalPrice = mp?.regular_price?.value ?? null;
      const realOriginal =
        originalPrice && price && originalPrice > price ? originalPrice : null;
      const discountPct = mp?.discount?.percent_off
        ? Math.round(mp.discount.percent_off)
        : realOriginal && price
        ? Math.round((1 - price / realOriginal) * 100)
        : null;

      const imgRaw =
        it.image?.url ||
        it.media_gallery?.[0]?.url ||
        it.thumbnail?.url ||
        it.small_image?.url ||
        "";

      products.push({
        site: "snowleader",
        siteName: site.name,
        title,
        url: href,
        price: price != null ? price : null,
        originalPrice: realOriginal ?? null,
        currency: mp?.final_price?.currency || "EUR",
        image: absUrl(imgRaw, site.baseUrl),
        availability: "unknown",
        discount: discountPct,
      });
    });

    return products;
  },
};

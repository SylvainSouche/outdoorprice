import * as cheerio from "cheerio";
import { readFileSync } from "fs";

const html = readFileSync("upload/deport_answer", "utf-8");
const $ = cheerio.load(html);

const cards = $(`[data-testid="product-card"]`);
console.log("Cards found:", cards.length);

cards.slice(0, 3).each((i, el) => {
  const $el = $(el);
  const $link = $el.find("a").first();
  const title = $link.attr("title") || $el.find("a").first().text().trim();
  const href = $link.attr("href");
  const $price = $el.find('[data-testid="product-generic-price"]').first();
  const priceText = $price.find("span").first().text().trim();
  const originalText = $price.find("del").first().text().trim();
  const img = $el.find("img").first().attr("src");
  console.log(`  ${i+1}. ${title?.slice(0,60)}`);
  console.log(`     price: ${priceText} (was ${originalText})`);
  console.log(`     img: ${img?.slice(0,80)}`);
  console.log(`     url: ${href?.slice(0,80)}`);
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractInitialState } from "@/lib/scraper/sites/bergzeit";

const fixturePath = resolve(__dirname, "fixtures/bergzeit/search.html");
const html = readFileSync(fixturePath, "utf8");

describe("bergzeit.extractInitialState", () => {
  const state = extractInitialState(html);
  const elements = state?.modules?.productsListPage?.elementsList ?? [];

  it("finds the inline window.__initialAppState assignment", () => {
    expect(state).not.toBeNull();
    expect(elements.length).toBe(3);
  });

  it("extracts title from .data.name", () => {
    expect(elements[0].data?.name).toBe("Speed Radical");
  });

  it("extracts brand from .data.brand.name", () => {
    expect(elements[0].data?.brand?.name).toBe("Dynafit");
  });

  it("extracts price.current (French format)", () => {
    expect(elements[0].data?.price?.current).toBe("450,00 €");
    expect(elements[1].data?.price?.current).toBe("320,00 €");
  });

  it("extracts price.old (the actual old price, not 'previous' which is manufacturer price)", () => {
    expect(elements[1].data?.price?.old).toBe("400,00 €");
  });

  it("returns null for HTML without the inline state", () => {
    expect(extractInitialState("<html><body>no state here</body></html>")).toBeNull();
  });
});

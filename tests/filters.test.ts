import { describe, it, expect } from "vitest";
import { normalizeSizeValue } from "@/lib/scraper/filters";

describe("normalizeSizeValue", () => {
  it("harmonise les formats de tailles", () => {
    expect(normalizeSizeValue("42")).toBe("eu:42");
    expect(normalizeSizeValue("EU 42")).toBe("eu:42");
    expect(normalizeSizeValue("42 EU")).toBe("eu:42");
    expect(normalizeSizeValue("42,5")).toBe("eu:42.5");
    expect(normalizeSizeValue("US 10.5")).toBe("us:10.5");
    expect(normalizeSizeValue("UK 8")).toBe("uk:8");
    expect(normalizeSizeValue("M")).toBe("m");
  });
});

#!/usr/bin/env python3
"""
Convert top-level `import { ... } from "../http"` in each scraper file to a
dynamic import inside the `search()` function body. This makes scraper modules
safe to import on the client side (they no longer pull in Node-only deps like
axios / proxy agents at module evaluation time).

Before:
    import { fetchHtml, parsePrice, absUrl, cleanTitle } from "../http";
    export const scraper: Scraper = {
      site,
      async search(query, signal) {
        const url = `${site.baseUrl}/search?q=...`;
        const { html } = await fetchHtml(url, ...);
        const price = parsePrice(priceText);
        ...
      },
    };

After:
    // (no top-level import from ../http)
    export const scraper: Scraper = {
      site,
      async search(query, signal) {
        const { fetchHtml, parsePrice, absUrl, cleanTitle } = await import("../http");
        const url = `${site.baseUrl}/search?q=...`;
        const { html } = await fetchHtml(url, ...);
        const price = parsePrice(priceText);
        ...
      },
    };
"""
import re
from pathlib import Path

SITES_DIR = Path("/home/z/my-project/src/lib/scraper/sites")

def transform_file(path):
    content = path.read_text()
    original = content

    # 1. Find and remove the top-level import from "../http"
    # Capture the imported names so we can re-declare them inside search()
    m = re.search(r'^import\s*\{([^}]+)\}\s*from\s*"\.\./http";\s*$', content, re.MULTILINE)
    if not m:
        return False  # no http import — skip
    http_imports = m.group(1).strip()
    # Remove the import line
    content = content[:m.start()] + content[m.end():]

    # 2. Find the `async search(...)` function and inject the dynamic import
    # at the very start of its body.
    # Pattern: `async search(<args>) {`  →  `async search(<args>) {\n    const { ... } = await import("../http");`
    # We need to handle both `async search(query, signal) {` and `async search(query: string, signal: AbortSignal) {`
    search_pattern = r'(async\s+search\s*\([^)]*\)\s*\{)'
    m2 = re.search(search_pattern, content)
    if not m2:
        # Restore the import — we can't find search()
        content = original
        return False

    inject = f'{m2.group(1)}\n    const { {http_imports} } = await import("../http");'.replace(
        "{http_imports}", http_imports
    )
    content = content[:m2.start()] + inject + content[m2.end():]

    if content != original:
        path.write_text(content)
        return True
    return False


def main():
    changed = 0
    for path in sorted(SITES_DIR.glob("*.ts")):
        if path.name == "index.ts":
            continue
        if transform_file(path):
            print(f"  ✅ {path.name}")
            changed += 1
        else:
            print(f"  ⚠️  {path.name}: no changes (no http import or no search fn)")
    print(f"\nTransformed {changed} files")


if __name__ == "__main__":
    main()

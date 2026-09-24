#!/usr/bin/env python3
"""
Migration script v2: convert scraper files from old shape to new self-contained shape.
Fixed bug: previous version had an aggressive `\bSITES,?\s*` regex that matched
SITES inside `SITES.all4cycling.baseUrl` and removed just `SITES`, leaving
`.all4cycling.baseUrl`. This version only touches SITES inside import statements.
"""
import re
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project/src/lib/scraper")
TYPES_PATH = ROOT / "types.ts"
SITES_DIR = ROOT / "sites"
GROUPS_PATH = ROOT / "groups.ts"


def extract_sites_from_types():
    """Returns ({ shopId: {...} }, sites_block_text)"""
    content = TYPES_PATH.read_text()
    m = re.search(r"export const SITES[^{]*\{(.+?)\n\};", content, re.DOTALL)
    if not m:
        print("ERROR: could not find SITES record in types.ts", file=sys.stderr)
        sys.exit(1)
    sites_block = m.group(0)
    inner = m.group(1)
    entries = {}
    for em in re.finditer(r"(\w+):\s*\{([^}]+)\}", inner):
        shop_id = em.group(1)
        body = em.group(2)
        def get(field):
            mm = re.search(rf'{field}:\s*"([^"]+)"', body)
            return mm.group(1) if mm else ""
        entries[shop_id] = {
            "id": get("id") or shop_id,
            "name": get("name"),
            "baseUrl": get("baseUrl"),
            "country": get("country"),
            "currency": get("currency"),
            "accent": get("accent"),
        }
    return entries, sites_block


def extract_group_memberships():
    """Returns { shopId: [group1, group2, ...] }"""
    content = GROUPS_PATH.read_text()
    memberships = {}
    m = re.search(r"DEFAULT_GROUPS[^=]*=\s*\[(.+?)\];", content, re.DOTALL)
    if not m:
        return memberships
    groups_block = m.group(1)
    for gm in re.finditer(r'id:\s*"(\w+)".*?sites:\s*\[([^\]]+)\]', groups_block, re.DOTALL):
        group_id = gm.group(1)
        sites_str = gm.group(2)
        for sm in re.finditer(r'"(\w+)"', sites_str):
            site_id = sm.group(1)
            if site_id == "all":
                continue  # "all" is implicit, don't tag sites with it
            memberships.setdefault(site_id, []).append(group_id)
    return memberships


def transform_scraper_file(shop_id, metadata, groups):
    """Transform a single scraper file from old shape to new shape."""
    path = SITES_DIR / f"{shop_id}.ts"
    if not path.exists():
        print(f"  ⚠️  {shop_id}.ts not found, skipping")
        return False
    content = path.read_text()
    original = content

    # === Step 1: Fix the import statement ===
    # Find: import { ... SITES ... } from "../types";
    # Replace SITES with SiteMeta (or add SiteMeta if SITES wasn't there)
    def fix_import(m):
        block = m.group(0)
        # Remove `SITES` (with optional trailing comma + whitespace)
        # Only inside this import block — safe because we're scoped to the import.
        block = re.sub(r'\bSITES\s*,?\s*', '', block)
        # Clean up: `{ ,` → `{ `, `,,` → `,`, double spaces
        block = re.sub(r'\{\s*,', '{ ', block)
        block = re.sub(r',\s*,', ',', block)
        block = re.sub(r'\s+', ' ', block)
        # Add SiteMeta if not already there
        if 'SiteMeta' not in block:
            block = re.sub(r'import\s*\{\s*', 'import { SiteMeta, ', block)
        return block

    content = re.sub(
        r'import\s*\{[^}]*\}\s*from\s*"\.\./types";',
        fix_import,
        content,
        count=1  # only the first import from "../types"
    )

    # === Step 2: Replace `SITES.<shopId>` with `site` everywhere ===
    # This is safe — \b ensures we match the whole `SITES.X` token.
    content = re.sub(rf'\bSITES\.{shop_id}\b', 'site', content)

    # === Step 3: Simplify `site: site,` → `site,` ===
    content = re.sub(r'site:\s*site\s*,', 'site,', content)

    # === Step 4: Build the `export const site: SiteMeta = {...}` block ===
    groups_str = ', '.join(f'"{g}"' for g in groups) if groups else ''
    groups_line = f'  groups: [{groups_str}],' if groups else '  groups: [],'
    site_export = (
        f'export const site: SiteMeta = {{\n'
        f'  id: "{metadata["id"]}",\n'
        f'  name: "{metadata["name"]}",\n'
        f'  baseUrl: "{metadata["baseUrl"]}",\n'
        f'  country: "{metadata["country"]}",\n'
        f'  currency: "{metadata["currency"]}",\n'
        f'  accent: "{metadata["accent"]}",\n'
        f'{groups_line}\n'
        f'}};\n\n'
    )

    # === Step 5: Inject site export + rename `XScraper` → `scraper` ===
    # Match: export const <name>Scraper: Scraper = {
    export_pattern = rf'export const (\w+Scraper): Scraper = \{{'
    m = re.search(export_pattern, content)
    if m:
        scraper_name = m.group(1)
        # Inject site export BEFORE the scraper export
        content = content[:m.start()] + site_export + content[m.start():]
        # Rename XScraper → scraper
        content = content.replace(f"export const {scraper_name}: Scraper", "export const scraper: Scraper", 1)
    else:
        if "export const scraper:" not in content:
            print(f"  ⚠️  {shop_id}.ts: could not find `export const XScraper: Scraper = {{`")
            return False

    if content != original:
        path.write_text(content)
        print(f"  ✅ {shop_id}.ts transformed")
        return True
    else:
        print(f"  ⚠️  {shop_id}.ts: no changes made")
        return False


def remove_sites_record_from_types(sites_block):
    content = TYPES_PATH.read_text()
    new_content = content.replace(
        sites_block,
        "// SITES record has been moved to sites/index.ts (auto-built from discovered scrapers).\n"
        "// Each sites/<shop>.ts file now exports its own `site` metadata + `scraper` object."
    )
    TYPES_PATH.write_text(new_content)
    print(f"  ✅ types.ts: removed SITES record ({len(sites_block)} chars)")


def main():
    print("=== Step 1: Extract SITES metadata from types.ts ===")
    sites_metadata, sites_block = extract_sites_from_types()
    print(f"  Found {len(sites_metadata)} site entries")

    print("\n=== Step 2: Extract group memberships from groups.ts ===")
    memberships = extract_group_memberships()
    for sid, groups in sorted(memberships.items()):
        print(f"  {sid}: {groups}")

    print("\n=== Step 3: Transform each scraper file ===")
    changed = 0
    for shop_id in sorted(sites_metadata.keys()):
        groups = memberships.get(shop_id, [])
        if transform_scraper_file(shop_id, sites_metadata[shop_id], groups):
            changed += 1
    print(f"\n  Transformed {changed}/{len(sites_metadata)} files")

    print("\n=== Step 4: Remove SITES record from types.ts ===")
    remove_sites_record_from_types(sites_block)

    print("\n✅ Migration complete.")


if __name__ == "__main__":
    main()

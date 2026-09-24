#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION_FILE="VERSION"
if [ ! -f "$VERSION_FILE" ]; then echo "1.0.0" > "$VERSION_FILE"; fi

VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
MAJOR=$(echo "$VERSION" | cut -d. -f1)
MINOR=$(echo "$VERSION" | cut -d. -f2)
RELEASE=$(echo "$VERSION" | cut -d. -f3)

case "${1:-patch}" in
  --major) MAJOR=$((MAJOR + 1)); MINOR=0; RELEASE=0 ;;
  --minor) MINOR=$((MINOR + 1)); RELEASE=0 ;;
  --patch|*) RELEASE=$((RELEASE + 1)) ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${RELEASE}"
echo "$NEW_VERSION" > "$VERSION_FILE"
echo "Version: $VERSION -> $NEW_VERSION"

echo "export const VERSION = \"${NEW_VERSION}\";" > src/lib/version.ts
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${NEW_VERSION}\"/" package.json
if [ -f "extension/manifest.json" ]; then
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${NEW_VERSION}\"/" extension/manifest.json
fi

TARBALL="download/outdoorprice-${NEW_VERSION}.tar.gz"
echo "Building $TARBALL ..."
mkdir -p download/old
for old_file in download/outdoorprice-*.tar.gz download/shop-protocol-extension-*.zip; do
  [ -f "$old_file" ] || continue
  if [[ "$old_file" != *"$NEW_VERSION"* ]]; then
    mv "$old_file" download/old/ 2>/dev/null || true
  fi
done

tar czf "$TARBALL" \
  --exclude='node_modules' --exclude='.next' --exclude='.git' --exclude='dev.log' \
  --exclude='server.log' --exclude='*.tar.gz' --exclude='tsconfig.tsbuildinfo' \
  --exclude='skills' --exclude='download' --exclude='upload' --exclude='worklog.md' \
  --exclude='examples' --exclude='mini-services' --exclude='db' --exclude='prisma' \
  --exclude='agent-ctx' --exclude='.agent-tmp' --exclude='.zscripts' --exclude='.env' \
  --exclude='debug' \
  --transform 's,^\.,outdoorprice,' \
  .

EXT_ZIP="download/shop-protocol-extension-${NEW_VERSION}.zip"
cd extension && zip -r "../$EXT_ZIP" . -x "*.DS_Store" > /dev/null 2>&1
cd ..

echo ""
echo "=== Build complete ==="
echo "  Version: $NEW_VERSION"
echo "  Tarball: $TARBALL ($(du -h "$TARBALL" | cut -f1))"
echo "  Extension: $EXT_ZIP ($(du -h "$EXT_ZIP" | cut -f1))"

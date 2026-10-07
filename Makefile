# =============================================================================
# OutdoorPrice - Makefile
# Comparateur de prix outdoor multi-sites avec matching de produits
# =============================================================================
#
# Usage :
#   make install     → installer les dépendances
#   make run         → lancer l'app desktop (Electron)
#   make run-server   → lancer le serveur web seulement (http://localhost:3000)
#   make dist         → build un tarball + zip + Electron distributable
#   make test         → lancer les tests Vitest
#   make lint         → vérifier la qualité du code (ESLint)
#   make check-site   → vérifier un site seul (make check-site SITE=ekosport Q="Dynafit")
#   make clean        → nettoyer les artefacts de build
#   make clean-all    → nettoyer TOUT (ne garder que les fichiers git)
#   make help         → cette aide

SHELL := /bin/bash

# Variables configurables
SITE ?= ekosport
Q ?= Dynafit
PORT ?= 3000

# Détection de bun vs npm
BUN := $(shell command -v bun 2>/dev/null)
NPM := $(shell command -v npm 2>/dev/null)
NODE := $(shell command -v node 2>/dev/null)

# Couleurs
G := \033[32m
Y := \033[33m
B := \033[34m
R := \033[0m

.PHONY: help install run run-server release release-minor release-major package-mac package-win package-linux clean clean-all distclean \
	config check-env env playwright dev dev-debug dev-debug-verbose \
	test lint check-site scrape-all check-all build version release release-minor release-major \
	icons prepare-standalone run-packaged verify-packaged \
	check-bergzeit check-ekosport check-glisshop check-montaz check-snowleader \
	check-sportbittl check-sportconrad check-tradeinn check-auvieuxcampeur \
	check-barrabes check-probikeshop check-alltricks check-deporvillage \
	check-all4cycling check-bike24 check-bikediscount

help: ## Afficher cette aide
	@echo -e ""
	@echo -e "$(B)OutdoorPrice$(R) - Comparateur de prix outdoor multi-sites"
	@echo -e ""
	@echo -e "$(G)Commandes principales :$(R)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[33m%-15s\033[0m %s\n", $$1, $$2}'
	@echo -e ""
	@echo -e "$(G)Variables :$(R)"
	@echo -e "  SITE=$(Y)$(SITE)$(R)   (any site-id — see src/lib/scraper/sites/)"
	@echo -e "  Q=$(Y)$(Q)$(R)         (requête de recherche)"
	@echo -e "  PORT=$(Y)$(PORT)$(R)   (port du serveur dev)"
	@echo -e ""

# === Installation ===

install: ## Installer les dépendances
	@echo -e "$(B)Installation des dépendances...$(R)"
	@if [ -n "$(BUN)" ]; then \
	        bun install; \
	else \
	        npm install; \
	fi
	@echo -e "$(G)✓ Dépendances installées$(R)"

config: check-env install env playwright ## Installer les prérequis et configurer
	@echo -e ""
	@echo -e "$(G)✓ Configuration terminée$(R)"
	@echo -e ""
	@echo -e "Prochaines étapes :"
	@echo -e "  1. $(Y)make run$(R)              → lancer l'app desktop (Electron)"
	@echo -e "  2. $(Y)make run-server$(R)        → lancer le serveur web seul"
	@echo -e "  3. $(Y)make check-site SITE=bergzeit Q=\"Dynafit\"$(R)  → tester un site"
	@echo -e ""

check-env: ## Vérifier les prérequis système
	@echo -e "$(B)Vérification des prérequis...$(R)"
	@if [ -z "$(NODE)" ]; then \
	        echo -e "$(R)✗ Node.js n'est pas installé. Installez Node 20+ depuis https://nodejs.org$(R)"; \
	        exit 1; \
	fi
	@echo -e "  $(G)✓$(R) Node.js : $$($(NODE) --version)"
	@if [ -n "$(BUN)" ]; then \
	        echo -e "  $(G)✓$(R) Bun : $$($(BUN) --version)"; \
	else \
	        echo -e "  $(Y)⚠$(R) Bun non détecté (recommandé). Install : curl -fsSL https://bun.sh/install | bash"; \
	fi

env: ## Créer le fichier .env depuis .env.example
	@if [ ! -f .env ]; then \
	        cp .env.example .env; \
	        echo "$(G)✓$(R) .env créé depuis .env.example"; \
	else \
	        echo "$(Y)⚠$(R) .env existe déjà, préservé"; \
	fi

playwright: ## Installer Chromium pour Playwright (fallback anti-bot)
	@echo -e "$(B)Installation de Chromium pour Playwright...$(R)"
	@if [ -n "$(BUN)" ]; then \
	        bunx playwright install chromium 2>&1 | tail -3; \
	else \
	        npx playwright install chromium 2>&1 | tail -3; \
	fi
	@echo -e "$(G)✓ Chromium installé$(R)"

# === Run ===

run: ## Lancer l'app desktop (Electron)
	bunx tsc -p tsconfig.electron.json
	ELECTRON_DEBUG=1 npx electron dist-electron-src/main.js

run-server: ## Lancer le serveur web seulement (http://localhost:3000)
	@if [ -n "$(BUN)" ]; then \
	        PORT=$(PORT) bun run dev; \
	else \
	        PORT=$(PORT) npm run dev; \
	fi

# Aliases for backward compatibility
dev: run-server ## Alias pour run-server
dev-debug: ## Lancer en mode debug (dump dans debug/)
	@mkdir -p debug
	@if [ -n "$(BUN)" ]; then \
	        DEBUG_DUMP=1 NEXT_PUBLIC_DEBUG_DUMP=1 PORT=$(PORT) bun run dev; \
	else \
	        DEBUG_DUMP=1 NEXT_PUBLIC_DEBUG_DUMP=1 PORT=$(PORT) npm run dev; \
	fi

dev-debug-verbose: ## Lancer en mode debug verbeux
	@mkdir -p debug
	@if [ -n "$(BUN)" ]; then \
	        DEBUG_DUMP=1 DEBUG_VERBOSE=1 NEXT_PUBLIC_DEBUG_DUMP=1 NEXT_PUBLIC_DEBUG_VERBOSE=1 PORT=$(PORT) bun run dev; \
	else \
	        DEBUG_DUMP=1 DEBUG_VERBOSE=1 NEXT_PUBLIC_DEBUG_DUMP=1 NEXT_PUBLIC_DEBUG_VERBOSE=1 PORT=$(PORT) npm run dev; \
	fi

# === Build & Distribute ===

build: ## Build de production (Next.js)
	@if [ -n "$(BUN)" ]; then \
	        bun run build; \
	else \
	        npm run build; \
	fi

# === Release (tarball — source code distribution) ===

release: ## Build tarball + zip (patch version bump)
	@./scripts/build-release.sh

release-minor: ## Build tarball + zip (minor version bump)
	@./scripts/build-release.sh --minor

release-major: ## Build tarball + zip (major version bump)
	@./scripts/build-release.sh --major

# === Generate app icons ===

icons: ## Regenerate PNG icons from public/logo.svg (requires cairosvg)
	@echo -e "$(B)Generating PNG icons from logo.svg...$(R)"
	@command -v python3 >/dev/null 2>&1 || { echo "$(R)python3 required$(R)"; exit 1; }
	@python3 -c "import cairosvg" 2>/dev/null || { \
	        echo "$(R)cairosvg not installed. Run: pip install cairosvg$(R)"; exit 1; }
	python3 scripts/generate-icons.py
	@echo -e "$(G)✓ Icons generated in public/$(R)"

# === Package (Electron native app — .dmg/.exe/.AppImage) ===

prepare-standalone: ## Run scripts/prepare-electron-standalone.js (build electron-resources/standalone/ from .next/standalone/)
	@echo -e "$(B)Preparing standalone server bundle...$(R)"
	@command -v node >/dev/null 2>&1 || { echo "$(R)node required$(R)"; exit 1; }
	@if [ ! -d .next/standalone ]; then \
	        echo "$(R).next/standalone/ not found. Run 'make build' first.$(R)"; exit 1; \
	fi
	node scripts/prepare-electron-standalone.js
	@echo -e "$(G)✓ electron-resources/standalone/ ready$(R)"

package-mac: ## Build .app/.dmg macOS (Electron) — unsigned (local distribution only)
	@echo -e "$(B)Building macOS .app (unsigned, no notarization)...$(R)"
	bunx tsc -p tsconfig.electron.json
	bun run build
	node scripts/prepare-electron-standalone.js
	CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --arm64 --publish=never
	@echo -e "$(G)✓ Build terminé — voir dist-electron/$(R)"
	@echo -e "$(Y)Note: .app is unsigned. To open it:$(R)"
	@echo -e "  $(Y)xattr -cr dist-electron/mac-arm64/OutdoorPrice.app$(R)"
	@echo -e "  $(Y)Then double-click it, or:$(R)"
	@echo -e "  $(Y)make run-packaged$(R)"
	@ls -la dist-electron/*.dmg 2>/dev/null || echo "  (build output in dist-electron/)"

package-win: ## Build .exe Windows (Electron)
	@echo -e "$(B)Building Windows .exe...$(R)"
	bunx tsc -p tsconfig.electron.json
	bun run build
	node scripts/prepare-electron-standalone.js
	bunx electron-builder --win
	@echo -e "$(G)✓ Build terminé — voir dist-electron/$(R)"

package-linux: ## Build .AppImage Linux (Electron)
	@echo -e "$(B)Building Linux .AppImage...$(R)"
	bunx tsc -p tsconfig.electron.json
	bun run build
	node scripts/prepare-electron-standalone.js
	bunx electron-builder --linux
	@echo -e "$(G)✓ Build terminé — voir dist-electron/$(R)"

run-packaged: ## Run the packaged macOS .app from dist-electron/ (with debug traces)
	@echo -e "$(B)Running packaged .app with ELECTRON_DEBUG=1...$(R)"
	@if [ ! -d "dist-electron/mac-arm64/OutdoorPrice.app" ]; then \
	        echo "$(R)dist-electron/mac-arm64/OutdoorPrice.app not found. Run 'make package-mac' first.$(R)"; exit 1; \
	fi
	ELECTRON_DEBUG=1 ./dist-electron/mac-arm64/OutdoorPrice.app/Contents/MacOS/OutdoorPrice

verify-packaged: ## Verify the packaged .app contains all expected standalone files
	@echo -e "$(B)Verifying packaged .app structure...$(R)"
	@if [ ! -d "dist-electron/mac-arm64/OutdoorPrice.app" ]; then \
	        echo "$(R)dist-electron/mac-arm64/OutdoorPrice.app not found. Run 'make package-mac' first.$(R)"; exit 1; \
	fi
	@STANDALONE="dist-electron/mac-arm64/OutdoorPrice.app/Contents/Resources/standalone"; \
	echo -e "$(B)Standalone dir:$$STANDALONE$(R)"; \
	fail=0; \
	for f in server.js package.json modules/next/package.json .next/BUILD_ID .next/required-server-files.json .next/static public; do \
	        if [ ! -e "$$STANDALONE/$$f" ]; then \
	                echo -e "  $(R)✗ MISSING:$$f$(R)"; fail=1; \
	        else \
	                echo -e "  $(G)✓$(R) $$f"; \
	        fi; \
	done; \
	[ $$fail -eq 0 ] && echo -e "$(G)✓ All standalone files present$(R)" || { \
	        echo "$(R)Some files missing. See docs/electron-packaging.md for troubleshooting.$(R)"; exit 1; \
	}

# === Clean ===

clean: ## Nettoyer les artefacts de build
	rm -rf .next dist dev.log server.log electron-resources dist-electron-src
	@echo -e "$(G)✓ Artefacts nettoyés$(R)"

clean-all: ## Nettoyer TOUT (ne garder que les fichiers git)
	@rm -rf .next dist dev.log server.log debug/ dist-electron \
	        electron-resources electron/*.js electron/*.js.map node_modules/.cache \
	        .next/cache tsconfig.tsbuildinfo 2>/dev/null || true
	@find . -name "*.log" -not -path "./node_modules/*" -delete 2>/dev/null || true
	@find . -name ".DS_Store" -not -path "./node_modules/*" -delete 2>/dev/null || true
	@echo -e "$(G)✓ Nettoyage complet — seuls les fichiers git restent$(R)"

distclean: clean-all ## Alias pour clean-all

# === Test & Lint ===

test: ## Lancer les tests Vitest
	@if [ -n "$(BUN)" ]; then \
	        bun run test; \
	else \
	        npm run test; \
	fi

lint: ## Vérifier la qualité du code (ESLint)
	@if [ -n "$(BUN)" ]; then \
	        bun run lint; \
	else \
	        npm run lint; \
	fi

check-all: lint test ## Lint + tests
	@echo -e "$(G)✓ Tout est vert$(R)"

# === CLI tools ===

check-site: ## Vérifier un site seul : make check-site SITE=bergzeit Q="Dynafit"
	@if [ -z "$(SITE)" ] || [ -z "$(Q)" ]; then \
	        echo "$(R)Usage: make check-site SITE=<site-id> Q=\"<query>\"$(R)"; \
	        echo "Sites: bergzeit, ekosport, glisshop, montaz, snowleader, sportbittl, sportconrad, tradeinn, auvieuxcampeur, barrabes, probikeshop, alltricks, telemarkpyrenees, sportokay, bergfreunde, hardloop, oliunid, varuste, deporvillage, all4cycling, bike24, bikediscount"; \
	        exit 1; \
	fi
	@if [ -n "$(BUN)" ]; then \
	        bun run scripts/cli/check-site.ts $(SITE) "$(Q)" --enrich; \
	else \
	        npm run check-site -- $(SITE) "$(Q)" --enrich; \
	fi

scrape-all: ## Scraper tous les sites : make scrape-all Q="Dynafit"
	@if [ -z "$(Q)" ]; then \
	        echo "$(R)Usage: make scrape-all Q=\"<query>\"$(R)"; \
	        exit 1; \
	fi
	@if [ -n "$(BUN)" ]; then \
	        bun run scripts/cli/scrape-all.ts "$(Q)"; \
	else \
	        npm run scrape-all -- "$(Q)"; \
	fi

version: ## Afficher la version actuelle
	@cat VERSION

# === Per-site check shortcuts ===

check-bergzeit:       ; @$(MAKE) check-site SITE=bergzeit Q="$(Q)"
check-ekosport:       ; @$(MAKE) check-site SITE=ekosport Q="$(Q)"
check-glisshop:       ; @$(MAKE) check-site SITE=glisshop Q="$(Q)"
check-montaz:         ; @$(MAKE) check-site SITE=montaz Q="$(Q)"
check-snowleader:     ; @$(MAKE) check-site SITE=snowleader Q="$(Q)"
check-sportbittl:     ; @$(MAKE) check-site SITE=sportbittl Q="$(Q)"
check-sportconrad:    ; @$(MAKE) check-site SITE=sportconrad Q="$(Q)"
check-tradeinn:       ; @$(MAKE) check-site SITE=tradeinn Q="$(Q)"
check-auvieuxcampeur: ; @$(MAKE) check-site SITE=auvieuxcampeur Q="$(Q)"
check-barrabes:       ; @$(MAKE) check-site SITE=barrabes Q="$(Q)"
check-probikeshop:    ; @$(MAKE) check-site SITE=probikeshop Q="$(Q)"
check-alltricks:      ; @$(MAKE) check-site SITE=alltricks Q="$(Q)"
check-deporvillage:   ; @$(MAKE) check-site SITE=deporvillage Q="$(Q)"
check-all4cycling:    ; @$(MAKE) check-site SITE=all4cycling Q="$(Q)"
check-bike24:         ; @$(MAKE) check-site SITE=bike24 Q="$(Q)"
check-bikediscount:   ; @$(MAKE) check-site SITE=bikediscount Q="$(Q)"

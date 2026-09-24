# =============================================================================
# OutdoorPrice - Makefile
# Comparateur de prix outdoor multi-sites avec matching de produits
# =============================================================================
#
# Usage :
#   make config      → installer les prérequis et configurer le projet
#   make install     → installer les dépendances Node
#   make dev         → lancer le serveur de dev (http://localhost:3000)
#   make test        → lancer les tests Vitest
#   make lint        → vérifier la qualité du code (ESLint)
#   make check-site  → vérifier un site seul (make check-site SITE=ekosport Q="Dynafit")
#   make scrape-all  → scraper tous les sites (make scrape-all Q="Dynafit")
#   make check-all   → lint + test
#   make build       → build de production
#   make clean       → nettoyer les artefacts
#   make help        → cette aide

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

.PHONY: help config install dev dev-debug dev-debug-verbose test lint check-site scrape-all check-all build clean env playwright version release release-minor release-major

help: ## Afficher cette aide
	@echo -e ""
	@echo -e "$(B)OutdoorPrice$(R) - Comparateur de prix outdoor multi-sites"
	@echo -e ""
	@echo -e "$(G)Cibles disponibles :$(R)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[33m%-15s\033[0m %s\n", $$1, $$2}'
	@echo -e ""
	@echo -e "$(G)Variables :$(R)"
	@echo -e "  SITE=$(Y)$(SITE)$(R)   (any site-id — see src/lib/scraper/sites/)"
	@echo -e "  Q=$(Y)$(Q)$(R)         (requête de recherche)"
	@echo -e "  PORT=$(Y)$(PORT)$(R)   (port du serveur dev)"
	@echo -e ""

config: check-env install env playwright ## Installer les prérequis et configurer le projet
	@echo -e ""
	@echo -e "$(G)✓ Configuration terminée$(R)"
	@echo -e ""
	@echo -e "Prochaines étapes :"
	@echo -e "  1. $(Y)make dev$(R)              → lancer le serveur (http://localhost:3000)"
	@echo -e "  2. $(Y)make check-site SITE=ekosport Q=\"Dynafit\"$(R)  → tester un site"
	@echo -e "  3. $(Y)make test$(R)             → lancer les tests"
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
		echo -e "  $(Y)⚠$(R) Bun non détecté (recommandé pour de meilleures perfs). Install : curl -fsSL https://bun.sh/install | bash"; \
	fi
	@if [ -n "$(NPM)" ]; then \
		echo -e "  $(G)✓$(R) npm : $$($(NPM) --version)"; \
	fi

install: ## Installer les dépendances Node
	@echo -e "$(B)Installation des dépendances...$(R)"
	@if [ -n "$(BUN)" ]; then \
		bun install; \
	else \
		npm install; \
	fi
	@echo -e "$(G)✓ Dépendances installées$(R)"

env: ## Créer le fichier .env depuis .env.example
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "$(G)✓$(R) .env créé depuis .env.example (à éditer si besoin)"; \
	else \
		echo "$(Y)⚠$(R) .env existe déjà, préservé"; \
	fi

playwright: ## Installer Chromium pour le fallback anti-bot (Cloudflare, JS-rendered)
	@echo -e "$(B)Installation de Chromium pour Playwright (fallback anti-bot)...$(R)"
	@if [ -n "$(BUN)" ]; then \
		bunx playwright install chromium 2>&1 | tail -3; \
	else \
		npx playwright install chromium 2>&1 | tail -3; \
	fi
	@echo -e "$(G)✓ Chromium installé — le fallback Playwright est activé$(R)"

dev: ## Lancer le serveur de développement
	@if [ -n "$(BUN)" ]; then \
		PORT=$(PORT) bun run dev; \
	else \
		PORT=$(PORT) npm run dev; \
	fi
dev-debug: ## Lancer en mode debug (sauvegarde les reponses brutes dans debug/)
	@mkdir -p debug
	@if [ -n "$(BUN)" ]; then \
		DEBUG_DUMP=1 NEXT_PUBLIC_DEBUG_DUMP=1 PORT=$(PORT) bun run dev; \
	else \
		DEBUG_DUMP=1 NEXT_PUBLIC_DEBUG_DUMP=1 PORT=$(PORT) npm run dev; \
	fi

dev-debug-verbose: ## Lancer en mode debug verbeux (logs + dump reponses)
	@mkdir -p debug
	@if [ -n "$(BUN)" ]; then \
		DEBUG_DUMP=1 DEBUG_VERBOSE=1 NEXT_PUBLIC_DEBUG_DUMP=1 NEXT_PUBLIC_DEBUG_VERBOSE=1 PORT=$(PORT) bun run dev; \
	else \
		DEBUG_DUMP=1 DEBUG_VERBOSE=1 NEXT_PUBLIC_DEBUG_DUMP=1 NEXT_PUBLIC_DEBUG_VERBOSE=1 PORT=$(PORT) npm run dev; \
	fi

electron-dev: ## Lancer l'app Electron (dev mode — Next.js + Electron)
	bun run electron:compile
	bun run electron:dev

electron-build: ## Build l'app Electron (dmg/exe/AppImage)
	@bun run electron:compile
	@bun run next build
	@bun run electron-builder

version: ## Afficher la version actuelle
	@cat VERSION

release: ## Build un tarball versionne (increment release)
	@./scripts/build-release.sh

release-minor: ## Build un tarball versionne (increment minor)
	@./scripts/build-release.sh --minor

release-major: ## Build un tarball versionne (increment major)
	@./scripts/build-release.sh --major


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

check-site: ## Vérifier un site seul : make check-site SITE=bergzeit Q="Dynafit"
	@if [ -z "$(SITE)" ] || [ -z "$(Q)" ]; then \
		echo "$(R)Usage: make check-site SITE=<site-id> Q=\"<query>\"$(R)"; \
		echo "Sites: bergzeit, ekosport, glisshop, montaz, snowleader, sportbittl, sportconrad, tradeinn, auvieuxcampeur, barrabes, probikeshop, alltricks"; \
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

build: ## Build de production
	@if [ -n "$(BUN)" ]; then \
		bun run build; \
	else \
		npm run build; \
	fi

clean: ## Nettoyer les artefacts de build
	rm -rf .next dist dev.log server.log
	@echo -e "$(G)✓ Artefacts nettoyés$(R)"

clean-all: ## Nettoyer TOUT (ne garder que les fichiers git)
	rm -rf .next dist dev.log server.log debug/ dist-electron/ \
		electron/*.js electron/*.js.map node_modules/.cache \
		.next/cache tsconfig.tsbuildinfo
	@find . -name "*.log" -not -path "./node_modules/*" -delete
	@find . -name ".DS_Store" -not -path "./node_modules/*" -delete
	@echo -e "$(G)✓ Nettoyage complet — seuls les fichiers git restent$(R)"

distclean: clean-all ## Alias pour clean-all

# Cibles spéciales pour vérifier chaque site individuellement
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

.PHONY: check-bergzeit check-ekosport check-glisshop check-montaz check-snowleader check-sportbittl check-sportconrad check-tradeinn check-auvieuxcampeur check-barrabes check-probikeshop check-alltricks check-deporvillage check-all4cycling

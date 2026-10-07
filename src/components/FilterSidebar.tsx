// FilterSidebar — left column with all filter controls.
//
// Contains:
//   - Live filter input (filters displayed products without re-running search)
//   - Sort dropdown
//   - Promos/In-stock toggles
//   - Price range (dual-thumb slider + min/max inputs)
//   - Min-sites slider
//   - CSV export buttons
//   - 8 dynamic filter sections (brands, sports, categories, etc.)
//   - Shop tree (grouped checkboxes per site)
//   - Debug logs panel (collapsible, sticky bottom)
//
// Reads ALL state from useSearchState() context — no props.
"use client";

import {
  Search, Download, Filter, X, ChevronDown, ChevronUp,
  Tag, Mountain, Layers, Star,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  SITES, type SiteId,
} from "@/lib/scraper/types";
import {
  DEFAULT_GROUPS, ALL_SITE_IDS,
} from "@/lib/scraper/groups";
import { downloadCsv, downloadCategorizedCsv } from "@/lib/csv";
import { useLang } from "@/lib/i18n";
import { clearLogs } from "@/lib/logs";
import { useSearchState, type SortKey } from "@/lib/search-state";
import { FilterSection } from "@/components/FilterSection";
import { FilterBalloon } from "@/components/FilterBalloon";
import { LogsPanel } from "@/components/LogsPanel";

export function FilterSidebar() {
  const {
    liveFilter, setLiveFilter,
    submittedQuery, data, filtered,
    activeFilterCount, resetFilters,
    sortKey, setSortKey,
    onlyPromos, setOnlyPromos, onlyInStock, setOnlyInStock,
    minPrice, setMinPrice, maxPrice, setMaxPrice,
    minSites, setMinSites,
    showShopTree, setShowShopTree,
    selectedSites, computedGroupSites, userOff, setUserOff,
    toggleSite, toggleSet,
    activeBrands, setActiveBrands,
    activeCategories, setActiveCategories,
    activeSubcategories, setActiveSubcategories,
    activeSports, setActiveSports,
    activeRanges, setActiveRanges,
    activeGenders, setActiveGenders,
    activeColors, setActiveColors,
    activeSizes, setActiveSizes,
    statsBySite,
    isDebugMode,
    logs,
  } = useSearchState();
  const { t } = useLang();

  return (
    <>
      <aside className="space-y-4 lg:sticky lg:top-[120px] lg:self-start lg:max-h-[calc(100vh-140px)] lg:overflow-y-auto pr-1">
        {/* Live filter */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
          <Input
            type="text"
            value={liveFilter}
            onChange={(e) => setLiveFilter(e.target.value)}
            placeholder={submittedQuery.length >= 2 ? t("liveFilter.placeholder") : t("search.placeholder")}
            className="pl-9 bg-white"
            aria-label={t("liveFilter.aria")}
          />
          {liveFilter && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <Badge variant="secondary" className="text-[10px]">
                {filtered.length} / {data?.products?.length ?? 0}
              </Badge>
              <button
                onClick={() => setLiveFilter("")}
                className="text-stone-400 hover:text-stone-700"
                aria-label={t("liveFilter.clear")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Filter className="h-4 w-4" /> Filtres
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {activeFilterCount}
                  </Badge>
                )}
              </CardTitle>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={resetFilters}>
                  <X className="h-3 w-3 mr-1" /> Effacer
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Active filter balloons */}
            {activeFilterCount > 0 && (
              <div className="flex flex-wrap gap-1.5 pb-2 border-b border-stone-100">
                {Array.from(activeBrands).map((v) => (
                  <FilterBalloon key={`brand-${v}`} label={v} onRemove={() => toggleSet(setActiveBrands)(v)} />
                ))}
                {Array.from(activeCategories).map((v) => (
                  <FilterBalloon key={`cat-${v}`} label={v} onRemove={() => toggleSet(setActiveCategories)(v)} />
                ))}
                {Array.from(activeSubcategories).map((v) => (
                  <FilterBalloon key={`subcat-${v}`} label={v} onRemove={() => toggleSet(setActiveSubcategories)(v)} />
                ))}
                {Array.from(activeSports).map((v) => (
                  <FilterBalloon key={`sport-${v}`} label={v} onRemove={() => toggleSet(setActiveSports)(v)} />
                ))}
                {Array.from(activeRanges).map((v) => (
                  <FilterBalloon key={`range-${v}`} label={v} onRemove={() => toggleSet(setActiveRanges)(v)} />
                ))}
                {Array.from(activeGenders).map((v) => (
                  <FilterBalloon key={`gender-${v}`} label={v} onRemove={() => toggleSet(setActiveGenders)(v)} />
                ))}
                {Array.from(activeColors).map((v) => (
                  <FilterBalloon key={`color-${v}`} label={v} onRemove={() => toggleSet(setActiveColors)(v)} />
                ))}
                {Array.from(activeSizes).map((v) => (
                  <FilterBalloon key={`size-${v}`} label={v} onRemove={() => toggleSet(setActiveSizes)(v)} />
                ))}
                {onlyPromos && (
                  <FilterBalloon label="Promos" onRemove={() => setOnlyPromos(false)} />
                )}
                {onlyInStock && (
                  <FilterBalloon label="En stock" onRemove={() => setOnlyInStock(false)} />
                )}
                {minPrice !== null && (
                  <FilterBalloon label={`Min ${minPrice}€`} onRemove={() => setMinPrice(null)} />
                )}
                {maxPrice !== null && (
                  <FilterBalloon label={`Max ${maxPrice}€`} onRemove={() => setMaxPrice(null)} />
                )}
                {minSites > 1 && (
                  <FilterBalloon label={`Min ${minSites} sites`} onRemove={() => setMinSites(1)} />
                )}
              </div>
            )}

            {/* Sort */}
            <div>
              <Label className="text-xs text-stone-500">{t('sidebar.sort')}</Label>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="siteCount_desc">{t('sidebar.sortSiteCount')}</SelectItem>
                  <SelectItem value="price_asc">{t('sidebar.sortPriceAsc')}</SelectItem>
                  <SelectItem value="price_desc">{t('sidebar.sortPriceDesc')}</SelectItem>
                  <SelectItem value="savings_desc">{t('sidebar.sortSavings')}</SelectItem>
                  <SelectItem value="rating_desc">{t('sidebar.sortRating')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Display toggles */}
            <div className="space-y-2">
              <Label className="text-xs text-stone-500">{t('sidebar.display')}</Label>
              <div className="flex items-center justify-between">
                <span className="text-sm">{t('sidebar.promosOnly')}</span>
                <Switch checked={onlyPromos} onCheckedChange={setOnlyPromos} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">{t('sidebar.inStockOnly')}</span>
                <Switch checked={onlyInStock} onCheckedChange={setOnlyInStock} />
              </div>
            </div>

            <Separator />

            {/* Price range */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-stone-500">{t('sidebar.priceRange')}</Label>
                {(minPrice !== null || maxPrice !== null) && (
                  <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1" onClick={() => { setMinPrice(null); setMaxPrice(null); }}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    type="number" min={0}
                    placeholder={t("sidebar.priceMin")}
                    value={minPrice ?? ""}
                    onChange={(e) => {
                      const v = e.target.value ? Number(e.target.value) : null;
                      setMinPrice(v);
                      if (v !== null && maxPrice !== null && v > maxPrice) setMaxPrice(v);
                    }}
                    className="bg-white text-xs h-8"
                  />
                </div>
                <span className="text-stone-400 text-xs">—</span>
                <div className="flex-1">
                  <Input
                    type="number" min={0}
                    placeholder={t("sidebar.priceMax")}
                    value={maxPrice ?? ""}
                    onChange={(e) => {
                      const v = e.target.value ? Number(e.target.value) : null;
                      setMaxPrice(v);
                      if (v !== null && minPrice !== null && v < minPrice) setMinPrice(v);
                    }}
                    className="bg-white text-xs h-8"
                  />
                </div>
              </div>
              {data?.filters?.priceRange && (() => {
                const pr = data.filters.priceRange;
                const lo = minPrice ?? pr.min;
                const hi = maxPrice ?? pr.max;
                const sliderMin = pr.min;
                const sliderMax = pr.max === pr.min ? pr.min + 1 : pr.max;
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-stone-600">
                      <span className="font-medium">{lo}€</span>
                      <span className="text-stone-400">→</span>
                      <span className="font-medium">{hi}€</span>
                    </div>
                    <Slider
                      value={[Math.min(lo, sliderMax), Math.max(hi, sliderMin)]}
                      min={sliderMin} max={sliderMax} step={1}
                      onValueChange={([newLo, newHi]) => {
                        setMinPrice(newLo);
                        setMaxPrice(newHi);
                      }}
                      className="w-full"
                      aria-label={`${t("sidebar.priceMinAria")} – ${t("sidebar.priceMaxAria")}`}
                    />
                    <div className="flex justify-between text-[10px] text-stone-400">
                      <span>{sliderMin}€</span>
                      <span>{sliderMax}€</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Min sites */}
            <div className="space-y-2">
              <Label className="text-xs text-stone-500">
                Sites proposant le produit : min {minSites}
              </Label>
              <input
                type="range" min={1} max={9}
                value={minSites}
                onChange={(e) => setMinSites(Number(e.target.value))}
                className="w-full accent-stone-900"
              />
            </div>

            <Separator />

            {/* CSV export */}
            {filtered.length > 0 && (
              <div className="space-y-2">
                <Button variant="outline" size="sm" className="w-full" onClick={() => downloadCsv(filtered)}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Exporter CSV ({filtered.length} produits)
                </Button>
                {isDebugMode && (
                  <Button
                    variant="outline" size="sm"
                    className="w-full border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                    onClick={() => downloadCategorizedCsv(filtered)}
                    title="Une ligne par produit, avec toutes les métadonnées de classification."
                  >
                    <Layers className="h-3.5 w-3.5 mr-1.5" />
                    Debug CSV catégorisé ({filtered.length} produits)
                  </Button>
                )}
              </div>
            )}

            <Separator />

            {/* Dynamic filter sections */}
            {data && data.filters.brands.length > 0 && (
              <FilterSection title={t("filter.brands")} icon={<Tag className="h-3.5 w-3.5" />}
                options={data.filters.brands} active={activeBrands} onToggle={toggleSet(setActiveBrands)} />
            )}
            {data && data.filters.sports.length > 0 && (
              <FilterSection title={t("filter.sports")} icon={<Mountain className="h-3.5 w-3.5" />}
                options={data.filters.sports} active={activeSports} onToggle={toggleSet(setActiveSports)} />
            )}
            {data && data.filters.categories.length > 0 && (
              <FilterSection title={t("filter.categories")} icon={<Layers className="h-3.5 w-3.5" />}
                options={data.filters.categories} active={activeCategories} onToggle={toggleSet(setActiveCategories)} />
            )}
            {data && data.filters.subcategories.length > 0 && (
              <FilterSection title={t("filter.subcategories")} icon={<Layers className="h-3.5 w-3.5" />}
                options={data.filters.subcategories} active={activeSubcategories} onToggle={toggleSet(setActiveSubcategories)} />
            )}
            {data && data.filters.ranges.length > 0 && (
              <FilterSection title={t("filter.range")} icon={<Star className="h-3.5 w-3.5" />}
                options={data.filters.ranges} active={activeRanges} onToggle={toggleSet(setActiveRanges)} />
            )}
            {data && data.filters.genders.length > 0 && (
              <FilterSection title={t("filter.gender")} icon={<Star className="h-3.5 w-3.5" />}
                options={data.filters.genders} active={activeGenders} onToggle={toggleSet(setActiveGenders)} />
            )}
            {data && data.filters.colors.length > 0 && (
              <FilterSection title={t("filter.colors")} icon={<Star className="h-3.5 w-3.5" />}
                options={data.filters.colors} active={activeColors} onToggle={toggleSet(setActiveColors)} />
            )}
            {data && data.filters.sizes.length > 0 && (
              <FilterSection title={t("filter.sizes")} icon={<Star className="h-3.5 w-3.5" />}
                options={data.filters.sizes} active={activeSizes} onToggle={toggleSet(setActiveSizes)} />
            )}

            <Separator />

            {/* Shop tree */}
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs text-stone-500">
                  Sites ({selectedSites.length}/{ALL_SITE_IDS.length})
                </Label>
                <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1" onClick={() => setShowShopTree(!showShopTree)}>
                  {showShopTree ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </Button>
              </div>
              <div className="mt-2 space-y-1 max-h-80 overflow-y-auto pr-1">
                {DEFAULT_GROUPS.filter((g) => g.id !== "all").map((group) => {
                  const groupSites = group.sites.filter((id) => ALL_SITE_IDS.includes(id));
                  if (groupSites.length === 0) return null;
                  const selectedInGroup = groupSites.filter((id) => selectedSites.includes(id));
                  const allSelected = selectedInGroup.length === groupSites.length;
                  const someSelected = selectedInGroup.length > 0 && !allSelected;
                  return (
                    <div key={group.id} className="rounded-md">
                      <div className="flex items-center gap-1 px-1 py-1 bg-stone-100 rounded-t-md sticky top-0 z-10">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={() => {
                            if (allSelected) {
                              setUserOff((prev) => {
                                const next = new Set(prev);
                                groupSites.forEach((id) => next.add(id));
                                return next;
                              });
                            } else {
                              setUserOff((prev) => {
                                const next = new Set(prev);
                                groupSites.forEach((id) => next.delete(id));
                                return next;
                              });
                            }
                          }}
                          className="data-[state=indeterminate]:opacity-50"
                          {...(someSelected ? { "data-state": "indeterminate" as const } : {})}
                        />
                        <span className="text-[11px] font-semibold text-stone-700 flex-1">
                          {group.icon} {group.name}
                        </span>
                        <span className="text-[10px] text-stone-500 tabular-nums">
                          {selectedInGroup.length}/{groupSites.length}
                        </span>
                      </div>
                      {showShopTree && (
                        <div className="ml-1 border-l border-stone-200 pl-1">
                          {groupSites.map((id) => {
                            const meta = SITES[id];
                            const stat = statsBySite.get(id);
                            const isSelected = selectedSites.includes(id);
                            return (
                              <label key={id} className="flex items-center gap-2 cursor-pointer rounded p-1 hover:bg-stone-50 group/row">
                                <Checkbox checked={isSelected} onCheckedChange={() => toggleSite(id)} className="h-3.5 w-3.5" />
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${meta.accent} flex-1 truncate`}>
                                  {meta.name}
                                </span>
                                <span className="text-[10px] text-stone-500 tabular-nums text-right min-w-[3rem]">
                                  {stat && stat.count > 0 ? (
                                    <span className="font-medium text-stone-700">{stat.count}</span>
                                  ) : stat?.status === "error" ? (
                                    <span className="text-red-500">err</span>
                                  ) : stat?.status === "empty" ? (
                                    <span className="text-stone-400">0</span>
                                  ) : (
                                    <span className="text-stone-300">—</span>
                                  )}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Ungrouped sites */}
                {(() => {
                  const grouped = new Set(DEFAULT_GROUPS.flatMap((g) => g.sites));
                  const ungrouped = ALL_SITE_IDS.filter((id) => !grouped.has(id));
                  if (ungrouped.length === 0) return null;
                  return (
                    <div className="rounded-md">
                      <div className="text-[11px] font-semibold text-stone-700 px-1 py-1 bg-stone-100 rounded-t-md">
                        {t("sidebar.other")}
                      </div>
                      {showShopTree && (
                        <div className="ml-1 border-l border-stone-200 pl-1">
                          {ungrouped.map((id) => {
                            const meta = SITES[id];
                            const stat = statsBySite.get(id);
                            const isSelected = selectedSites.includes(id);
                            return (
                              <label key={id} className="flex items-center gap-2 cursor-pointer rounded p-1 hover:bg-stone-50">
                                <Checkbox checked={isSelected} onCheckedChange={() => toggleSite(id)} className="h-3.5 w-3.5" />
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${meta.accent} flex-1 truncate`}>
                                  {meta.name}
                                </span>
                                <span className="text-[10px] text-stone-500 tabular-nums text-right min-w-[3rem]">
                                  {stat && stat.count > 0 ? stat.count : "—"}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => setUserOff(new Set())}>
                  Tout
                </Button>
                <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => setUserOff(new Set(computedGroupSites))}>
                  Aucun
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </aside>

      {/* Logs panel (sticky bottom, outside sidebar scroll) */}
      <LogsPanel logs={logs} onClear={clearLogs} />
    </>
  );
}

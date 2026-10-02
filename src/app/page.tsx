'use client';

// =============================================================================
// page.tsx — Orchestrator.
//
// This file used to contain 1420 lines of state, logic, and JSX. It now does
// exactly ONE thing: wire the SearchStateProvider around the 3 layout zones.
//
// Architecture (v0.14.27):
//
//   <SearchStateProvider>           ← src/lib/search-state.tsx
//     <div>                          ← page shell
//       <AppHeader />               ← src/components/AppHeader.tsx
//       <main>
//         <FilterSidebar />         ← src/components/FilterSidebar.tsx
//         <ProductList />           ← src/components/ProductList.tsx
//       </main>
//       <AppFooter />               ← src/components/ProductList.tsx (co-located)
//     </div>
//   </SearchStateProvider>
//
// Data + event flow:
//   - ALL state lives in SearchStateContext (single source of truth)
//   - Each component reads only what it needs via useSearchState() hook
//   - No prop drilling — components don't know about each other
//   - Event handlers (onSubmit, toggleSite, selectGroup, etc.) are defined
//     ONCE in the provider and consumed by any component that needs them
//
// To add a new filter: add state to SearchStateProvider → use it in FilterSidebar
// To add a new result view: add it to ProductList
// To change the header layout: edit AppHeader only
// =============================================================================

import { SearchStateProvider } from "@/lib/search-state";
import { AppHeader } from "@/components/AppHeader";
import { FilterSidebar } from "@/components/FilterSidebar";
import { ProductList, AppFooter } from "@/components/ProductList";

export default function Home() {
  return (
    <SearchStateProvider>
      <div className="min-h-screen flex flex-col bg-stone-50 text-stone-900 pb-10">
        <AppHeader />
        <main className="mx-auto max-w-7xl w-full px-4 py-6 flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          <FilterSidebar />
          <ProductList />
        </main>
        <AppFooter />
      </div>
    </SearchStateProvider>
  );
}

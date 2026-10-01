// Loading state shown while /api/search is in flight.
// Pure presentational component — no props, no state.
//
// Extracted from src/app/page.tsx (P1.1 refactor) so the page file is smaller
// and easier to scan. Behavior unchanged.
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SITES } from "@/lib/scraper/types";
import { ALL_SITE_IDS } from "@/lib/scraper/groups";

export function LoadingState() {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-stone-500" />
            <div className="text-sm text-stone-600">
              Workflow en cours : <strong>recherche</strong> → <strong>enrichissement pages produits</strong> →{" "}
              <strong>matching cross-site</strong> → <strong>filtres dynamiques</strong>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-9 gap-2">
            {ALL_SITE_IDS.map((id) => (
              <div key={id} className={`rounded border px-2 py-1 text-center text-[11px] ${SITES[id].accent}`}>
                {SITES[id].name}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <div className="flex">
              <Skeleton className="w-40 aspect-[4/3] rounded-none" />
              <CardContent className="p-3 flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-6 w-1/3 mt-2" />
              </CardContent>
            </div>
            <Skeleton className="h-10 w-full rounded-none" />
          </Card>
        ))}
      </div>
    </div>
  );
}

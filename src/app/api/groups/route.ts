// Route API : GET /api/groups
//   Renvoie les groupes prédéfinis + custom (lus depuis le header X-Custom-Groups
//   envoyé par le client, car l'API server-side n'a pas accès à localStorage).
//
// Route API : POST /api/groups
//   Crée / met à jour un groupe custom.
//   Body: { id, name, description?, icon?, accent?, sites: SiteId[] }
//   Réponse: { group: ShopGroup } validé (la persistance se fait côté client).
//
// Route API : DELETE /api/groups?id=<groupId>
//   Supprime un groupe custom (les groupes builtin ne sont pas supprimables).
//
// Note: les groupes custom sont gérés côté client (localStorage) — cette API
// ne fait que de la validation server-side et renvoie les groupes builtin.
// Le client est responsable de la persistance.
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_GROUPS, sanitizeSiteIds } from "@/lib/scraper/groups";
import type { ShopGroup } from "@/lib/scraper/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lit les groupes custom depuis le header X-Custom-Groups (base64 JSON). */
function readCustomGroupsFromHeader(req: NextRequest): ShopGroup[] {
  const header = req.headers.get("X-Custom-Groups");
  if (!header) return [];
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((g: unknown): g is ShopGroup => {
        if (!g || typeof g !== "object") return false;
        const obj = g as Record<string, unknown>;
        return typeof obj.id === "string" && typeof obj.name === "string"
          && Array.isArray(obj.sites);
      })
      .map((g) => ({
        ...g,
        builtin: false,
        sites: sanitizeSiteIds(g.sites),
      }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const custom = readCustomGroupsFromHeader(req);
  const groups = [...DEFAULT_GROUPS, ...custom];
  return NextResponse.json({ groups });
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!id || !name) {
    return NextResponse.json(
      { error: "Champs requis manquants: id, name" },
      { status: 400 }
    );
  }
  // Refuse les IDs builtin
  const builtinIds = DEFAULT_GROUPS.map((g) => g.id);
  if (builtinIds.includes(id)) {
    return NextResponse.json(
      { error: `L'ID "${id}" est réservé (groupe prédéfini). Choisissez un autre ID.` },
      { status: 400 }
    );
  }
  const sites = sanitizeSiteIds(body?.sites);
  const group: ShopGroup = {
    id,
    name,
    description: typeof body?.description === "string" ? body.description : undefined,
    icon: typeof body?.icon === "string" ? body.icon : undefined,
    accent: typeof body?.accent === "string" ? body.accent : undefined,
    sites,
    builtin: false,
  };
  // Renvoie le groupe validé — la persistance se fait côté client
  return NextResponse.json({ group });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Paramètre id manquant" }, { status: 400 });
  }
  // Refuse de supprimer les groupes builtin
  if (DEFAULT_GROUPS.some((g) => g.id === id)) {
    return NextResponse.json(
      { error: `Le groupe "${id}" est prédéfini et ne peut pas être supprimé.` },
      { status: 400 }
    );
  }
  // La suppression effective se fait côté client (localStorage)
  return NextResponse.json({ deleted: id });
}

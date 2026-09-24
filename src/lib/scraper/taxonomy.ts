// Taxonomie outdoor : mappe les intitulés de catégories/sites vers une
// classification cohérente (sport + catégorie + sous-catégorie + gamme).
//
// Permet de normaliser les métadonnées extraites pour :
//   - proposer des filtres cohérents cross-site
//   - améliorer le matching (produits de même sport+catégorie+sous-catégorie)
//
// Les expressions régulières sont testées contre une chaîne normalisée
// (minuscules, sans accents) composée du category + subcategory + breadcrumb
// extrait de la page produit.

export interface TaxonomyMatch {
  sport?: string;
  category?: string;
  subcategory?: string;
  range?: string;
}

interface Rule {
  patterns: RegExp[];
  out: TaxonomyMatch;
}

// ---- Sports / activités ----
const SPORT_RULES: Rule[] = [
  // Ski de randonnée / touring
  { patterns: [/ski\s+rando/, /ski\s+tour/, /skitour/, /ski\s+de\s+rando/, /backcountry/, /randonn.{0,5}ski/], out: { sport: "Ski de randonnée" } },
  // Ski alpin
  { patterns: [/ski\s+alpin/, /downhill\s+ski/, /piste/], out: { sport: "Ski alpin" } },
  // Ski de fond
  { patterns: [/ski\s+fond/, /cross\s+country/, /nordic\s+ski/], out: { sport: "Ski de fond" } },
  // Splitboard
  { patterns: [/splitboard/], out: { sport: "Splitboard" } },
  // Snowboard
  { patterns: [/snowboard/, /snow\s+board/], out: { sport: "Snowboard" } },
  // Alpinisme
  { patterns: [/alpinism/, /mountaineer/, /alpine/, /haute\s+montagne/], out: { sport: "Alpinisme" } },
  // Escalade
  { patterns: [/escalade/, /climbing/, /escalade\s+falaise/], out: { sport: "Escalade" } },
  // Trail / running
  { patterns: [/trail/, /running/, /course\s+pied/], out: { sport: "Trail & running" } },
  // Randonnée pédestre
  { patterns: [/randonn.{0,5}pied/, /hiking/, /trekking/], out: { sport: "Randonnée" } },
  // VTT / vélo
  { patterns: [/vtt/, /mountain\s+bike/, /velo/, /cyclis/], out: { sport: "VTT & vélo" } },
  // Bivouac / camp
  { patterns: [/bivouac/, /camping/, /camp/], out: { sport: "Bivouac" } },
];

// ---- Catégories d'équipement ----
// Ordre important : les règles plus spécifiques doivent venir AVANT les génériques
const CATEGORY_RULES: Rule[] = [
  { patterns: [/peaux?\s+(de\s+)?ski/, /climbing\s+skins?/, /\bskins?\b/], out: { category: "Peaux de ski" } },
  { patterns: [/chaussures?\s+(d['e]?\s*)?approche/, /approach/], out: { category: "Chaussures d'approche" } },
  { patterns: [/sacs?\s+(a|à|dos)\s/, /backpacks?/, /rucksack/], out: { category: "Sacs à dos" } },
  { patterns: [/\bskis?\b/, /\bskis\b/], out: { category: "Skis" } },
  { patterns: [/chaussures?/, /boots?/, /schuhe/], out: { category: "Chaussures" } },
  { patterns: [/fixations?/, /bindings?/], out: { category: "Fixations" } },
  { patterns: [/crampons?/], out: { category: "Crampons" } },
  { patterns: [/piolets?/, /ice\s+axes?/], out: { category: "Piolets" } },
  { patterns: [/casques?/, /helmets?/], out: { category: "Casques" } },
  { patterns: [/vestes?/, /jackets?/], out: { category: "Vestes" } },
  { patterns: [/pantalons?/, /pants?/, /trousers?/], out: { category: "Pantalons" } },
  { patterns: [/baudriers?/, /harness/], out: { category: "Baudriers" } },
  { patterns: [/cordes?/, /ropes?/], out: { category: "Cordes" } },
  { patterns: [/mousquetons?/, /carabiners?/], out: { category: "Mousquetons" } },
  { patterns: [/assureurs?/, /belay/, /grigri/], out: { category: "Assureurs" } },
  { patterns: [/lampe/, /headlamp/, /frontale/, /stirnlampe/], out: { category: "Lampes frontales" } },
  { patterns: [/boussole/, /compass/], out: { category: "Boussoles" } },
  { patterns: [/montres?/, /watch/], out: { category: "Montres" } },
  { patterns: [/lunettes?/, /goggles?/, /sunglasses?/], out: { category: "Lunettes" } },
  { patterns: [/gants?/, /mittens?/, /glove/], out: { category: "Gants" } },
  { patterns: [/ponchos?/, /raincoat/], out: { category: "Vêtements pluie" } },
];

// ---- Sous-catégories ----
const SUBCATEGORY_RULES: Rule[] = [
  { patterns: [/ski.{0,3}homme/, /homme.{0,3}ski/], out: { subcategory: "Skis homme" } },
  { patterns: [/ski.{0,3}femme/, /femme.{0,3}ski/], out: { subcategory: "Skis femme" } },
  { patterns: [/mixte/], out: { subcategory: "Mixte" } },
  { patterns: [/light/, /ultra.{0,3}light/, /feather/], out: { subcategory: "Ultralight" } },
  { patterns: [/freeride/], out: { subcategory: "Freeride" } },
  { patterns: [/racing/, /race/, /compet/], out: { subcategory: "Compétition" } },
  { patterns: [/loisir/, /leisure/], out: { subcategory: "Loisir" } },
];

// ---- Gamme / usage ----
const RANGE_RULES: Rule[] = [
  { patterns: [/compet/, /race/, /racing/, /pro/, /expert/, /elite/], out: { range: "Compétition" } },
  { patterns: [/performance/, /sport/, /advanced/], out: { range: "Performance" } },
  { patterns: [/loisir/, /leisure/, /beginner/, /debutant/, /entry/], out: { range: "Loisir" } },
  { patterns: [/light/, /ultra.{0,3}light/, /feather/, /ultra/], out: { range: "Ultralight" } },
  { patterns: [/freeride/, /freestyle/, /all.{0,3}mountain/], out: { range: "Freeride" } },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Applique les règles dans l'ordre et fusionne les matches. */
export function classifyTaxonomy(...inputs: (string | undefined)[]): TaxonomyMatch {
  const text = normalize(inputs.filter(Boolean).join(" "));
  if (!text) return {};
  const out: TaxonomyMatch = {};
  const ruleSets = [SPORT_RULES, CATEGORY_RULES, SUBCATEGORY_RULES, RANGE_RULES];
  for (const rules of ruleSets) {
    for (const rule of rules) {
      if (rule.patterns.some((p) => p.test(text))) {
        for (const [k, v] of Object.entries(rule.out)) {
          if (!(k in out) && v) (out as any)[k] = v;
        }
        break; // 1ère règle matchée gagne pour ce set
      }
    }
  }
  return out;
}

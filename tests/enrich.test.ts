import { describe, it, expect } from "vitest";
import { guessBrandFromTitle, parseWeightGrams, extractColorsFromTitle } from "@/lib/scraper/enrich";

describe("guessBrandFromTitle", () => {
  it("détecte les marques outdoor connues", () => {
    expect(guessBrandFromTitle("Dynafit Speed Radical")).toBe("Dynafit");
    expect(guessBrandFromTitle("Scarpa F1 LT")).toBe("Scarpa");
    expect(guessBrandFromTitle("Salomon S/Lab MTN")).toBe("Salomon");
    expect(guessBrandFromTitle("Black Diamond Helio")).toBe("Black Diamond");
    expect(guessBrandFromTitle("Petzl GriGri")).toBe("Petzl");
    expect(guessBrandFromTitle("Arc'teryx Beta AR")).toBe("Arc'teryx");
  });

  it("détecte Hoka et autres marques trail", () => {
    expect(guessBrandFromTitle("Hoka Speedgoat 7")).toBe("Hoka");
    expect(guessBrandFromTitle("HOKA Speedgoat 7")).toBe("Hoka");
    expect(guessBrandFromTitle("Brooks Cascadia 16")).toBe("Brooks");
    expect(guessBrandFromTitle("Saucony Peregrine 13")).toBe("Saucony");
  });

  it("infère la marque depuis le modèle quand le titre ne contient pas la marque", () => {
    // Snowleader omet souvent la marque du titre — on doit l'inférer depuis
    // le nom du modèle (ex: « Speedgoat » → « Hoka »).
    expect(guessBrandFromTitle("Speedgoat 7 M Bay Leaf/Sea Glass")).toBe("Hoka");
    expect(guessBrandFromTitle("Speedgoat 6 W Oatmeal/Mountain Iris")).toBe("Hoka");
  });

  it("retourne undefined si aucune marque connue et pas de mot capitalisé", () => {
    expect(guessBrandFromTitle("ski générique sans marque connue")).toBeUndefined();
  });

  it("gère la casse insensible", () => {
    expect(guessBrandFromTitle("dynafit speed radical")).toBe("Dynafit");
    expect(guessBrandFromTitle("DYNAFIT SPEED")).toBe("Dynafit");
  });

  it("détecte les marques cyclisme (Castelli, Sportful, Rapha, etc.)", () => {
    expect(guessBrandFromTitle("Castelli Espresso")).toBe("Castelli");
    // La fonction retourne la casse canonique (Castelli), pas la casse du titre
    expect(guessBrandFromTitle("CASTELLI PERFETTO RoS Noir")).toBe("Castelli");
    expect(guessBrandFromTitle("Sportful Giara")).toBe("Sportful");
    expect(guessBrandFromTitle("Rapha Brevet")).toBe("Rapha");
    expect(guessBrandFromTitle("Shimano Dura-Ace")).toBe("Shimano");
    expect(guessBrandFromTitle("SRAM Red")).toBe("SRAM");
    expect(guessBrandFromTitle("Continental Grand Prix")).toBe("Continental");
    expect(guessBrandFromTitle("Sidi Wire")).toBe("Sidi");
  });

  it("ne confond pas une catégorie de produit avec une marque (cas ProBikeShop)", () => {
    // Bug historique : "Manchettes CASTELLI ESPRESSO Bordeaux" → "Manchettes" (faux)
    expect(guessBrandFromTitle("Manchettes CASTELLI ESPRESSO Bordeaux")).toBe("Castelli");
    expect(guessBrandFromTitle("Gants CASTELLI TUTTO NANO Noir")).toBe("Castelli");
    expect(guessBrandFromTitle("Jambières CASTELLI ESPRESSO Marine")).toBe("Castelli");
    expect(guessBrandFromTitle("Couvre Chaussures CASTELLI ESPRESSO Noir")).toBe("Castelli");
    expect(guessBrandFromTitle("Couvre-Chaussures CASTELLI PERFETTO Noir")).toBe("Castelli");
    expect(guessBrandFromTitle("Maillot Castelli Soudal Quick-Step Giro 2026")).toBe("Castelli");
    expect(guessBrandFromTitle("Cuissard Giro d'Italia 2026 Trofeo 2.0")).toBe("Giro");
  });

  it("ne confond pas une couleur avec une marque", () => {
    expect(guessBrandFromTitle("Noir CASTELLI Espresso")).toBe("Castelli");
    expect(guessBrandFromTitle("Bordeaux VTT Route")).not.toBe("Bordeaux");
  });

  it("retourne undefined plutôt qu'une catégorie si aucune marque connue n'est trouvée", () => {
    // Sans marque connue dans le titre, on NE doit PAS retourner le 1er mot
    // (qui est probablement une catégorie comme "Gants" ou "Cuissard")
    expect(guessBrandFromTitle("Cuissard homme noir route")).toBeUndefined();
    expect(guessBrandFromTitle("Maillot manches courtes")).toBeUndefined();
  });
});

describe("parseWeightGrams", () => {
  it("parse les grammes", () => {
    expect(parseWeightGrams("850 g")).toBe(850);
    expect(parseWeightGrams("850g")).toBe(850);
    expect(parseWeightGrams("1234 g")).toBe(1234);
  });

  it("parse les kilogrammes", () => {
    expect(parseWeightGrams("1.2 kg")).toBe(1200);
    expect(parseWeightGrams("0.85 kg")).toBe(850);
    expect(parseWeightGrams("2 kg")).toBe(2000);
  });

  it("parse avec virgule décimale", () => {
    expect(parseWeightGrams("1,5 kg")).toBe(1500);
  });

  it("retourne undefined pour les entrées invalides", () => {
    expect(parseWeightGrams("")).toBeUndefined();
    expect(parseWeightGrams(undefined)).toBeUndefined();
    expect(parseWeightGrams("N/A")).toBeUndefined();
  });
});

describe("extractColorsFromTitle", () => {
  it("extrait les couleurs du suffixe /<coloris> (Montaz)", () => {
    expect(extractColorsFromTitle("Dynafit Radical 24 Backpack /noir out")).toEqual(
      expect.arrayContaining(["Noir", "Out"])
    );
  });

  it("extrait les couleurs composées du suffixe", () => {
    const r = extractColorsFromTitle("DYNAFIT Radical 24 Backpack /overcast cinder");
    expect(r).toEqual(expect.arrayContaining(["Overcast", "Cinder"]));
  });

  it("extrait une couleur française du suffixe", () => {
    const r = extractColorsFromTitle("Dynafit Radical /bleu");
    expect(r).toEqual(["Bleu"]);
  });

  it("retourne [] quand le titre ne contient aucune couleur connue", () => {
    expect(extractColorsFromTitle("Dynafit Radical 24 Backpack")).toEqual([]);
  });

  it("ne remonte pas les mots non-couleur du suffixe", () => {
    // « backpack » et « radical » ne sont pas des couleurs
    const r = extractColorsFromTitle("Dynafit Radical 24 Backpack /noir");
    expect(r).toEqual(["Noir"]);
    expect(r).not.toContain("Backpack");
  });

  it("gère le pattern 'couleur: <value>' explicite", () => {
    const r = extractColorsFromTitle("Dynafit Speed Radical couleur: rouge");
    expect(r).toContain("Rouge");
  });

  it("scan global quand pas de suffixe /<coloris>", () => {
    // Pas de « / », mais « Bleu » apparaît comme un mot → couleur
    const r = extractColorsFromTitle("Dynafit Radical Bleu");
    expect(r).toEqual(["Bleu"]);
  });

  it("déduplique les couleurs identiques", () => {
    const r = extractColorsFromTitle("Dynafit Radical /bleu bleu");
    // On ne doit pas avoir deux fois « Bleu »
    const bleuCount = r.filter((c) => c === "Bleu").length;
    expect(bleuCount).toBe(1);
  });

  it("retourne [] pour undefined ou titre vide", () => {
    expect(extractColorsFromTitle(undefined)).toEqual([]);
    expect(extractColorsFromTitle("")).toEqual([]);
  });

  it("insensible à la casse (les accents sont préservés à l'affichage)", () => {
    expect(extractColorsFromTitle("Dynafit Radical /NOIR")).toEqual(["Noir"]);
    expect(extractColorsFromTitle("Dynafit Radical /Crème")).toEqual(["Crème"]);
    expect(extractColorsFromTitle("Dynafit Radical /CRÈME")).toEqual(["Crème"]);
  });
});

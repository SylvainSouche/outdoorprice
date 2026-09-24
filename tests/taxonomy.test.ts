import { describe, it, expect } from "vitest";
import { classifyTaxonomy } from "@/lib/scraper/taxonomy";

describe("classifyTaxonomy", () => {
  it("détecte le ski de randonnée", () => {
    const r = classifyTaxonomy("Ski de rando", "Skis");
    expect(r.sport).toBe("Ski de randonnée");
    expect(r.category).toBe("Skis");
  });

  it("détecte l'alpinisme", () => {
    const r = classifyTaxonomy("Alpinisme / mountaineering");
    expect(r.sport).toBe("Alpinisme");
  });

  it("détecte l'escalade", () => {
    const r = classifyTaxonomy("Escalade falaise");
    expect(r.sport).toBe("Escalade");
  });

  it("détecte le trail", () => {
    const r = classifyTaxonomy("Trail running");
    expect(r.sport).toBe("Trail & running");
  });

  it("détecte les catégories d'équipement", () => {
    expect(classifyTaxonomy("Skis").category).toBe("Skis");
    expect(classifyTaxonomy("Chaussures").category).toBe("Chaussures");
    expect(classifyTaxonomy("Fixations").category).toBe("Fixations");
    expect(classifyTaxonomy("Peaux de ski").category).toBe("Peaux de ski");
    expect(classifyTaxonomy("Crampons").category).toBe("Crampons");
    expect(classifyTaxonomy("Casque").category).toBe("Casques");
    expect(classifyTaxonomy("Vestes").category).toBe("Vestes");
  });

  it("détecte la gamme", () => {
    expect(classifyTaxonomy("Ski competition race").range).toBe("Compétition");
    expect(classifyTaxonomy("Ski loisir débutant").range).toBe("Loisir");
    expect(classifyTaxonomy("Ski ultra light").range).toBe("Ultralight");
  });

  it("retourne un objet vide pour les entrées vides", () => {
    expect(classifyTaxonomy()).toEqual({});
    expect(classifyTaxonomy("")).toEqual({});
    expect(classifyTaxonomy(undefined, undefined)).toEqual({});
  });

  it("est insensible à la casse et aux accents", () => {
    const r = classifyTaxonomy("SKI DE RANDO");
    expect(r.sport).toBe("Ski de randonnée");
  });
});

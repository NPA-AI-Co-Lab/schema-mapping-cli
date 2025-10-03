import path from "path";
import { existsSync, readFileSync } from "fs";
import { basePath } from "../utils/index.js";
import { JsonLdProperty } from "./types.js";
import { TaxonomyEntry } from "./types.js";

const TAXONOMY_FOLDER = path.resolve(basePath, "taxonomies");


const taxonomyCache: Record<string, TaxonomyEntry[]> = {};

/**
 * Load taxonomy data from file with caching
 */
export function getTaxonomy(name: string): TaxonomyEntry[] {
  if (taxonomyCache[name]) return taxonomyCache[name];

  const filePath = path.join(TAXONOMY_FOLDER, `${name}.json`);
  if (!existsSync(filePath)) {
    console.log(`⚠️ Taxonomy file not found: ${filePath}`);
    return [];
  }

  const data: TaxonomyEntry[] = JSON.parse(readFileSync(filePath, "utf-8"));
  taxonomyCache[name] = data;
  return data;
}

/**
 * Handle taxonomy enumeration for properties
 */
export function handleTaxonomyEnum(prop: JsonLdProperty): (string | null)[] | undefined {
  if (prop.enumFromTaxonomy) {
    const taxonomy = getTaxonomy(prop.enumFromTaxonomy);
    if (!taxonomy) {
      throw new Error(`Unknown taxonomy: ${prop.enumFromTaxonomy}`);
    }
    const values: (string | null)[] = taxonomy.map((t) => t.value);
    if (Array.isArray(prop.type) && prop.type.includes("null")) {
      values.push(null);
    }
    return values;
  }
  return undefined;
}

/**
 * Clear taxonomy cache (useful for testing)
 */
export function clearTaxonomyCache(): void {
  Object.keys(taxonomyCache).forEach(key => delete taxonomyCache[key]);
}

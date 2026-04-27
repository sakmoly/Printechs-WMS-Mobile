import { storeCodesMatchForTO, compactStoreCodeKey } from "./box-id";

export type ToStoreMasterResolution = {
  /** Store string to persist on TO lines (master spelling when matched). */
  storeToPersist: string;
  /** True when we rewrote TO store to match warehouse master (typo / hyphen / case). */
  normalized: boolean;
  /** True when master is loaded but no row matches (possible TO data entry error). */
  unknownInMaster: boolean;
  /** Nearby master codes for user hints (subset). */
  suggestions: string[];
};

type MasterRow = { code?: string | null };

/**
 * Aligns a Transfer Order store string with Warehouses & Stores master (`code`).
 * When master is empty, returns the trimmed TO value (offline / no master yet).
 */
export function canonicalStoreForToLine(
  rawStore: string | null | undefined,
  masterList: MasterRow[] | null | undefined
): ToStoreMasterResolution {
  const raw = String(rawStore ?? "").trim();
  if (!raw) {
    return {
      storeToPersist: "",
      normalized: false,
      unknownInMaster: false,
      suggestions: [],
    };
  }

  const masters = (masterList || []).filter((m) => String(m.code ?? "").trim());
  if (masters.length === 0) {
    return {
      storeToPersist: raw,
      normalized: false,
      unknownInMaster: false,
      suggestions: [],
    };
  }

  const rawUp = raw.toUpperCase();
  for (const m of masters) {
    const c = String(m.code).trim();
    if (c.toUpperCase() === rawUp) {
      return {
        storeToPersist: c,
        normalized: c !== raw,
        unknownInMaster: false,
        suggestions: [],
      };
    }
  }

  const fuzzy = masters.filter((m) => storeCodesMatchForTO(m.code, raw));
  if (fuzzy.length === 1) {
    const c = String(fuzzy[0].code).trim();
    return {
      storeToPersist: c,
      normalized: true,
      unknownInMaster: false,
      suggestions: [],
    };
  }
  if (fuzzy.length > 1) {
    return {
      storeToPersist: raw,
      normalized: false,
      unknownInMaster: true,
      suggestions: fuzzy.map((m) => String(m.code).trim()).slice(0, 8),
    };
  }

  const cr = compactStoreCodeKey(raw);
  const suggestions = masters
    .map((m) => String(m.code).trim())
    .filter((c) => {
      const cm = compactStoreCodeKey(c);
      return Boolean(cr && cm && (cm.includes(cr) || cr.includes(cm)));
    })
    .slice(0, 8);

  return {
    storeToPersist: raw,
    normalized: false,
    unknownInMaster: true,
    suggestions,
  };
}

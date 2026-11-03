// Riparazione delle parti che non rispettano lo schema alla lettera.
//
// Con l'output strutturato non serve quasi mai. Senza (formato chiesto nel prompt) il
// modello può saltare un campo o scriverlo in un altro tipo: invece di scartare una
// bozza intera per un «allineamento» mancante, si riempiono i buchi seguendo lo schema
// JSON e si riprova la validazione con zod.

import { ParteSchema, type Parte } from "../shared/schema";
import { SCHEMA_RISPOSTA } from "./formato";

export interface Schema {
  type?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  enum?: unknown[];
  const?: unknown;
}

const SCHEMA_PARTE = (SCHEMA_RISPOSTA as { properties: { parti: { items: Schema } } }).properties.parti.items;

/** Valori neutri per un enum sbagliato: meglio «da verificare» che un «in linea» inventato. */
const ENUM_PRUDENTI = ["da_verificare", "da_chiarire", "attenzione", "nessuno", "normale", "bordo", "sinistra", "secondario", "invia"];

const oggetto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function ripara(s: Schema, v: unknown, chiave = "", tipoDocumento = ""): unknown {
  if (s.anyOf) {
    // Unione con discriminante «tipo» (le parti della risposta): si ripara solo il ramo giusto.
    if (s.anyOf.some((r) => r.properties?.tipo?.const !== undefined)) {
      const ramo = s.anyOf.find((r) => oggetto(v) && r.properties?.tipo?.const === v.tipo);
      return ramo ? ripara(ramo, v, chiave, tipoDocumento) : undefined;
    }
    // Campo che può essere null (es. un importo non scritto nel documento).
    if ((v === null || v === undefined) && s.anyOf.some((r) => r.type === "null")) return null;
    return ripara(s.anyOf.find((r) => r.type !== "null") ?? s.anyOf[0], v, chiave, tipoDocumento);
  }
  if (s.const !== undefined) return s.const;
  if (s.enum) {
    if (s.enum.includes(v)) return v;
    if (chiave === "tipo_documento" && s.enum.includes(tipoDocumento)) return tipoDocumento;
    return ENUM_PRUDENTI.find((e) => s.enum!.includes(e)) ?? s.enum[0];
  }
  switch (s.type) {
    case "string":
      return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
    case "number":
    case "integer": {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
      let x = Number.isFinite(n) ? n : 0;
      if (s.type === "integer") x = Math.round(x);
      if (chiave === "colonne" && (x < 2 || x > 3)) x = 2;
      return x;
    }
    case "boolean":
      return typeof v === "boolean" ? v : v === "true";
    case "array":
      return Array.isArray(v) && s.items
        ? v.map((x) => ripara(s.items!, x, chiave, tipoDocumento)).filter((x) => x !== undefined)
        : [];
    case "object": {
      const o = oggetto(v) ? v : {};
      return Object.fromEntries(
        Object.entries(s.properties ?? {}).map(([k, ps]) => [k, ripara(ps, o[k], k, tipoDocumento)]),
      );
    }
  }
  return v;
}

/**
 * La parte così com'è se è valida, altrimenti riparata. null se non si può salvare,
 * per esempio un tipo di parte sconosciuto. Ogni intervento finisce nei log del server.
 */
export function parteValida(p: unknown, tipoDocumento: string): Parte | null {
  const esatta = ParteSchema.safeParse(p);
  if (esatta.success) return esatta.data;
  const tipo = oggetto(p) ? String(p.tipo) : typeof p;
  const problemi = esatta.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(radice)"}: ${i.message}`)
    .join("; ");
  const riparata = ParteSchema.safeParse(ripara(SCHEMA_PARTE, p, "", tipoDocumento));
  if (riparata.success) {
    console.warn(`Parte «${tipo}» riparata. ${problemi}`);
    return riparata.data;
  }
  console.warn(`Parte «${tipo}» scartata. ${problemi}`);
  return null;
}

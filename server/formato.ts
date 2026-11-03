// Schema della risposta per l'output strutturato dell'API Claude.
//
// Non usa il convertitore dell'SDK (betaZodOutputFormat): quello sposta `const` ed `enum`
// nella descrizione, così i rami di `parti` («testo», «documento»…) diventano
// indistinguibili e la grammatica compilata supera il limite dell'API. Qui lo schema
// esce da zod così com'è, tolte solo le parole chiave che l'API non supporta.

import * as z from "zod";
import { RispostaSchema } from "../shared/schema";

const CHIAVI_SUPPORTATE = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "anyOf",
  "allOf",
  "enum",
  "const",
  "description",
  "$ref",
  "$defs",
]);

export function perApi(nodo: unknown): unknown {
  if (Array.isArray(nodo)) return nodo.map(perApi);
  if (nodo === null || typeof nodo !== "object") return nodo;
  const fuori: Record<string, unknown> = {};
  for (const [chiave, valore] of Object.entries(nodo)) {
    if (chiave === "properties" || chiave === "$defs") {
      fuori[chiave] = Object.fromEntries(
        Object.entries(valore as Record<string, unknown>).map(([nome, schema]) => [nome, perApi(schema)]),
      );
    } else if (chiave === "oneOf") {
      fuori.anyOf = perApi(valore);
    } else if (CHIAVI_SUPPORTATE.has(chiave)) {
      // Restano fuori minimum/maximum degli interi, $schema e gli altri vincoli non supportati.
      fuori[chiave] = perApi(valore);
    }
  }
  if (fuori.type === "object") fuori.additionalProperties = false;
  return fuori;
}

/** Lo schema JSON di un oggetto zod, nella forma accettata dall'output strutturato dell'API. */
export function schemaPerApi(schema: z.ZodType): Record<string, unknown> {
  return perApi(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export const SCHEMA_RISPOSTA = schemaPerApi(RispostaSchema);

export const FORMATO_RISPOSTA = { type: "json_schema" as const, schema: SCHEMA_RISPOSTA };

/** Per quando l'API rifiuta lo schema: lo stesso formato chiesto a parole, controllato poi con zod. */
export const ISTRUZIONI_FORMATO = [
  "",
  "# Formato della risposta",
  "Rispondi sempre e solo con un oggetto JSON valido conforme a questo JSON Schema: nessun testo prima o dopo, nessun blocco di codice.",
  "Ogni proprietà è obbligatoria, anche dentro i documenti: quando non serve scrivi \"\", [] o false, non ometterla.",
  JSON.stringify(SCHEMA_RISPOSTA),
].join("\n");

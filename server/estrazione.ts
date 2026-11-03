// Chiamata a Claude per estrarre dati strutturati da un documento di progetto.
// Output strutturato con uno schema piccolo e dedicato; se l'API lo rifiutasse, lo stesso
// formato chiesto nel prompt, poi riparato e controllato con zod come nella chat.

import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type * as z from "zod";
import { schemaPerApi } from "./formato";
import { anthropic, daGraffa, schemaRifiutato } from "./redattore";
import { ripara, type Schema } from "./riparazione";
import { aggiungiChiamata, type Consumo } from "./utilizzo";

export const MODELLO_DOCUMENTI = process.env.REDATTORE_MODELLO ?? "claude-opus-5-5";
/** Tabelle lunghe (computo, cronoprogramma): un modello più economico basta. */
export const MODELLO_TABELLE = process.env.REDATTORE_MODELLO_TABELLE ?? "claude-sonnet-5-5";

export class EstrazioneRifiutata extends Error {}

let formatoStrutturato = process.env.REDATTORE_FORMATO !== "prompt";

export async function estraiStrutturato<T>(o: {
  modello: string;
  sforzo: "low" | "medium" | "high";
  sistema: string;
  contenuti: BetaContentBlockParam[];
  schema: z.ZodType<T>;
  maxToken: number;
  consumo: Consumo;
}): Promise<T> {
  const schemaApi = schemaPerApi(o.schema);
  const istruzioniFormato = `\n\n# Formato\nRispondi solo con un oggetto JSON conforme a questo JSON Schema, senza testo prima o dopo. Ogni proprietà è obbligatoria: quando un dato manca usa "", [], null o la certezza «assente».\n${JSON.stringify(schemaApi)}`;

  for (let tentativo = 0; tentativo < 2; tentativo++) {
    try {
      const stream = anthropic().beta.messages.stream({
        model: o.modello,
        max_tokens: o.maxToken,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: formatoStrutturato
          ? { effort: o.sforzo, format: { type: "json_schema", schema: schemaApi } }
          : { effort: o.sforzo },
        system: formatoStrutturato ? o.sistema : o.sistema + istruzioniFormato,
        messages: [{ role: "user", content: o.contenuti }],
      });
      const finale = await stream.finalMessage();
      aggiungiChiamata(o.consumo, finale);
      if (finale.stop_reason === "refusal") {
        throw new EstrazioneRifiutata("Il documento non è stato letto: la richiesta è stata rifiutata dai filtri di sicurezza.");
      }
      if (finale.stop_reason === "max_tokens") {
        throw new Error("Il documento è troppo lungo da leggere in una volta: dividilo in parti più piccole.");
      }
      const testo = finale.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
      const daInizio = daGraffa(testo);
      const json = JSON.parse(daInizio.slice(0, daInizio.lastIndexOf("}") + 1)) as unknown;
      const esatto = o.schema.safeParse(json);
      if (esatto.success) return esatto.data;
      const riparato = o.schema.safeParse(ripara(schemaApi as Schema, json));
      if (riparato.success) {
        console.warn("Estrazione riparata:", esatto.error.issues.slice(0, 3).map((i) => i.path.join(".")).join("; "));
        return riparato.data;
      }
      throw new Error("La lettura non ha prodotto dati leggibili. Riprova.");
    } catch (e) {
      if (formatoStrutturato && schemaRifiutato(e)) {
        console.warn("L'API ha rifiutato lo schema di estrazione: passo al formato chiesto nel prompt.", e);
        formatoStrutturato = false;
        continue;
      }
      throw e;
    }
  }
  throw new Error("Lettura non riuscita.");
}

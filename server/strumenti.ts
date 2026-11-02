// Strumenti di calcolo che il modello chiama prima di scrivere numeri in un documento.

import * as z from "zod";
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { calcolaMisure, calcolaSal, formatEuro, formatNumero } from "../shared/numeri";

const MisureInput = z.object({
  righe: z.array(
    z.object({
      descrizione: z.string().describe("Es. «Campata A»"),
      fattori: z.array(z.number()).describe("Dimensioni da moltiplicare, in unità coerenti"),
      deduzione: z.boolean().describe("true se la quantità va dedotta"),
    }),
  ),
});

const SalInput = z.object({
  voci: z.array(
    z.object({
      tariffa: z.string(),
      descrizione: z.string(),
      um: z.string(),
      quantita: z.number().describe("Quantità progressiva dal libretto delle misure"),
      prezzo: z.number().describe("Prezzo unitario dall'elenco prezzi contrattuale"),
    }),
  ),
  ribasso_percentuale: z.number().describe("Es. 12.35 per 12,350%"),
  oneri_sicurezza: z.number().describe("Oneri della sicurezza maturati, non soggetti a ribasso"),
  ritenuta_percentuale: z.number().describe("Es. 0.5"),
  acconti_precedenti: z.number().describe("Somma degli acconti già certificati"),
  recupero_anticipazione: z
    .number()
    .nullable()
    .describe("Importo da recuperare in questo SAL; null se non noto o non dovuto"),
});

interface Strumento<S extends z.ZodType> {
  schema: S;
  definizione: BetaTool;
  esegui: (input: z.infer<S>) => unknown;
}

function strumento<S extends z.ZodObject>(
  name: string,
  description: string,
  schema: S,
  esegui: (input: z.infer<S>) => unknown,
): Strumento<S> {
  return {
    schema,
    esegui,
    definizione: {
      name,
      description,
      input_schema: z.toJSONSchema(schema) as BetaTool["input_schema"],
      // Le richieste sono in streaming: l'input arriva subito e lo validiamo noi con zod.
      eager_input_streaming: true,
    },
  };
}

export const STRUMENTI = {
  calcola_misure: strumento(
    "calcola_misure",
    "Calcola le quantità delle righe di un libretto delle misure (prodotto delle dimensioni, arrotondato al centesimo) e il totale con le deduzioni. Usalo ogni volta che devi scrivere una quantità misurata.",
    MisureInput,
    (input) => {
      const { righe, totale } = calcolaMisure(input.righe);
      return {
        righe: righe.map((r) => ({
          descrizione: r.descrizione,
          dimensioni: r.fattori.map((f) => formatNumero(f)).join(" × "),
          quantita: (r.deduzione ? "−" : "") + formatNumero(r.quantita),
        })),
        totale: formatNumero(totale),
      };
    },
  ),
  calcola_sal: strumento(
    "calcola_sal",
    "Calcola gli importi di uno stato di avanzamento lavori: importo di ogni voce, importo lavori, ribasso d'asta, netto, oneri della sicurezza, ritenuta, acconti precedenti, recupero anticipazione e importo dell'acconto. Usalo prima di scrivere un SAL e riporta i valori esattamente come restituiti.",
    SalInput,
    (input) => {
      const r = calcolaSal({
        voci: input.voci,
        ribassoPercentuale: input.ribasso_percentuale,
        oneriSicurezza: input.oneri_sicurezza,
        ritenutaPercentuale: input.ritenuta_percentuale,
        accontiPrecedenti: input.acconti_precedenti,
        recuperoAnticipazione: input.recupero_anticipazione,
      });
      return {
        voci: r.voci.map((v) => ({
          tariffa: v.tariffa,
          quantita: formatNumero(v.quantita),
          prezzo: formatNumero(v.prezzo),
          importo: formatNumero(v.importo),
        })),
        importo_lavori: formatEuro(r.importoLavori),
        ribasso: formatEuro(r.ribasso),
        netto_lavori: formatEuro(r.nettoLavori),
        oneri_sicurezza: formatEuro(r.oneriSicurezza),
        totale_progressivo: formatEuro(r.totale),
        ritenuta: formatEuro(r.ritenuta),
        acconti_precedenti: formatEuro(r.accontiPrecedenti),
        recupero_anticipazione:
          r.recuperoAnticipazione === null ? "non indicato" : formatEuro(r.recuperoAnticipazione),
        importo_acconto: formatEuro(r.acconto),
        nota:
          r.recuperoAnticipazione === null
            ? "Acconto calcolato senza recupero dell'anticipazione: segnalalo come dato da verificare."
            : "",
      };
    },
  ),
};

export const DEFINIZIONI_STRUMENTI: BetaTool[] = Object.values(STRUMENTI).map((s) => s.definizione);

export type EsitoStrumento = { contenuto: string; errore: boolean };

export function eseguiStrumento(nome: string, input: unknown): EsitoStrumento {
  const s = STRUMENTI[nome as keyof typeof STRUMENTI] as Strumento<z.ZodType> | undefined;
  if (!s) return { contenuto: `Strumento sconosciuto: ${nome}`, errore: true };
  const verificato = s.schema.safeParse(input);
  if (!verificato.success) {
    // Con eager_input_streaming l'input non è validato dall'API: lo rimandiamo indietro.
    return {
      contenuto: JSON.stringify({ INVALID_JSON: JSON.stringify(input), errori: verificato.error.issues }),
      errore: true,
    };
  }
  return { contenuto: JSON.stringify(s.esegui(verificato.data)), errore: false };
}

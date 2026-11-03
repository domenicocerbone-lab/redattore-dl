// Strumenti che il modello chiama: calcoli prima di scrivere numeri in un documento, e
// consultazione di computo e cronoprogramma del cantiere (troppo lunghi per il prompt).

import * as z from "zod";
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { avanzamentoAtteso, dataItaliana } from "../shared/nowvision";
import { calcolaMisure, calcolaSal, formatEuro, formatNumero } from "../shared/numeri";
import { scheda } from "./cantieri";
import { datiNowVision } from "./nowvision";

/** Ciò che uno strumento sa della conversazione in cui viene chiamato. */
export interface ContestoStrumento {
  cantiereId: string;
}

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
  esegui: (input: z.infer<S>, contesto: ContestoStrumento) => unknown;
}

function strumento<S extends z.ZodObject>(
  name: string,
  description: string,
  schema: S,
  esegui: (input: z.infer<S>, contesto: ContestoStrumento) => unknown,
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

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const taglia = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const MASSIMO_RIGHE = 60;

/** Le voci o attività della zona: quelle collegate nella scheda, più quelle con la zona scritta nel file. */
function inZona(cantiereId: string, zona: string, tipo: "vociComputo" | "attivita") {
  const z = scheda(cantiereId)?.zone.find((x) => x.id === zona || norm(x.nome) === norm(zona));
  const collegati = new Set(z?.[tipo] ?? []);
  const nome = norm(z?.nome ?? zona);
  return (x: { wbs: string; zone: string[] }) => collegati.has(x.wbs) || x.zone.some((y) => norm(y) === nome);
}

const ConsultaComputoInput = z.object({
  zona: z.string().optional().describe("Nome della zona della scheda del cantiere, es. «Corpo scala B»."),
  cerca: z.string().optional().describe("Parole da cercare nella descrizione, es. «massetto»."),
  codice: z.string().optional().describe("Codice WBS o inizio del codice, es. «3.2»."),
});

const ConsultaProgrammaInput = z.object({
  zona: z.string().optional().describe("Nome della zona della scheda del cantiere."),
  data: z.string().optional().describe("AAAA-MM-GG: solo le attività previste in corso a quella data."),
  cerca: z.string().optional().describe("Parole da cercare nella descrizione."),
});

export const STRUMENTI = {
  consulta_computo: strumento(
    "consulta_computo",
    "Cerca nel computo metrico del cantiere le voci di una zona, con certe parole nella descrizione o con un codice. Restituisce codice, descrizione, unità, quantità, prezzo, importo, zone e misurato dall'IA NowVision. Usalo prima di citare voci, quantità o importi del computo.",
    ConsultaComputoInput,
    async (input, { cantiereId }) => {
      const nv = await datiNowVision(cantiereId);
      if (!nv.computo) return { esito: "Per questo cantiere il computo non è stato caricato." };
      let voci = nv.computo.voci;
      if (input.zona) voci = voci.filter(inZona(cantiereId, input.zona, "vociComputo"));
      if (input.codice) voci = voci.filter((v) => v.wbs.toLowerCase().startsWith(input.codice!.toLowerCase()));
      if (input.cerca) {
        const parole = norm(input.cerca).split(" ").filter(Boolean);
        voci = voci.filter((v) => parole.every((p) => norm(v.descrizione).includes(p)));
      }
      return {
        trovate: voci.length,
        voci: voci.slice(0, MASSIMO_RIGHE).map((v) => ({
          codice: v.wbs,
          descrizione: taglia(v.descrizione, 220),
          unita: v.unita,
          quantita: v.quantita === null ? "—" : formatNumero(v.quantita),
          prezzo: v.prezzo === null ? "—" : formatEuro(v.prezzo),
          importo: v.importo === null ? "—" : formatEuro(v.importo),
          zone: v.zone.join(", "),
          misurato_ia: v.misuratoIA ? `${formatNumero(v.misuratoIA.quantita)} (${formatNumero(v.misuratoIA.percentuale)}%)` : "—",
        })),
        nota: voci.length > MASSIMO_RIGHE ? `Mostrate le prime ${MASSIMO_RIGHE}: restringi con zona, codice o parole.` : "",
      };
    },
  ),
  consulta_programma: strumento(
    "consulta_programma",
    "Cerca nel cronoprogramma del cantiere le attività di una zona, in corso a una data o con certe parole. Restituisce codice, descrizione, zone, date previste ed effettive, avanzamento registrato e atteso alla data. Usalo prima di citare date o avanzamenti del programma.",
    ConsultaProgrammaInput,
    async (input, { cantiereId }) => {
      const nv = await datiNowVision(cantiereId);
      if (!nv.programma) return { esito: "Per questo cantiere il cronoprogramma non è stato caricato." };
      let attivita = nv.programma.attivita;
      if (input.zona) attivita = attivita.filter(inZona(cantiereId, input.zona, "attivita"));
      const data = input.data && /^\d{4}-\d{2}-\d{2}$/.test(input.data) ? input.data : null;
      if (data) {
        attivita = attivita.filter((a) => (!a.inizioPrevisto || a.inizioPrevisto <= data) && (!a.finePrevista || a.finePrevista >= data));
      }
      if (input.cerca) {
        const parole = norm(input.cerca).split(" ").filter(Boolean);
        attivita = attivita.filter((a) => parole.every((p) => norm(a.descrizione).includes(p)));
      }
      const percento = (n: number | null) => (n === null ? "—" : `${formatNumero(n * 100, 0)}%`);
      return {
        trovate: attivita.length,
        attivita: attivita.slice(0, MASSIMO_RIGHE).map((a) => ({
          codice: a.wbs,
          descrizione: taglia(a.descrizione, 200),
          zone: a.zone.join(", "),
          previsto: `${dataItaliana(a.inizioPrevisto)} → ${dataItaliana(a.finePrevista)}`,
          effettivo: a.inizioEffettivo || a.fineEffettiva ? `${dataItaliana(a.inizioEffettivo)} → ${dataItaliana(a.fineEffettiva)}` : "non registrato",
          avanzamento_registrato: percento(a.avanzamento),
          ...(data ? { avanzamento_atteso_alla_data: percento(avanzamentoAtteso(a, data)) } : {}),
        })),
        nota: attivita.length > MASSIMO_RIGHE ? `Mostrate le prime ${MASSIMO_RIGHE}: restringi con zona, data o parole.` : "",
      };
    },
  ),

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

export async function eseguiStrumento(nome: string, input: unknown, contesto: ContestoStrumento): Promise<EsitoStrumento> {
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
  try {
    return { contenuto: JSON.stringify(await s.esegui(verificato.data, contesto)), errore: false };
  } catch (e) {
    return { contenuto: `Errore dello strumento: ${(e as Error).message}`, errore: true };
  }
}

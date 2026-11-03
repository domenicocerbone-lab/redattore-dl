// Forma della risposta del Redattore (output strutturato dell'API Claude) e dei
// dati che client e server si scambiano. Le descrizioni finiscono nello schema
// JSON inviato al modello: sono istruzioni, scriverle con cura.

import * as z from "zod";
import { ID_TIPI } from "./documenti";

const TipoDocumentoId = z.enum(ID_TIPI).describe("Tipo di documento dal catalogo");

// ---------------------------------------------------------------------------
// Documento

export const BloccoSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("paragrafo"),
    testo: z
      .string()
      .describe("Testo in registro amministrativo. **grassetto** ammesso. «[da completare]» per un dato mancante."),
  }),
  z.object({
    tipo: z.literal("elenco"),
    numerato: z.boolean(),
    voci: z.array(z.string()),
  }),
  z.object({
    tipo: z.literal("tabella"),
    intestazione: z
      .array(z.string())
      .describe("Titoli delle colonne. [] per una tabella senza intestazione, come l'elenco dei presenti."),
    allineamento: z
      .array(z.enum(["sinistra", "destra"]))
      .describe("Uno per colonna: «destra» per quantità, prezzi e importi."),
    righe: z
      .array(z.array(z.string()))
      .describe("Celle già formattate (1.234,56). Una cella che inizia con «!» è evidenziata come fuori norma o urgente."),
    totale: z
      .array(z.string())
      .describe("Riga di totale in grassetto, una cella per colonna: le celle vuote dopo la prima si uniscono a lei. [] se non serve."),
  }),
  z.object({
    tipo: z.literal("riepilogo"),
    righe: z.array(
      z.object({
        etichetta: z.string(),
        valore: z.string(),
        stile: z
          .enum(["normale", "totale", "attenzione", "finale"])
          .describe("totale: in grassetto; attenzione: dato da verificare; finale: l'importo conclusivo, evidenziato."),
      }),
    ),
    nota: z.string().describe("Nota in piccolo sotto il riepilogo; stringa vuota se non serve."),
  }),
  z.object({
    tipo: z.literal("campi"),
    colonne: z.number().int().describe("2 o 3"),
    campi: z.array(z.object({ etichetta: z.string(), valore: z.string() })),
    da_compilare: z
      .boolean()
      .describe("true per un riquadro tratteggiato ancora da compilare, es. la verifica di chiusura di una NC."),
  }),
]);

export const DocumentoSchema = z.object({
  tipo_documento: TipoDocumentoId,
  titolo: z.string().describe("Titolo completo, con numero se il documento è numerato: «Verbale di sopralluogo n. 7»."),
  sottotitolo: z
    .string()
    .describe("Data, ora e luogo o periodo di riferimento: «27/10/2026, ore 10:00 · Cantiere, corpo B». Vuoto se non serve."),
  intestazione: z
    .object({
      sinistra: z.string().describe("Ente o Direzione Lavori, es. «Comune di Esempio · Settore Lavori Pubblici»."),
      destra: z.string().describe("Ufficio, indirizzo o riferimento normativo."),
    })
    .describe("Riga piccola in cima al documento."),
  stati: z
    .array(z.object({ testo: z.string(), stile: z.enum(["pieno", "bordo"]) }))
    .describe("Bollini di stato accanto al titolo, es. per una NC «Aperta» (pieno) e «Maggiore» (bordo). [] se non servono."),
  dati_generali: z.object({
    colonne: z.number().int().describe("2 o 3"),
    campi: z.array(
      z.object({
        etichetta: z.string(),
        valore: z.string(),
        intera_riga: z.boolean().describe("true per un campo lungo che occupa tutta la riga, come «Lavori»."),
      }),
    ),
  }),
  sezioni: z.array(
    z.object({
      titolo: z.string().describe("Titolo breve della sezione, es. «Condizioni meteo» o «1 · Identificazione»."),
      blocchi: z.array(BloccoSchema),
    }),
  ),
  formula_chiusura: z.string().describe("Es. «Letto, confermato e sottoscritto.»; vuota se il documento non la prevede."),
  firme: z.array(z.object({ ruolo: z.string(), nome: z.string() })),
});

// ---------------------------------------------------------------------------
// Parti della risposta in chat

export const ParteSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("testo"),
    testo: z
      .string()
      .describe("Testo in chat, breve e concreto. Paragrafi separati da riga vuota; elenchi con «1.» o «-»; **grassetto** ammesso."),
  }),
  z.object({
    tipo: z.literal("dati_raccolti"),
    campi: z
      .array(
        z.object({
          nome: z.string(),
          valore: z.string().describe("Sintesi del dato raccolto; vuota se manca."),
          stato: z.enum(["ok", "manca", "da_chiarire", "facoltativo"]),
        }),
      )
      .describe("Tutti i campi del tipo di documento, nell'ordine del catalogo, con lo stato attuale."),
  }),
  z.object({
    tipo: z.literal("foto_osservate"),
    osservazioni: z.array(
      z.object({
        foto: z.array(z.string()).describe("Etichette delle foto, es. [\"F1\", \"F2\"]."),
        descrizione: z.string().describe("Solo ciò che si vede. Se è un'ipotesi, dillo («sembra», «da verificare»)."),
        attenzione: z.boolean().describe("true per un problema di qualità o di sicurezza."),
        etichetta: z.string().describe("Una o due parole mostrate sulla foto quando attenzione è true, es. «Ristagni». Vuota altrimenti."),
      }),
    ),
  }),
  z.object({
    tipo: z.literal("proposte_bozze"),
    proposte: z.array(
      z.object({
        tipo_documento: TipoDocumentoId,
        titolo: z.string().describe("Nome del documento come lo legge il DL, es. «Giornale dei lavori»."),
        badge: z.enum(["consigliata", "da_confermare", "sicurezza", "nessuno"]),
        foto: z.string().describe("Foto di riferimento, es. «F1–F4»."),
        sintesi: z.string().describe("Una frase: cosa ricavi dalle foto e cosa manca."),
        campi_compilati: z.number().int(),
        campi_obbligatori: z.number().int(),
        messaggio: z.string().describe("Messaggio inviato a nome del DL quando sceglie questa proposta."),
      }),
    ),
  }),
  z.object({
    tipo: z.literal("confronto_programma"),
    data_riferimento: z.string().describe("Data delle riprese usata per il confronto, gg/mm/aaaa."),
    righe: z
      .array(
        z.object({
          wbs: z.string().describe("Codice dell'attività del cronoprogramma, es. «3.0»."),
          attivita: z.string(),
          previsto: z.string().describe("Date previste e avanzamento atteso alla data di riferimento, dal riepilogo NowVision."),
          registrato: z
            .string()
            .describe("Avanzamento misurato dall'IA NowVision sulle voci di computo collegate (fonte principale); date effettive del cronoprogramma solo se registrate."),
          osservato: z.string().describe("Cosa si vede nelle riprese, con le etichette delle foto. Solo indicazioni qualitative."),
          voci_computo: z.array(z.string()).describe("Codici delle voci di computo collegate, es. [\"Articolo 20 a\"]."),
          esito: z
            .enum(["in_linea", "concluso", "in_anticipo", "in_ritardo", "non_visibile", "da_verificare"])
            .describe("in_ritardo solo con prova visiva (es. lavorazione ancora in corso dopo la fine prevista); un'attività che non si vede è non_visibile."),
        }),
      )
      .describe("Le attività pertinenti alle zone riprese o previste in corso alla data di riferimento."),
  }),
  z.object({
    tipo: z.literal("controlli"),
    titolo: z.string().describe("Es. «Controlli sui calcoli»."),
    voci: z.array(z.object({ testo: z.string(), esito: z.enum(["ok", "attenzione"]) })),
  }),
  z.object({
    tipo: z.literal("da_decidere"),
    titolo: z.string().describe("Es. «Due cose da decidere»."),
    punti: z.array(z.string()).describe("Domande chiuse a cui il DL risponde in una riga."),
  }),
  z.object({
    tipo: z.literal("righe_misura"),
    unita: z.string().describe("Unità del totale, es. «m²»."),
    righe: z.array(
      z.object({
        descrizione: z.string().describe("Es. «Campata A». Le dimensioni le aggiunge l'interfaccia."),
        fattori: z.array(z.number()).describe("Dimensioni da moltiplicare, es. [8.4, 6.2]."),
        deduzione: z.boolean().describe("true per una parte da dedurre, es. un vano scala."),
      }),
    ),
  }),
  z.object({
    tipo: z.literal("documento"),
    documento: DocumentoSchema,
  }),
  z.object({
    tipo: z.literal("azioni"),
    azioni: z.array(
      z.object({
        testo: z.string().describe("Etichetta del pulsante, es. «Genera bozza →»."),
        messaggio: z.string().describe("Con modo «invia», testo inviato a nome del DL; con «scrivi», testo precompilato nel campo di scrittura."),
        stile: z
          .enum(["primario", "secondario", "suggerimento"])
          .describe("Al massimo un primario. «suggerimento» per scorciatoie secondarie."),
        modo: z.enum(["invia", "scrivi"]),
      }),
    ),
  }),
]);

export const RispostaSchema = z.object({
  parti: z.array(ParteSchema).describe("La risposta, nell'ordine in cui il DL la legge."),
  titolo_conversazione: z
    .string()
    .describe("Titolo breve per la cronologia (max 40 caratteri), es. «NC tamponature piano 2». Vuoto per lasciarlo invariato."),
});

export type Blocco = z.infer<typeof BloccoSchema>;
export type Documento = z.infer<typeof DocumentoSchema>;
export type Parte = z.infer<typeof ParteSchema>;
export type Risposta = z.infer<typeof RispostaSchema>;
export type TipoParte = Parte["tipo"];
export type ParteDi<T extends TipoParte> = Extract<Parte, { tipo: T }>;

/** Durante lo streaming le parti arrivano incomplete: ogni campo può mancare. */
export type Parziale<T> = T extends string | number | boolean
  ? T
  : T extends Array<infer U>
    ? Array<Parziale<U>>
    : T extends object
      ? { [K in keyof T]?: Parziale<T[K]> }
      : T;

// ---------------------------------------------------------------------------
// Conversazioni

export interface RifDocumento {
  id: string;
  versione: number;
}

/** Parte salvata: a un documento il server aggiunge id e versione. */
export type ParteUI = Parte & { rif?: RifDocumento };

export interface FotoAllegata {
  id: string;
  /** F1, F2… numerate nella conversazione. */
  etichetta: string;
  /** Ora di scatto «09:12», se nota. */
  ora: string;
  nome: string;
  url: string;
  /** Presente se la foto è una ripresa 360° presa da NowVision. */
  ripresa?: { zona: string; data: string };
}

/** Documento di progetto allegato in chat durante la revisione della scheda. */
export interface AllegatoProgetto {
  id: string;
  nome: string;
  tipo: string;
}

export interface MessaggioUtente {
  id: string;
  ruolo: "utente";
  testo: string;
  foto: FotoAllegata[];
  allegati?: AllegatoProgetto[];
  dettato?: { secondi: number };
  creatoIl: string;
}

export interface MessaggioAssistente {
  id: string;
  ruolo: "assistente";
  parti: ParteUI[];
  creatoIl: string;
  feedback?: "utile" | "da_migliorare";
  errore?: string;
  /** Modifiche alla scheda del cantiere fatte dal Redattore in questo turno, in parole. */
  modificheScheda?: string[];
}

export type Messaggio = MessaggioUtente | MessaggioAssistente;

export interface ModificaManuale {
  testo: string;
  html: string;
  il: string;
}

export interface ConversazioneMeta {
  id: string;
  titolo: string;
  /** Id del tipo di documento, oppure «foto». */
  modalita: string;
  cantiereId: string;
  creataIl: string;
  aggiornataIl: string;
}

/** Firma grafica apposta da una persona su una versione, nel riquadro firme numero `slot`. */
export interface FirmaApposta {
  slot: number;
  personaId: string;
  /** Immagine in data/firme/<hash>.png: resta quella anche se la persona rifà la firma. */
  hash: string;
  nome: string;
  titolo: string;
  albo: string;
  il: string;
}

/** Versione segnata come definitiva da chi la usa (per chi firma su carta o con firma digitale). */
export interface StatoVersione {
  definitivo: true;
  il: string;
  personaId: string;
}

export interface Conversazione extends ConversazioneMeta {
  messaggi: Messaggio[];
  /** Modifiche fatte a mano dal DL, per «id@versione». */
  modificheManuali: Record<string, ModificaManuale>;
  /** Firme apposte, per «id@versione». */
  firme?: Record<string, FirmaApposta[]>;
  /** Versioni segnate come definitive, per «id@versione». */
  statiDocumento?: Record<string, StatoVersione>;
}

export function chiaveVersione(rif: RifDocumento): string {
  return `${rif.id}@${rif.versione}`;
}

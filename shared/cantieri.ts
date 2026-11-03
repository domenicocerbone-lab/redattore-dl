// Cantieri: i tipi della scheda costruita con l'onboarding dai documenti di progetto
// e i cantieri di esempio, visibili solo in demo e in sviluppo.

import type { AnomaliaComputo } from "./nowvision";

export interface VoceElencoPrezzi {
  tariffa: string;
  descrizione: string;
  um: string;
  prezzo: number;
  /** Quantità progressiva registrata nel libretto delle misure. */
  quantitaLibretto?: number;
}

export interface Cantiere {
  id: string;
  nome: string;
  breve: string;
  indirizzo: string;
  appalto: "pubblico" | "privato";
  lavori: string;
  /** Coppie etichetta → valore riportate nelle intestazioni dei documenti. */
  anagrafica: Record<string, string>;
  /** Persone ricorrenti in cantiere, con ruolo. */
  persone: { nome: string; ruolo: string }[];
  elencoPrezzi?: VoceElencoPrezzi[];
  economia?: {
    importoContrattuale: number;
    ribassoPercentuale: number;
    oneriSicurezzaMaturati: number;
    ritenutaPercentuale: number;
  };
}

// ---------------------------------------------------------------------------
// Scheda del cantiere, costruita con l'onboarding e confermata dall'utente

/** Da dove viene un valore: documento, pagina e se è scritto alla lettera o dedotto. */
export interface Fonte {
  documento: string;
  pagina?: number;
  certezza: "letto" | "dedotto";
}

export interface Soggetto {
  /** «Committente», «Impresa esecutrice», «Direttore dei Lavori», «CSE»… */
  ruolo: string;
  nome: string;
  /** Sede, partita IVA, recapiti o iscrizioni, se scritti nei documenti. */
  dettagli: string;
  fonte?: Fonte;
}

export interface Lavorazione {
  categoria: string;
  descrizione: string;
  fonte?: Fonte;
}

export const TIPI_ZONA = ["unita", "parti_comuni", "esterni", "facciata", "struttura", "impianti"] as const;
export type TipoZona = (typeof TIPI_ZONA)[number];
export const NOMI_TIPO_ZONA: Record<TipoZona, string> = {
  unita: "Unità",
  parti_comuni: "Parti comuni",
  esterni: "Esterni",
  facciata: "Facciata",
  struttura: "Struttura",
  impianti: "Impianti",
};

/**
 * Zona del cantiere: un elenco logico, senza geometria. Collega voci di computo e
 * attività del programma; servirà anche ad assegnare riprese 360° e foto.
 */
export interface Zona {
  id: string;
  nome: string;
  piano: string;
  tipo: TipoZona;
  /** Codici WBS delle voci di computo. */
  vociComputo: string[];
  /** Codici WBS delle attività del cronoprogramma. */
  attivita: string[];
  planimetria?: { documento: string; pagina?: number };
  note: string;
  certezza: "letto" | "dedotto";
}

export const TIPI_DOCUMENTO_PROGETTO = ["contratto", "computo", "cronoprogramma", "planimetria", "psc", "altro"] as const;
export type TipoDocumentoProgetto = (typeof TIPI_DOCUMENTO_PROGETTO)[number];
export const NOMI_DOCUMENTO_PROGETTO: Record<TipoDocumentoProgetto, string> = {
  contratto: "Contratto o capitolato",
  computo: "Computo metrico",
  cronoprogramma: "Cronoprogramma",
  planimetria: "Planimetrie",
  psc: "PSC o notifica preliminare",
  altro: "Altro documento",
};

export type StatoLettura = "in_coda" | "in_lettura" | "letto" | "errore";

export interface DocumentoProgetto {
  id: string;
  nome: string;
  tipo: TipoDocumentoProgetto;
  /** Nome del file su disco, in data/cantieri/<id>/documenti/. */
  file: string;
  mediaType: string;
  byte: number;
  pagine: number | null;
  hash: string;
  caricatoIl: string;
  caricatoDa: string;
  stato: StatoLettura;
  /** «7 soggetti, importo, 12 lavorazioni»: cosa ha trovato la lettura. */
  trovato: string;
  errore?: string;
  lettoIl?: string;
  costo?: number;
  /** Se è una nuova versione di un documento già letto: cosa è cambiato, da ricontrollare. */
  differenze?: string[];
}

/** Domanda chiusa che la proposta delle zone lascia all'utente. */
export interface Decisione {
  id: string;
  domanda: string;
  opzioni: string[];
  risposta: string;
}

export interface DatiContratto {
  importo: number | null;
  oneriSicurezza: number | null;
  ribassoPercentuale: number | null;
  ritenutaPercentuale: number | null;
}

export interface SchedaCantiere extends Cantiere {
  scheda: true;
  /** «bozza» finché l'utente non conferma: il Redattore usa i dati solo da «attiva». */
  stato: "bozza" | "attiva";
  creatoDa: string;
  creatoIl: string;
  aggiornataIl: string;
  confermataIl?: string;
  soggetti: Soggetto[];
  contratto: DatiContratto;
  date: { consegnaLavori: string; durataGiorni: number | null; ultimazionePrevista: string };
  lavorazioni: Lavorazione[];
  zone: Zona[];
  /** Codici delle voci di computo che la proposta non ha messo in nessuna zona. */
  vociSenzaZona: string[];
  decisioni: Decisione[];
  documenti: DocumentoProgetto[];
  /** Fonte di ogni valore estratto, per percorso: «soggetti.2», «contratto.importo»… */
  fonti: Record<string, Fonte>;
  /** La proposta delle zone è in corso o è da rifare. */
  zoneInPreparazione?: boolean;
  /** Anomalie trovate leggendo il computo, tolte quelle che l'utente ha ignorato. */
  anomalie: AnomaliaComputo[];
  /** Anomalie ignorate dall'utente, per «wbs|tipo»: non tornano a una nuova lettura. */
  anomalieIgnorate: string[];
  /** Conversazione di revisione della scheda, per persona. */
  revisioni?: Record<string, string>;
  /** Le zone sono state ritoccate dall'utente: una nuova lettura non le ripropone da sola. */
  zoneRiviste?: boolean;
}

/** Computo e programma in forma leggera, per la revisione delle zone nell'interfaccia. */
export interface TabelleCantiere {
  voci: {
    wbs: string;
    descrizione: string;
    unita: string;
    quantita: number | null;
    importo: number | null;
    zone: string[];
    categoria: string;
    zonaDedotta: boolean;
  }[];
  attivita: { wbs: string; descrizione: string; inizio: string | null; fine: string | null; zone: string[]; zonaDedotta: boolean }[];
}

export function eScheda(c: Cantiere): c is SchedaCantiere {
  return (c as SchedaCantiere).scheda === true;
}

/** Quello che l'interfaccia sa di ogni cantiere a cui ha accesso, dalla sessione. */
export interface CantiereBreve {
  id: string;
  nome: string;
  breve: string;
  indirizzo: string;
  stato: "bozza" | "attiva" | "esempio";
}

export function breveDi(c: Cantiere): CantiereBreve {
  return { id: c.id, nome: c.nome, breve: c.breve, indirizzo: c.indirizzo, stato: eScheda(c) ? c.stato : "esempio" };
}

// ---------------------------------------------------------------------------
// Esempi

export const UTENTE = {
  nome: "Ing. Marco Esempio",
  iniziali: "ME",
  ruolo: "Direttore dei Lavori",
};

export const CANTIERI: Cantiere[] = [
  {
    // Cantiere reale con dati NowVision (computo, cronoprogramma, riprese 360°).
    // Le voci tra parentesi quadre vanno completate con l'anagrafica vera.
    id: "residenze-incanto",
    nome: "Residenze Incanto",
    breve: "Incanto",
    indirizzo: "[indirizzo]",
    appalto: "privato",
    lavori: "Residenze Incanto: 11 unità residenziali (A-01÷A-11), piano interrato con autorimessa, corpi scala e ascensori",
    anagrafica: {
      Committente: "[da completare]",
      "Impresa esecutrice": "[da completare]",
      Progetto: "Studio Fezzardi",
      Contratto: "[da completare]",
    },
    persone: [{ nome: "Ing. Marco Esempio", ruolo: "Direttore dei Lavori" }],
  },
  {
    id: "lotto-b",
    nome: "Ristrutturazione Lotto B",
    breve: "Lotto B",
    indirizzo: "Via Tiburtina 410, Roma",
    appalto: "privato",
    lavori: "Ristrutturazione edificio residenziale — Lotto B",
    anagrafica: {
      Committente: "Immobiliare Esempio S.r.l.",
      "Impresa esecutrice": "Edilnova S.r.l.",
      Subappalti: "Termica Sud (impianti idrico-sanitari)",
      CSE: "Geom. Laura Esempio",
      Contratto: "Appalto del 12/03/2026",
    },
    persone: [
      { nome: "Ing. Marco Esempio", ruolo: "Direttore dei Lavori" },
      { nome: "Geom. Laura Esempio", ruolo: "Coordinatore sicurezza in esecuzione" },
      { nome: "Sig. Paolo Esempio", ruolo: "Capocantiere, Edilnova S.r.l." },
    ],
  },
  {
    id: "scuola-alighieri",
    nome: "Adeguamento sismico Scuola «D. Alighieri»",
    breve: "Scuola Alighieri",
    indirizzo: "Comune di Esempio",
    appalto: "pubblico",
    lavori: "Adeguamento sismico della Scuola secondaria «D. Alighieri»",
    anagrafica: {
      "Stazione appaltante": "Comune di Esempio · Settore Lavori Pubblici",
      RUP: "Arch. Paola Esempio",
      Esecutore: "Costruzioni Esempio S.p.A.",
      Contratto: "Rep. n. 1452 del 03/06/2026",
      CIG: "[CIG]",
      CUP: "[CUP]",
      "Riferimento normativo": "D.Lgs. 36/2023 e Allegato II.14",
    },
    persone: [
      { nome: "Ing. Marco Esempio", ruolo: "Direttore dei Lavori" },
      { nome: "Geom. Laura Esempio", ruolo: "Coordinatore sicurezza in esecuzione" },
      { nome: "Ing. Luca Esempio", ruolo: "Direttore tecnico, Costruzioni Esempio S.p.A." },
      { nome: "Sig. Paolo Esempio", ruolo: "Capocantiere" },
    ],
    elencoPrezzi: [
      { tariffa: "A.01", descrizione: "Demolizioni e rimozioni", um: "m³", prezzo: 85, quantitaLibretto: 96 },
      { tariffa: "A.04", descrizione: "Scavo a sezione obbligata", um: "m³", prezzo: 18.4, quantitaLibretto: 214.5 },
      { tariffa: "B.02", descrizione: "Calcestruzzo C28/35 per fondazioni e rinforzi", um: "m³", prezzo: 152, quantitaLibretto: 132.6 },
      { tariffa: "B.05", descrizione: "Acciaio B450C in barre", um: "kg", prezzo: 1.42, quantitaLibretto: 11480 },
      { tariffa: "B.09", descrizione: "Incamiciatura pilastri in c.a.", um: "cad", prezzo: 1240, quantitaLibretto: 18 },
      { tariffa: "C.03", descrizione: "Rinforzo travi con sistema FRCM", um: "m²", prezzo: 168, quantitaLibretto: 146 },
    ],
    economia: {
      importoContrattuale: 412600,
      ribassoPercentuale: 12.35,
      oneriSicurezzaMaturati: 4200,
      ritenutaPercentuale: 0.5,
    },
  },
];

/** Un cantiere di esempio, se l'id è uno di quelli. */
export function esempio(id: string | undefined): Cantiere | undefined {
  return CANTIERI.find((c) => c.id === id);
}

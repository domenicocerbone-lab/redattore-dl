// Anagrafica di esempio dei cantieri e dell'utente.
// In produzione questi dati arrivano dalla piattaforma NowVision: qui servono
// a dare al Redattore le intestazioni dei documenti senza doverle chiedere.

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

export function cantiere(id: string | undefined): Cantiere {
  return CANTIERI.find((c) => c.id === id) ?? CANTIERI[0];
}

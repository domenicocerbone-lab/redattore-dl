// Persone che possono usare il Redattore, sessione corrente e riepilogo d'uso per l'amministratore.

export interface Persona {
  id: string;
  nome: string;
  organizzazione: string;
  /** Come compare nei documenti e nel prompt, es. «Direttore dei Lavori». */
  ruolo: string;
  cantieri: string[];
  /** Messaggi al giorno; null = nessun limite. */
  limiteGiornaliero: number | null;
  admin: boolean;
  creataIl: string;
  revocataIl?: string;
}

export type DatiPersona = Pick<Persona, "nome" | "organizzazione" | "ruolo" | "cantieri" | "limiteGiornaliero">;

/** Firma grafica della persona, apposta con un clic sulle versioni che ha controllato. */
export interface FirmaProfilo {
  /** Immagine PNG in data/firme/<hash>.png, servita da /api/firme/<hash>.png. */
  hash: string;
  /** Nome per esteso come compare sotto la firma, es. «Mario Rossi». */
  nome: string;
  /** «Ing.», «Arch.», «Geom.»… */
  titolo: string;
  /** Iscrizione all'albo, es. «Ordine degli Ingegneri di Milano n. 1234». */
  albo: string;
  aggiornataIl: string;
}

import type { CantiereBreve } from "./cantieri";

export interface Sessione {
  persona: Pick<Persona, "id" | "nome" | "ruolo" | "admin">;
  firma: FirmaProfilo | null;
  iniziali: string;
  /** I cantieri che la persona può usare: le schede, e in demo anche gli esempi. */
  cantieri: CantiereBreve[];
  messaggiOggi: number;
  limiteGiornaliero: number | null;
  /** true in sviluppo e in demo: nessun login. */
  accessoLibero: boolean;
}

/** Eventi che l'interfaccia può registrare da sola (il resto lo registra il server). */
export type EventoInterfaccia =
  | { tipo: "esportazione"; formato: "stampa" | "word" | "excel"; conversazione: string; documento: string }
  | { tipo: "copia"; cosa: "documento" | "risposta"; conversazione: string };

export interface ConteggiUtilizzo {
  conversazioni: number;
  messaggi: number;
  riprese: number;
  foto: number;
  bozze: number;
  esportazioni: number;
  costo: number;
}

export interface UtilizzoPersona extends ConteggiUtilizzo {
  persona: Persona;
  ultimaAttivita: string | null;
  messaggiOggi: number;
  giorniAttivi: number;
}

export interface VoceAttivita {
  il: string;
  persona: string;
  descrizione: string;
  conversazione?: string;
  costo?: number;
}

export interface RiepilogoUtilizzo {
  giorni: number;
  totali: ConteggiUtilizzo & { personeAttive: number };
  perGiorno: { giorno: string; messaggi: number; costo: number }[];
  persone: UtilizzoPersona[];
  attivita: VoceAttivita[];
}

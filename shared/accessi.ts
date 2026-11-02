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

export interface Sessione {
  persona: Pick<Persona, "id" | "nome" | "ruolo" | "admin">;
  iniziali: string;
  cantieri: string[];
  messaggiOggi: number;
  limiteGiornaliero: number | null;
  /** true in sviluppo e in demo: nessun login. */
  accessoLibero: boolean;
}

/** Eventi che l'interfaccia può registrare da sola (il resto lo registra il server). */
export type EventoInterfaccia =
  | { tipo: "esportazione"; formato: "pdf" | "word" | "excel"; conversazione: string; documento: string }
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

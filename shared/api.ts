// Contratto HTTP tra interfaccia e server.

import type {
  Conversazione,
  ConversazioneMeta,
  FotoAllegata,
  MessaggioAssistente,
  MessaggioUtente,
  Parte,
  Parziale,
} from "./schema";

export interface NuovaConversazione {
  modalita: string;
  cantiereId: string;
}

export interface NuovoMessaggio {
  testo: string;
  /** Id restituiti da POST /api/foto. */
  foto: string[];
  /** Id delle riprese 360° NowVision del cantiere. */
  riprese?: string[];
  dettato?: { secondi: number };
  /** Tipo di documento scelto nel campo di scrittura, se cambia rispetto alla conversazione. */
  modalita?: string;
}

export interface FotoCaricata {
  dataUrl: string;
  nome: string;
  /** Millisecondi epoch dell'ultima modifica del file, per l'ora di scatto. */
  scattataIl: number;
}

export type EventoTurno =
  | { tipo: "utente"; messaggio: MessaggioUtente }
  | { tipo: "inizio"; id: string }
  | { tipo: "stato"; stato: "ragiona" | "scrive" | "calcola" }
  | { tipo: "parti"; parti: Parziale<Parte>[] }
  | { tipo: "fine"; messaggio: MessaggioAssistente; conversazione: ConversazioneMeta }
  | { tipo: "errore"; messaggio: string };

export interface Salute {
  chiaveApi: boolean;
  modello: string;
}

export type { Conversazione, ConversazioneMeta, FotoAllegata };

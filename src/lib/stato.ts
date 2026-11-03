// Stato condiviso dell'interfaccia: conversazioni aperte, turno in corso e cronologia.
// Vive fuori dai componenti, così una risposta in streaming continua anche se si cambia vista.

import { useEffect, useSyncExternalStore } from "react";
import type { EventoTurno, NuovoMessaggio } from "../../shared/api";
import type {
  Conversazione,
  ConversazioneMeta,
  FotoAllegata,
  MessaggioUtente,
  Parte,
  Parziale,
} from "../../shared/schema";
import { api, turno as apriTurno } from "./api";

export type FaseTurno = "attesa" | "ragiona" | "scrive" | "calcola";

export interface TurnoInCorso {
  fase: FaseTurno;
  parti: Parziale<Parte>[];
  controllo: AbortController;
}

export interface StatoConversazione {
  conversazione: Conversazione | null;
  errore: string | null;
  turno: TurnoInCorso | null;
  /** Messaggio del DL mostrato subito, prima della conferma del server. */
  inAttesa: MessaggioUtente | null;
}

const VUOTA: StatoConversazione = { conversazione: null, errore: null, turno: null, inAttesa: null };
const voci = new Map<string, StatoConversazione>();
let elenco: ConversazioneMeta[] | null = null;
const ascoltatori = new Set<() => void>();

function notifica() {
  ascoltatori.forEach((a) => a());
}
function sottoscrivi(a: () => void) {
  ascoltatori.add(a);
  return () => ascoltatori.delete(a);
}
function aggiorna(id: string, f: (v: StatoConversazione) => StatoConversazione) {
  voci.set(id, f(voci.get(id) ?? VUOTA));
  notifica();
}
function aggiornaConversazione(id: string, f: (c: Conversazione) => Conversazione) {
  aggiorna(id, (v) => (v.conversazione ? { ...v, conversazione: f(v.conversazione) } : v));
}

// ---------------------------------------------------------------------------
// Cronologia

export async function ricaricaElenco() {
  try {
    elenco = await api.elenco();
    notifica();
  } catch {
    // La cronologia si riprova al prossimo turno.
  }
}

export function useElenco(): ConversazioneMeta[] | null {
  const valore = useSyncExternalStore(sottoscrivi, () => elenco);
  useEffect(() => {
    if (elenco === null) void ricaricaElenco();
  }, []);
  return valore;
}

// ---------------------------------------------------------------------------
// Conversazione

export async function carica(id: string) {
  try {
    const conversazione = await api.leggi(id);
    aggiorna(id, (v) => ({ ...v, conversazione, errore: null }));
  } catch (e) {
    aggiorna(id, (v) => ({ ...v, errore: (e as Error).message }));
  }
}

export function useConversazione(id: string | null): StatoConversazione | null {
  const valore = useSyncExternalStore(sottoscrivi, () => (id ? (voci.get(id) ?? null) : null));
  useEffect(() => {
    if (id && !voci.get(id)?.conversazione) void carica(id);
  }, [id]);
  return valore;
}

export async function creaConversazione(modalita: string, cantiereId: string): Promise<string> {
  const conversazione = await api.crea({ modalita, cantiereId });
  voci.set(conversazione.id, { ...VUOTA, conversazione });
  notifica();
  return conversazione.id;
}

function gestisci(id: string, e: EventoTurno) {
  switch (e.tipo) {
    case "utente":
      aggiorna(id, (v) => ({
        ...v,
        inAttesa: null,
        conversazione: v.conversazione && {
          ...v.conversazione,
          messaggi: [...v.conversazione.messaggi, e.messaggio],
        },
      }));
      break;
    case "inizio":
      break;
    case "stato":
      aggiorna(id, (v) => (v.turno ? { ...v, turno: { ...v.turno, fase: e.stato } } : v));
      break;
    case "parti":
      aggiorna(id, (v) => (v.turno ? { ...v, turno: { ...v.turno, parti: e.parti, fase: "scrive" } } : v));
      break;
    case "fine":
      aggiorna(id, (v) => ({
        ...v,
        turno: null,
        conversazione: v.conversazione && {
          ...v.conversazione,
          ...e.conversazione,
          messaggi: [...v.conversazione.messaggi, e.messaggio],
        },
      }));
      break;
    case "errore":
      aggiorna(id, (v) => ({ ...v, errore: e.messaggio }));
      break;
  }
}

async function eseguiTurno(id: string, url: string, corpo: NuovoMessaggio | Record<string, never>) {
  const controllo = new AbortController();
  aggiorna(id, (v) => ({ ...v, errore: null, turno: { fase: "attesa", parti: [], controllo } }));
  try {
    await apriTurno(url, corpo, (e) => gestisci(id, e), controllo.signal);
  } catch (e) {
    if (!controllo.signal.aborted) aggiorna(id, (v) => ({ ...v, errore: (e as Error).message }));
  } finally {
    aggiorna(id, (v) => ({ ...v, turno: null, inAttesa: null }));
    if (controllo.signal.aborted) {
      // Il server registra l'interruzione: si ricarica la sua versione.
      window.setTimeout(() => void carica(id), 400);
    }
    void ricaricaElenco();
  }
}

export interface Invio extends NuovoMessaggio {
  /** Anteprime locali delle foto, mostrate finché il server non conferma. */
  anteprime: FotoAllegata[];
}

export function inviaMessaggio(id: string, { anteprime, ...corpo }: Invio) {
  aggiorna(id, (v) => ({
    ...v,
    inAttesa: {
      id: "in-attesa",
      ruolo: "utente",
      testo: corpo.testo,
      foto: anteprime,
      dettato: corpo.dettato,
      creatoIl: new Date().toISOString(),
    },
  }));
  return eseguiTurno(id, `/api/conversazioni/${id}/messaggi`, corpo);
}

export function rigenera(id: string) {
  aggiornaConversazione(id, (c) => {
    const ultimo = c.messaggi.at(-1);
    return ultimo?.ruolo === "assistente" ? { ...c, messaggi: c.messaggi.slice(0, -1) } : c;
  });
  return eseguiTurno(id, `/api/conversazioni/${id}/rigenera`, {});
}

export function interrompi(id: string) {
  voci.get(id)?.turno?.controllo.abort();
}

export async function impostaFeedback(id: string, messaggio: string, valore: "utile" | "da_migliorare" | null) {
  aggiornaConversazione(id, (c) => ({
    ...c,
    messaggi: c.messaggi.map((m) =>
      m.id === messaggio && m.ruolo === "assistente" ? { ...m, feedback: valore ?? undefined } : m,
    ),
  }));
  await api.feedback(id, messaggio, valore);
}

const senza = <T,>(r: Record<string, T> | undefined, chiave: string) => {
  const { [chiave]: _tolto, ...resto } = r ?? {};
  return resto;
};

/** Una versione modificata a mano torna bozza: il server toglie firme e stato definitivo. */
export async function salvaModifica(id: string, chiave: string, testo: string, html: string) {
  const modifica = await api.salvaModifica(id, chiave, { testo, html });
  aggiornaConversazione(id, (c) => ({
    ...c,
    modificheManuali: { ...c.modificheManuali, [chiave]: modifica },
    firme: senza(c.firme, chiave),
    statiDocumento: senza(c.statiDocumento, chiave),
  }));
}

export async function apponiFirma(id: string, chiave: string, slot: number) {
  const firme = await api.apponiFirma(id, chiave, slot);
  aggiornaConversazione(id, (c) => ({ ...c, firme: { ...c.firme, [chiave]: firme } }));
}

export async function togliFirma(id: string, chiave: string) {
  const firme = await api.togliFirma(id, chiave);
  aggiornaConversazione(id, (c) => ({
    ...c,
    firme: firme.length ? { ...c.firme, [chiave]: firme } : senza(c.firme, chiave),
  }));
}

export async function impostaDefinitivo(id: string, chiave: string, definitivo: boolean) {
  const stato = await api.impostaDefinitivo(id, chiave, definitivo);
  aggiornaConversazione(id, (c) => ({
    ...c,
    statiDocumento: stato ? { ...c.statiDocumento, [chiave]: stato } : senza(c.statiDocumento, chiave),
  }));
}

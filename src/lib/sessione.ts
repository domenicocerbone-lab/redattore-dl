// Chi sta usando il Redattore: caricato all'avvio, prima di mostrare l'app, e aggiornato
// quando cambia qualcosa del profilo (per esempio la firma) senza ricaricare la pagina.

import { useSyncExternalStore } from "react";
import type { Sessione } from "../../shared/accessi";
import { CANTIERI, type Cantiere } from "../../shared/cantieri";

let corrente: Sessione | null = null;
const suScaduta = new Set<() => void>();
const suCambio = new Set<() => void>();

const notifica = () => suCambio.forEach((f) => f());

export async function caricaSessione(): Promise<Sessione | null> {
  const r = await fetch("/api/sessione");
  corrente = r.ok ? ((await r.json()) as Sessione) : null;
  notifica();
  return corrente;
}

export function sessione(): Sessione | null {
  return corrente;
}

export function aggiornaSessione(parziale: Partial<Sessione>) {
  if (!corrente) return;
  corrente = { ...corrente, ...parziale };
  notifica();
}

function sottoscrivi(f: () => void) {
  suCambio.add(f);
  return () => suCambio.delete(f);
}

export function useSessione(): Sessione | null {
  return useSyncExternalStore(sottoscrivi, () => corrente);
}

export function cantieriConsentiti(): Cantiere[] {
  return CANTIERI.filter((c) => corrente?.cantieri.includes(c.id));
}

/** Link revocato o sessione scaduta a metà lavoro: l'app torna alla schermata di accesso. */
export function sessioneScaduta() {
  corrente = null;
  suScaduta.forEach((f) => f());
  notifica();
}

export function suSessioneScaduta(f: () => void): () => void {
  suScaduta.add(f);
  return () => suScaduta.delete(f);
}

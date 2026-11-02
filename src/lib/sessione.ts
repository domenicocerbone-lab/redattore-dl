// Chi sta usando il Redattore: caricato una volta all'avvio, prima di mostrare l'app.

import type { Sessione } from "../../shared/accessi";
import { CANTIERI, type Cantiere } from "../../shared/cantieri";

let corrente: Sessione | null = null;
const ascoltatori = new Set<() => void>();

export async function caricaSessione(): Promise<Sessione | null> {
  const r = await fetch("/api/sessione");
  corrente = r.ok ? ((await r.json()) as Sessione) : null;
  return corrente;
}

export function sessione(): Sessione | null {
  return corrente;
}

export function cantieriConsentiti(): Cantiere[] {
  return CANTIERI.filter((c) => corrente?.cantieri.includes(c.id));
}

/** Link revocato o sessione scaduta a metà lavoro: l'app torna alla schermata di accesso. */
export function sessioneScaduta() {
  corrente = null;
  ascoltatori.forEach((f) => f());
}

export function suSessioneScaduta(f: () => void): () => void {
  ascoltatori.add(f);
  return () => ascoltatori.delete(f);
}

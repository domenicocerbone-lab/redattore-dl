// Dettaglio di un cantiere (scheda completa o esempio), letto dal server e tenuto in memoria.

import { useEffect, useSyncExternalStore } from "react";
import type { Cantiere, SchedaCantiere } from "../../shared/cantieri";
import { api } from "./api";

type Voce = { stato: "carico" } | { stato: "pronto"; cantiere: Cantiere | SchedaCantiere } | { stato: "errore"; errore: string };

const voci = new Map<string, Voce>();
const ascoltatori = new Set<() => void>();
const notifica = () => ascoltatori.forEach((f) => f());

export async function ricaricaCantiere(id: string): Promise<Cantiere | SchedaCantiere | null> {
  if (!voci.has(id)) voci.set(id, { stato: "carico" });
  try {
    const c = await api.cantiere(id);
    voci.set(id, { stato: "pronto", cantiere: c });
    notifica();
    return c;
  } catch (e) {
    voci.set(id, { stato: "errore", errore: (e as Error).message });
    notifica();
    return null;
  }
}

/** Aggiorna la copia locale dopo una modifica fatta dall'interfaccia. */
export function impostaCantiere(c: Cantiere | SchedaCantiere) {
  voci.set(c.id, { stato: "pronto", cantiere: c });
  notifica();
}

function sottoscrivi(f: () => void) {
  ascoltatori.add(f);
  return () => ascoltatori.delete(f);
}

export function useCantiere(id: string | null): Voce | null {
  const voce = useSyncExternalStore(sottoscrivi, () => (id ? (voci.get(id) ?? null) : null));
  useEffect(() => {
    if (id && !voci.has(id)) void ricaricaCantiere(id);
  }, [id]);
  return voce;
}

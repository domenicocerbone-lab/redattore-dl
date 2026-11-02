// Chiamate al server del Redattore.

import type {
  EventoTurno,
  FotoCaricata,
  NuovaConversazione,
  NuovoMessaggio,
  Salute,
} from "../../shared/api";
import type { DatiPersona, EventoInterfaccia, Persona, RiepilogoUtilizzo } from "../../shared/accessi";
import type { Ripresa, SintesiNowVision } from "../../shared/nowvision";
import type { Conversazione, ConversazioneMeta, ModificaManuale } from "../../shared/schema";
import { sessioneScaduta } from "./sessione";

async function json<T>(risposta: Promise<Response>): Promise<T> {
  const r = await risposta;
  if (r.status === 401) sessioneScaduta();
  if (!r.ok) {
    const corpo = await r.json().catch(() => null);
    throw new Error(corpo?.errore ?? `Errore ${r.status}`);
  }
  return r.json() as Promise<T>;
}

function invia(metodo: string, url: string, corpo: unknown) {
  return fetch(url, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

export const api = {
  salute: () => json<Salute>(fetch("/api/salute")),
  elenco: (cerca?: string) =>
    json<ConversazioneMeta[]>(
      fetch(`/api/conversazioni${cerca ? `?cerca=${encodeURIComponent(cerca)}` : ""}`),
    ),
  leggi: (id: string) => json<Conversazione>(fetch(`/api/conversazioni/${id}`)),
  crea: (dati: NuovaConversazione) => json<Conversazione>(invia("POST", "/api/conversazioni", dati)),
  caricaFoto: (foto: FotoCaricata) =>
    json<{ id: string; url: string; ora: string; nome: string }>(invia("POST", "/api/foto", foto)),
  feedback: async (id: string, messaggio: string, valore: string | null) => {
    await invia("PUT", `/api/conversazioni/${id}/messaggi/${messaggio}/feedback`, { valore });
  },
  nowvision: (cantiere: string) => json<SintesiNowVision>(fetch(`/api/nowvision/${cantiere}`)),
  caricaFileNowVision: (cantiere: string, tipo: "computo" | "cronoprogramma", nome: string, base64: string) =>
    json<SintesiNowVision>(invia("POST", `/api/nowvision/${cantiere}/file`, { tipo, nome, base64 })),
  caricaRipresa: (cantiere: string, dati: { dataUrl: string; nome: string; zona: string; data: string }) =>
    json<Ripresa>(invia("POST", `/api/nowvision/${cantiere}/riprese`, dati)),
  eliminaRipresa: async (cantiere: string, id: string) => {
    await fetch(`/api/nowvision/${cantiere}/riprese/${id}`, { method: "DELETE" });
  },
  salvaModifica: (id: string, chiave: string, modifica: Pick<ModificaManuale, "testo" | "html">) =>
    json<ModificaManuale>(
      invia("PUT", `/api/conversazioni/${id}/modifiche/${encodeURIComponent(chiave)}`, modifica),
    ),
  /** Esportazioni e copie: servono solo al registro d'uso, un errore non va mostrato. */
  evento: (e: EventoInterfaccia) => {
    void invia("POST", "/api/eventi", e).catch(() => undefined);
  },
  entraComeAdmin: async (password: string) => {
    const r = await invia("POST", "/api/accesso/admin", { password });
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.errore ?? `Errore ${r.status}`);
  },
  esci: async () => {
    await fetch("/api/esci", { method: "POST" });
  },
  utilizzo: (giorni: number) => json<RiepilogoUtilizzo>(fetch(`/api/admin/utilizzo?giorni=${giorni}`)),
  creaPersona: (dati: DatiPersona) =>
    json<{ persona: Persona; link: string }>(invia("POST", "/api/admin/persone", dati)),
  aggiornaPersona: (id: string, dati: Partial<DatiPersona>) =>
    json<Persona>(invia("PUT", `/api/admin/persone/${id}`, dati)),
  nuovoLink: (id: string) => json<{ link: string }>(invia("POST", `/api/admin/persone/${id}/link`, {})),
  revoca: (id: string, revocata: boolean) =>
    json<Persona>(invia("POST", `/api/admin/persone/${id}/revoca`, { revocata })),
};

/** Turno in streaming (SSE su POST): chiama `suEvento` per ogni evento ricevuto. */
export async function turno(
  url: string,
  corpo: NuovoMessaggio | Record<string, never>,
  suEvento: (e: EventoTurno) => void,
  segnale: AbortSignal,
) {
  const r = await invia("POST", url, corpo);
  if (r.status === 401) sessioneScaduta();
  if (!r.ok || !r.body) {
    const errore = await r.json().catch(() => null);
    throw new Error(errore?.errore ?? `Errore ${r.status}`);
  }
  const lettore = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const chiudi = () => lettore.cancel().catch(() => undefined);
  segnale.addEventListener("abort", chiudi, { once: true });
  try {
    for (;;) {
      const { value, done } = await lettore.read();
      if (done) break;
      buffer += value;
      let fine: number;
      while ((fine = buffer.indexOf("\n\n")) >= 0) {
        const blocco = buffer.slice(0, fine);
        buffer = buffer.slice(fine + 2);
        const dati = blocco
          .split("\n")
          .filter((r) => r.startsWith("data: "))
          .map((r) => r.slice(6))
          .join("\n");
        if (dati) suEvento(JSON.parse(dati) as EventoTurno);
      }
    }
  } finally {
    segnale.removeEventListener("abort", chiudi);
  }
}

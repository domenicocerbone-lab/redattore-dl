// Chiamate al server del Redattore.

import type {
  EventoTurno,
  FotoCaricata,
  NuovaConversazione,
  NuovoMessaggio,
  Salute,
} from "../../shared/api";
import type { DatiPersona, EventoInterfaccia, FirmaProfilo, Persona, RiepilogoUtilizzo } from "../../shared/accessi";
import type { Cantiere, CantiereBreve, SchedaCantiere, TabelleCantiere, TipoDocumentoProgetto } from "../../shared/cantieri";
import type { Ripresa, SintesiNowVision } from "../../shared/nowvision";
import type { Conversazione, ConversazioneMeta, FirmaApposta, ModificaManuale, StatoVersione } from "../../shared/schema";
import type { VoceArchivio } from "../../shared/versioni";
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
  apponiFirma: (id: string, chiave: string, slot: number) =>
    json<FirmaApposta[]>(invia("POST", `/api/conversazioni/${id}/firme/${encodeURIComponent(chiave)}`, { slot })),
  togliFirma: (id: string, chiave: string) =>
    json<FirmaApposta[]>(fetch(`/api/conversazioni/${id}/firme/${encodeURIComponent(chiave)}`, { method: "DELETE" })),
  impostaDefinitivo: (id: string, chiave: string, definitivo: boolean) =>
    json<StatoVersione | null>(invia("PUT", `/api/conversazioni/${id}/stati/${encodeURIComponent(chiave)}`, { definitivo })),
  documenti: (filtri: { cantiere?: string; tipo?: string; stato?: string; cerca?: string; persona?: string }) => {
    const q = new URLSearchParams(Object.entries(filtri).filter((x): x is [string, string] => Boolean(x[1])));
    return json<VoceArchivio[]>(fetch(`/api/documenti?${q}`));
  },
  cantieri: () => json<CantiereBreve[]>(fetch("/api/cantieri")),
  cantiere: (id: string) => json<Cantiere | SchedaCantiere>(fetch(`/api/cantieri/${id}`)),
  creaCantiere: (nome: string) => json<SchedaCantiere>(invia("POST", "/api/cantieri", { nome })),
  aggiornaCantiere: (id: string, dati: Partial<SchedaCantiere>) =>
    json<SchedaCantiere>(invia("PUT", `/api/cantieri/${id}`, dati)),
  confermaCantiere: (id: string) => json<SchedaCantiere>(invia("POST", `/api/cantieri/${id}/conferma`, {})),
  eliminaDocumentoProgetto: (id: string, documento: string) =>
    json<SchedaCantiere>(fetch(`/api/cantieri/${id}/documenti/${documento}`, { method: "DELETE" })),
  rileggiDocumento: (id: string, documento: string) =>
    json<SchedaCantiere>(invia("POST", `/api/cantieri/${id}/documenti/${documento}/rileggi`, {})),
  tabelleCantiere: (id: string) => json<TabelleCantiere>(fetch(`/api/cantieri/${id}/tabelle`)),
  revisioneCantiere: (id: string) =>
    json<{ conversazione: Conversazione; nuova: boolean }>(invia("POST", `/api/cantieri/${id}/revisione`, {})),
  proponiZone: (id: string) => json<SchedaCantiere>(invia("POST", `/api/cantieri/${id}/zone/proponi`, {})),
  firma: () => json<FirmaProfilo | null>(fetch("/api/profilo/firma")),
  salvaFirma: (dati: { immagine?: string; nome: string; titolo: string; albo: string }) =>
    json<FirmaProfilo>(invia("PUT", "/api/profilo/firma", dati)),
  eliminaFirma: async () => {
    const r = await fetch("/api/profilo/firma", { method: "DELETE" });
    if (!r.ok) throw new Error(`Errore ${r.status}`);
  },
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

export const urlFirma = (hash: string) => `/api/firme/${hash}.png`;

export function urlPdf(conversazione: string, documento: string, versione: number, scarica = false) {
  return `/api/conversazioni/${conversazione}/documenti/${encodeURIComponent(documento)}/${versione}/pdf${scarica ? "?scarica=1" : ""}`;
}

/** Scarica il PDF generato dal server; se il server non può generarlo l'errore spiega di usare «Stampa». */
export async function scaricaPdf(conversazione: string, documento: string, versione: number, nome: string) {
  const r = await fetch(urlPdf(conversazione, documento, versione, true));
  if (r.status === 401) sessioneScaduta();
  if (!r.ok) {
    const corpo = await r.json().catch(() => null);
    throw new Error(corpo?.errore ?? `Errore ${r.status}`);
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Carica un documento di progetto come file binario, con l'avanzamento del caricamento. */
export function caricaDocumentoProgetto(
  cantiere: string,
  tipo: TipoDocumentoProgetto,
  file: Blob,
  nome: string,
  suAvanzamento: (frazione: number) => void,
  sostituisce?: string,
): Promise<SchedaCantiere> {
  return new Promise((risolvi, rifiuta) => {
    const xhr = new XMLHttpRequest();
    const q = new URLSearchParams({ tipo, nome, ...(sostituisce ? { sostituisce } : {}) });
    xhr.open("POST", `/api/cantieri/${cantiere}/documenti?${q}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && suAvanzamento(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status === 401) sessioneScaduta();
      let corpo: { errore?: string } | SchedaCantiere | null = null;
      try {
        corpo = JSON.parse(xhr.responseText);
      } catch {
        // risposta non JSON
      }
      if (xhr.status >= 200 && xhr.status < 300 && corpo) risolvi(corpo as SchedaCantiere);
      else rifiuta(new Error((corpo as { errore?: string } | null)?.errore ?? `Errore ${xhr.status}`));
    };
    xhr.onerror = () => rifiuta(new Error("Caricamento non riuscito: controlla la connessione."));
    xhr.send(file);
  });
}

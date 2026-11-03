// Registro d'uso: un evento per riga in `eventi.jsonl` (accessi, report, messaggi, risposte
// con token e costo, bozze, esportazioni). Tenuto anche in memoria per i riepiloghi
// della pagina admin e per il limite giornaliero di messaggi.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ConteggiUtilizzo, Persona, RiepilogoUtilizzo, UtilizzoPersona, VoceAttivita } from "../shared/accessi";
import { breveCantiere, nomeCantiere } from "./cantieri";
import { nomeModalita } from "../shared/documenti";
import { formatNumero } from "../shared/numeri";

const FILE_EVENTI = path.join(path.resolve(process.env.REDATTORE_DATI ?? "data"), "eventi.jsonl");

export type TipoEvento =
  | "accesso"
  | "visita"
  | "conversazione"
  | "messaggio"
  | "rigenera"
  | "risposta"
  | "feedback"
  | "modifica"
  | "esportazione"
  | "copia"
  | "nowvision"
  | "firma"
  | "definitivo"
  | "onboarding";

export interface Evento {
  il: string;
  persona: string;
  tipo: TipoEvento;
  conversazione?: string;
  cantiere?: string;
  modalita?: string;
  foto?: number;
  riprese?: number;
  dettato?: boolean;
  esito?: "ok" | "errore" | "rifiuto" | "interrotta" | "troncata";
  bozze?: string[];
  durataMs?: number;
  costo?: number;
  token?: { input: number; output: number; cacheScritti: number; cacheLetti: number };
  modello?: string;
  fallback?: boolean;
  /** Testo breve: formato esportato, valore del feedback, file NowVision, messaggio d'errore… */
  dettaglio?: string;
}

let eventi: Evento[] = [];

export async function caricaEventi() {
  try {
    const testo = await fs.readFile(FILE_EVENTI, "utf8");
    eventi = testo
      .split("\n")
      .filter(Boolean)
      .flatMap((riga) => {
        try {
          return [JSON.parse(riga) as Evento];
        } catch {
          return [];
        }
      });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

export async function registra(e: Omit<Evento, "il">) {
  const evento: Evento = { il: new Date().toISOString(), ...e };
  eventi.push(evento);
  try {
    await fs.appendFile(FILE_EVENTI, `${JSON.stringify(evento)}\n`);
  } catch (errore) {
    // Il registro non deve mai bloccare il lavoro del DL.
    console.error("Registro d'uso non scritto:", errore);
  }
}

/** Apertura dell'app: al massimo una ogni mezz'ora per persona. */
export function registraVisita(persona: string) {
  const ultima = eventi.findLast((e) => e.persona === persona && (e.tipo === "visita" || e.tipo === "accesso"));
  if (ultima && Date.now() - Date.parse(ultima.il) < 30 * 60 * 1000) return;
  void registra({ persona, tipo: "visita" });
}

// ---------------------------------------------------------------------------
// Costo delle chiamate (prezzi di listino in $ per milione di token)

const PREZZI: [prefisso: string, input: number, output: number, scritturaCache: number, letturaCache: number][] = [
  ["claude-opus-5-5", 4, 20, 5, 0.2],
  ["claude-opus-5", 5, 25, 6.25, 0.5],
  ["claude-opus-4", 5, 25, 6.25, 0.5],
  ["claude-sonnet-5", 2, 10, 2.5, 0.2],
  ["claude-fable-5", 10, 50, 12.5, 0.25],
];

function prezzi(modello: string) {
  return PREZZI.find(([p]) => modello.startsWith(p)) ?? PREZZI[0];
}

export interface Consumo {
  costo: number;
  input: number;
  output: number;
  cacheScritti: number;
  cacheLetti: number;
  modello: string;
  fallback: boolean;
}

export const consumoVuoto = (): Consumo => ({
  costo: 0,
  input: 0,
  output: 0,
  cacheScritti: 0,
  cacheLetti: 0,
  modello: "",
  fallback: false,
});

/** Somma una chiamata al consumo del turno. Con il fallback, ogni tentativo al prezzo del suo modello. */
export function aggiungiChiamata(consumo: Consumo, m: BetaMessage) {
  const voci = m.usage.iterations?.length
    ? m.usage.iterations.map((i) => ({ ...i, model: ("model" in i && i.model) || m.model }))
    : [{ ...m.usage, model: m.model }];
  for (const v of voci) {
    const [, input, output, scrittura, lettura] = prezzi(v.model);
    const scritti = v.cache_creation_input_tokens ?? 0;
    const letti = v.cache_read_input_tokens ?? 0;
    consumo.input += v.input_tokens;
    consumo.output += v.output_tokens;
    consumo.cacheScritti += scritti;
    consumo.cacheLetti += letti;
    consumo.costo += (v.input_tokens * input + v.output_tokens * output + scritti * scrittura + letti * lettura) / 1e6;
  }
  if (m.usage.iterations?.some((i) => i.type === "fallback_message")) consumo.fallback = true;
  consumo.modello = m.model;
}

// ---------------------------------------------------------------------------
// Limite giornaliero e riepiloghi

const giornoDi = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });

export function messaggiOggi(persona: string): number {
  const oggi = giornoDi(new Date().toISOString());
  return eventi.filter(
    (e) => e.persona === persona && (e.tipo === "messaggio" || e.tipo === "rigenera") && giornoDi(e.il) === oggi,
  ).length;
}

function conta(lista: Evento[]): ConteggiUtilizzo {
  const c: ConteggiUtilizzo = { conversazioni: 0, messaggi: 0, riprese: 0, foto: 0, bozze: 0, esportazioni: 0, costo: 0 };
  for (const e of lista) {
    if (e.tipo === "conversazione") c.conversazioni += 1;
    if (e.tipo === "messaggio") {
      c.messaggi += 1;
      c.riprese += e.riprese ?? 0;
      c.foto += e.foto ?? 0;
    }
    if (e.tipo === "risposta") {
      c.bozze += e.bozze?.length ?? 0;
      c.costo += e.costo ?? 0;
    }
    // La lettura dei documenti di progetto è un costo API come le risposte.
    if (e.tipo === "onboarding") c.costo += e.costo ?? 0;
    if (e.tipo === "esportazione") c.esportazioni += 1;
  }
  return c;
}

const FORMATI: Record<string, string> = { pdf: "PDF", stampa: "stampa", word: "Word", excel: "Excel" };

function descrivi(e: Evento): string {
  const plurale = (n: number, uno: string, molti: string) => `${n} ${n === 1 ? uno : molti}`;
  switch (e.tipo) {
    case "accesso":
      return e.dettaglio === "admin" ? "è entrato come amministratore" : "è entrato con il link personale";
    case "visita":
      return "ha aperto il Redattore";
    case "conversazione":
      return `ha iniziato un report: ${nomeModalita(e.modalita ?? "")}${e.cantiere ? ` · ${breveCantiere(e.cantiere)}` : ""}`;
    case "messaggio": {
      const allegati = [
        e.riprese ? plurale(e.riprese, "ripresa 360°", "riprese 360°") : "",
        e.foto ? plurale(e.foto, "foto", "foto") : "",
      ].filter(Boolean);
      return `ha scritto al Redattore${allegati.length ? ` con ${allegati.join(" e ")}` : ""}${e.dettato ? " (dettato)" : ""}`;
    }
    case "rigenera":
      return "ha chiesto di rigenerare la risposta";
    case "risposta":
      if (e.esito === "interrotta") return "ha interrotto la risposta";
      if (e.esito === "errore" || e.esito === "rifiuto") return `risposta non riuscita: ${e.dettaglio ?? "errore"}`;
      if (e.bozze?.length) return `ha ricevuto la bozza «${e.bozze.join("», «")}»`;
      return "ha ricevuto una risposta";
    case "feedback":
      return e.dettaglio === "utile" ? "ha segnato una risposta come utile" : e.dettaglio === "da_migliorare" ? "ha segnato una risposta da migliorare" : "ha tolto il giudizio a una risposta";
    case "modifica":
      return "ha modificato a mano una bozza";
    case "esportazione":
      return `ha esportato «${e.dettaglio ?? "documento"}» in ${FORMATI[e.modalita ?? ""] ?? e.modalita}`;
    case "copia":
      return e.dettaglio === "documento" ? "ha copiato una bozza" : "ha copiato una risposta";
    case "nowvision":
      return e.dettaglio ?? "ha aggiornato i dati NowVision";
    case "firma":
      return e.modalita === "tolta" ? `ha tolto la firma da «${e.dettaglio ?? "documento"}»` : `ha firmato «${e.dettaglio ?? "documento"}»`;
    case "onboarding":
      if (e.modalita === "creazione") return `ha creato il cantiere «${e.dettaglio ?? ""}»`;
      if (e.modalita === "conferma") return `ha confermato la scheda del cantiere «${e.dettaglio ?? ""}»`;
      if (e.modalita === "zone") {
        return e.esito === "errore" ? `proposta delle zone non riuscita: ${e.dettaglio ?? ""}` : `ha ricevuto la proposta delle zone di «${e.dettaglio ?? ""}»`;
      }
      return e.esito === "errore"
        ? `lettura non riuscita: ${e.dettaglio ?? "documento"}`
        : `ha fatto leggere ${e.dettaglio ?? "un documento di progetto"}`;
    case "definitivo":
      return e.modalita === "bozza"
        ? `ha riportato in bozza «${e.dettaglio ?? "documento"}»`
        : `ha segnato come definitivo «${e.dettaglio ?? "documento"}»`;
  }
}

export function riepilogo(giorni: number, persone: Persona[], nomeDi: (id: string) => string): RiepilogoUtilizzo {
  const da = Date.now() - giorni * 24 * 60 * 60 * 1000;
  const periodo = eventi.filter((e) => Date.parse(e.il) >= da);

  const perGiorno = Array.from({ length: giorni }, (_, i) => {
    const giorno = giornoDi(new Date(Date.now() - (giorni - 1 - i) * 24 * 60 * 60 * 1000).toISOString());
    const delGiorno = periodo.filter((e) => giornoDi(e.il) === giorno);
    return { giorno, messaggi: conta(delGiorno).messaggi, costo: conta(delGiorno).costo };
  });

  const righe: UtilizzoPersona[] = persone.map((persona) => {
    const sue = periodo.filter((e) => e.persona === persona.id);
    return {
      persona,
      ...conta(sue),
      ultimaAttivita: eventi.findLast((e) => e.persona === persona.id)?.il ?? null,
      messaggiOggi: messaggiOggi(persona.id),
      giorniAttivi: new Set(sue.map((e) => giornoDi(e.il))).size,
    };
  });
  righe.sort((a, b) => (b.ultimaAttivita ?? "").localeCompare(a.ultimaAttivita ?? ""));

  const attivita: VoceAttivita[] = periodo
    .slice(-80)
    .reverse()
    .map((e) => ({
      il: e.il,
      persona: nomeDi(e.persona),
      descrizione: descrivi(e),
      conversazione: e.conversazione,
      costo: e.tipo === "risposta" || e.tipo === "onboarding" ? e.costo : undefined,
    }));

  return {
    giorni,
    totali: { ...conta(periodo), personeAttive: new Set(periodo.map((e) => e.persona)).size },
    perGiorno,
    persone: righe,
    attivita,
  };
}

/** Tutti gli eventi in CSV con «;» e BOM, come lo apre Excel in italiano. */
export function eventiCsv(nomeDi: (id: string) => string): string {
  const cella = (t: unknown) => `"${String(t ?? "").replace(/"/g, '""')}"`;
  const intestazione = ["Data e ora", "Persona", "Evento", "Descrizione", "Cantiere", "Conversazione", "Costo stimato ($)", "Token in", "Token out"];
  const righe = eventi.map((e) =>
    [
      new Date(e.il).toLocaleString("it-IT", { timeZone: "Europe/Rome" }),
      nomeDi(e.persona),
      e.tipo,
      descrivi(e),
      e.cantiere ? nomeCantiere(e.cantiere) : "",
      e.conversazione ?? "",
      e.costo !== undefined ? formatNumero(e.costo, 4) : "",
      e.token ? e.token.input + e.token.cacheScritti + e.token.cacheLetti : "",
      e.token?.output ?? "",
    ]
      .map(cella)
      .join(";"),
  );
  return `﻿${[intestazione.map(cella).join(";"), ...righe].join("\r\n")}`;
}

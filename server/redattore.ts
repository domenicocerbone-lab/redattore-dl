// Un turno del Redattore: chiama Claude in streaming con output strutturato,
// esegue gli strumenti di calcolo finché il modello li chiede, e trasforma il JSON
// che arriva in parti che l'interfaccia mostra mentre vengono scritte.

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { Allow, parse as parseParziale } from "partial-json";
import type { EventoTurno, NuovoMessaggio } from "../shared/api";
import {
  RispostaSchema,
  type FotoAllegata,
  type MessaggioAssistente,
  type MessaggioUtente,
  type Parte,
  type ParteUI,
  type Parziale,
} from "../shared/schema";
import { dataItaliana } from "../shared/nowvision";
import { NOMI_DOCUMENTO_PROGETTO } from "../shared/cantieri";
import { leggiFoto, proprietario, urlFoto, type ConversazioneSalvata } from "./archivio";
import { FORMATO_RISPOSTA, ISTRUZIONI_FORMATO } from "./formato";
import { scheda } from "./cantieri";
import { contestoMessaggio, impronteScheda, schedaCantiere } from "./istruzioni";
import { parteValida } from "./riparazione";
import { contestoPerIlModello, datiNowVision, fileRipresa, urlRipresa } from "./nowvision";
import { DEFINIZIONI_REVISIONE, ID_REVISIONE, eseguiStrumentoRevisione, notaAllegati, schedaInRevisione } from "./revisione";
import { DEFINIZIONI_STRUMENTI, eseguiStrumento, type ContestoStrumento } from "./strumenti";
import { aggiungiChiamata, type Consumo } from "./utilizzo";

export const MODELLO = process.env.REDATTORE_MODELLO ?? "claude-opus-5-5";
export const SFORZO = (process.env.REDATTORE_SFORZO ?? "high") as "low" | "medium" | "high" | "xhigh" | "max";
const MAX_GIRI = 6;
const MAX_TENTATIVI_JSON = 2;

// Con l'output strutturato l'API garantisce il JSON. Se rifiuta lo schema (grammatica
// troppo grande), il server passa al formato chiesto nel prompt e controllato con zod,
// e ci resta fino al riavvio. REDATTORE_FORMATO=prompt lo impone da subito.
let formatoStrutturato = process.env.REDATTORE_FORMATO !== "prompt";

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  // Credenziali dall'ambiente: ANTHROPIC_API_KEY (o ANTHROPIC_AUTH_TOKEN).
  client ??= new Anthropic();
  return client;
}

export function chiaveConfigurata(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// ---------------------------------------------------------------------------
// Messaggio del DL

export async function aggiungiMessaggioUtente(
  conv: ConversazioneSalvata,
  input: NuovoMessaggio,
): Promise<MessaggioUtente> {
  const foto: FotoAllegata[] = [];
  const blocchi: BetaContentBlockParam[] = [];

  const intestazione = [contestoMessaggio(new Date(), input.modalita ?? (conv.messaggi.length ? undefined : conv.modalita))];
  intestazione.push(...conv.notePendenti);
  // La scheda del cantiere è cambiata dopo l'inizio della conversazione: il prompt è fisso, la nota no.
  const c = scheda(conv.cantiereId);
  const allegati = c ? (input.documenti ?? []).filter((id) => c.documenti.some((d) => d.id === id)).slice(0, 10) : [];
  if (c && conv.modalita === ID_REVISIONE) {
    // In revisione la scheda cambia di continuo: arriva intera ogni volta che è diversa da quella già vista.
    const testoScheda = await schedaInRevisione(c);
    const impronta = createHash("sha256").update(testoScheda).digest("hex").slice(0, 16);
    if (conv.schedaInviata !== impronta) {
      intestazione.push(`[Scheda del cantiere aggiornata a ora:\n${testoScheda}]`);
      conv.schedaInviata = impronta;
    }
    const nota = notaAllegati(c, allegati);
    if (nota) intestazione.push(nota);
  } else if (c?.stato === "attiva") {
    const impronta = impronteScheda(c);
    if (conv.schedaInviata !== impronta) {
      intestazione.push(`[La scheda del cantiere è stata aggiornata: usa questi dati al posto di quelli del prompt.\n${schedaCantiere(c)}]`);
    }
    conv.schedaInviata = impronta;
  }
  conv.notePendenti = [];
  if (input.dettato) {
    intestazione.push("[Messaggio dettato a voce: possibili errori di trascrizione su nomi e numeri.]");
  }
  blocchi.push({ type: "text", text: intestazione.join("\n") });

  for (const id of input.foto) {
    const trovata = await leggiFoto(id);
    if (!trovata) continue;
    conv.contatoreFoto += 1;
    const etichetta = `F${conv.contatoreFoto}`;
    foto.push({ id, etichetta, ora: trovata.foto.ora, nome: trovata.foto.nome, url: urlFoto(id) });
    blocchi.push({
      type: "text",
      text: `${etichetta} · ${trovata.foto.nome}${trovata.foto.ora ? ` · scattata alle ${trovata.foto.ora}` : ""}`,
    });
    blocchi.push({
      type: "image",
      source: {
        type: "base64",
        media_type: trovata.foto.mediaType,
        data: (await fs.readFile(trovata.file)).toString("base64"),
      },
    });
  }

  const riprese = await Promise.all((input.riprese ?? []).map((id) => fileRipresa(conv.cantiereId, id)));
  const valide = riprese
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.ripresa.data.localeCompare(b.ripresa.data));
  if (valide.length) {
    // Cronoprogramma e computo arrivano con le riprese, una volta per versione dei file.
    const dati = await datiNowVision(conv.cantiereId);
    const riferimento = valide.at(-1)!.ripresa.data;
    const versione = `${dati.programma?.caricatoIl ?? "-"}|${dati.computo?.caricatoIl ?? "-"}|${riferimento}`;
    if (conv.nowvisionInviato !== versione && (dati.programma || dati.computo)) {
      const zone = [...new Set(valide.map((r) => r.ripresa.zona))];
      blocchi.push({ type: "text", text: contestoPerIlModello(dati, riferimento, zone) });
      conv.nowvisionInviato = versione;
    }
    for (const { ripresa, file } of valide) {
      conv.contatoreFoto += 1;
      const etichetta = `F${conv.contatoreFoto}`;
      foto.push({
        id: ripresa.id,
        etichetta,
        ora: "",
        nome: `Ripresa 360° · ${ripresa.zona}`,
        url: urlRipresa(conv.cantiereId, ripresa.id),
        ripresa: { zona: ripresa.zona, data: ripresa.data },
      });
      blocchi.push({
        type: "text",
        text: `${etichetta} · ripresa 360° NowVision · zona ${ripresa.zona} · ${dataItaliana(ripresa.data)}`,
      });
      const estensione = path.extname(file).slice(1).toLowerCase();
      blocchi.push({
        type: "image",
        source: {
          type: "base64",
          media_type: estensione === "png" ? "image/png" : estensione === "webp" ? "image/webp" : "image/jpeg",
          data: (await fs.readFile(file)).toString("base64"),
        },
      });
    }
  }

  const testo = input.testo.trim();
  blocchi.push({ type: "text", text: testo || (allegati.length ? "(nessun testo: solo documenti)" : "(nessun testo: solo foto)") });

  const messaggio: MessaggioUtente = {
    id: randomUUID(),
    ruolo: "utente",
    testo,
    foto,
    ...(c && allegati.length
      ? {
          allegati: allegati.map((id) => {
            const d = c.documenti.find((x) => x.id === id)!;
            return { id, nome: d.nome, tipo: NOMI_DOCUMENTO_PROGETTO[d.tipo] };
          }),
        }
      : {}),
    ...(input.dettato ? { dettato: input.dettato } : {}),
    creatoIl: new Date().toISOString(),
  };
  if (input.modalita && conv.messaggi.length === 0) conv.modalita = input.modalita;
  conv.inizioTurno[messaggio.id] = conv.apiMessaggi.length;
  conv.apiMessaggi.push({ role: "user", content: blocchi });
  conv.messaggi.push(messaggio);
  return messaggio;
}

// ---------------------------------------------------------------------------
// Turno del modello

/**
 * Dopo un fallback a metà risposta, i blocchi prima dell'ultimo confine che non sono
 * testo appartengono al tentativo rifiutato: non vanno rimandati né eseguiti.
 */
function dopoFallback(contenuto: BetaContentBlock[]): BetaContentBlock[] {
  const confine = contenuto.map((b) => b.type).lastIndexOf("fallback");
  if (confine < 0) return contenuto;
  return contenuto.filter((b, i) => i >= confine || b.type === "text");
}

function testoDi(contenuto: BetaContentBlock[]): string {
  return contenuto
    .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Dal primo «{»: senza output strutturato il modello può premettere testo o un blocco di codice. */
export function daGraffa(testo: string): string {
  const inizio = testo.indexOf("{");
  return inizio < 0 ? "" : testo.slice(inizio);
}

function partiParziali(testo: string): Parziale<Parte>[] {
  const json = daGraffa(testo);
  if (!json.trim()) return [];
  try {
    const oggetto = parseParziale(json, Allow.ALL) as { parti?: unknown };
    return Array.isArray(oggetto?.parti) ? (oggetto.parti as Parziale<Parte>[]) : [];
  } catch {
    return [];
  }
}

/**
 * Parse rigoroso; se fallisce controlla e ripara le parti una per una invece di perdere
 * la risposta. Senza riparazione una bozza con un campo mancante sparirebbe a fine turno
 * dopo essere comparsa durante lo streaming.
 */
function partiFinali(testo: string, tipoDocumento: string): { parti: Parte[]; titolo: string } {
  const daInizio = daGraffa(testo);
  const json = daInizio.slice(0, daInizio.lastIndexOf("}") + 1);
  try {
    const r = RispostaSchema.safeParse(JSON.parse(json));
    if (r.success) return { parti: r.data.parti, titolo: r.data.titolo_conversazione };
  } catch {
    // JSON troncato: si recupera sotto
  }
  let titolo = "";
  try {
    const oggetto = parseParziale(daInizio, Allow.ALL) as { titolo_conversazione?: unknown };
    if (typeof oggetto?.titolo_conversazione === "string") titolo = oggetto.titolo_conversazione;
  } catch {
    // senza titolo
  }
  const parti = partiParziali(daInizio)
    .map((p) => parteValida(p, tipoDocumento))
    .filter((p): p is Parte => p !== null);
  return { parti, titolo };
}

export function schemaRifiutato(e: unknown): boolean {
  if (!(e instanceof Anthropic.BadRequestError)) return false;
  const dettaglio = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
  return /grammar|schema/i.test(dettaglio);
}

function erroreJsonStrumento(e: unknown): boolean {
  return (
    e instanceof Anthropic.AnthropicError &&
    !(e instanceof Anthropic.APIError) &&
    e.message.startsWith("Unable to parse tool parameter JSON")
  );
}

function slug(testo: string): string {
  return (
    testo
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "documento"
  );
}

/** Ogni documento riceve un id (dal titolo) e una versione progressiva nella conversazione. */
function numeraDocumenti(conv: ConversazioneSalvata, parti: Parte[]): ParteUI[] {
  const ultime = new Map<string, number>();
  for (const m of conv.messaggi) {
    if (m.ruolo !== "assistente") continue;
    for (const p of m.parti) {
      if (p.rif) ultime.set(p.rif.id, Math.max(ultime.get(p.rif.id) ?? 0, p.rif.versione));
    }
  }
  return parti.map((p) => {
    if (p.tipo !== "documento") return p;
    const id = slug(p.documento.titolo);
    const versione = (ultime.get(id) ?? 0) + 1;
    ultime.set(id, versione);
    return { ...p, rif: { id, versione } };
  });
}

export function messaggioErrore(e: unknown): string {
  if (e instanceof Anthropic.APIUserAbortError) return "Risposta interrotta.";
  if (e instanceof Anthropic.AuthenticationError)
    return "Chiave API non valida. Controlla ANTHROPIC_API_KEY sul server.";
  if (e instanceof Anthropic.PermissionDeniedError)
    return "La chiave API non ha accesso a questo modello.";
  if (e instanceof Anthropic.RateLimitError)
    return "Troppe richieste in poco tempo. Riprova tra qualche secondo.";
  if (e instanceof Anthropic.BadRequestError) {
    const dettaglio = (e.error as { error?: { message?: string } } | undefined)?.error?.message;
    return `Richiesta non valida: ${dettaglio ?? e.message}`;
  }
  if (e instanceof Anthropic.APIConnectionError)
    return "Non riesco a raggiungere il servizio. Controlla la connessione e riprova.";
  if (e instanceof Anthropic.APIError) return `Errore del servizio (${e.status}). Riprova.`;
  if (e instanceof Error && e.message.includes("API key"))
    return "Manca la chiave API: imposta ANTHROPIC_API_KEY sul server.";
  return "Si è verificato un errore imprevisto. Riprova.";
}

export async function eseguiTurno(
  conv: ConversazioneSalvata,
  emetti: (e: EventoTurno) => void,
  segnale: AbortSignal,
  consumo?: Consumo,
): Promise<MessaggioAssistente> {
  const id = randomUUID();
  emetti({ tipo: "inizio", id });
  const lunghezzaIniziale = conv.apiMessaggi.length;
  const revisione = conv.modalita === ID_REVISIONE;
  const contesto: ContestoStrumento = { cantiereId: conv.cantiereId, personaId: proprietario(conv), modifiche: [] };
  // Le modifiche alla scheda restano anche se il turno poi fallisce: il messaggio le racconta.
  const conModifiche = (m: MessaggioAssistente): MessaggioAssistente =>
    contesto.modifiche?.length ? { ...m, modificheScheda: [...contesto.modifiche] } : m;
  const partiCompletate: Parte[] = [];
  let titolo = "";
  let tentativiJson = 0;

  try {
    for (let giro = 0; giro < MAX_GIRI; giro++) {
      let testoGiro = "";
      let ultimoInvio = 0;
      let finale: BetaMessage;

      const inviaParti = (forza = false) => {
        const ora = Date.now();
        if (!forza && ora - ultimoInvio < 60) return;
        ultimoInvio = ora;
        emetti({ tipo: "parti", parti: [...partiCompletate, ...partiParziali(testoGiro)] });
      };

      try {
        const stream = anthropic().beta.messages.stream(
          {
            model: MODELLO,
            max_tokens: 64000,
            // Fallback lato server se i classificatori rifiutano una richiesta legittima.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            thinking: { type: "adaptive" },
            output_config: formatoStrutturato ? { effort: SFORZO, format: FORMATO_RISPOSTA } : { effort: SFORZO },
            cache_control: { type: "ephemeral" },
            system: formatoStrutturato ? conv.sistema : conv.sistema + ISTRUZIONI_FORMATO,
            tools: revisione ? DEFINIZIONI_REVISIONE : DEFINIZIONI_STRUMENTI,
            messages: conv.apiMessaggi,
          },
          { signal: segnale },
        );
        for await (const evento of stream) {
          if (evento.type === "content_block_start") {
            const tipo = evento.content_block.type;
            if (tipo === "thinking" || tipo === "redacted_thinking") emetti({ tipo: "stato", stato: "ragiona" });
            else if (tipo === "tool_use") emetti({ tipo: "stato", stato: "calcola" });
            else if (tipo === "text") emetti({ tipo: "stato", stato: "scrive" });
          } else if (evento.type === "content_block_delta" && evento.delta.type === "text_delta") {
            testoGiro += evento.delta.text;
            inviaParti();
          }
        }
        finale = await stream.finalMessage();
        if (consumo) aggiungiChiamata(consumo, finale);
      } catch (e) {
        if (formatoStrutturato && schemaRifiutato(e)) {
          console.warn("L'API ha rifiutato lo schema della risposta: passo al formato chiesto nel prompt.", e);
          formatoStrutturato = false;
          giro -= 1;
          continue;
        }
        if (erroreJsonStrumento(e) && tentativiJson < MAX_TENTATIVI_JSON) {
          // Il blocco tool_use non si è chiuso: non c'è un id a cui rispondere, si ripete il giro.
          tentativiJson += 1;
          giro -= 1;
          continue;
        }
        throw e;
      }

      if (finale.stop_reason === "refusal") {
        // Anche i modelli di fallback hanno rifiutato: l'eventuale parziale si scarta.
        conv.apiMessaggi.length = lunghezzaIniziale;
        return conModifiche({
          id,
          ruolo: "assistente",
          parti: [],
          creatoIl: new Date().toISOString(),
          errore:
            "Non posso preparare questa risposta. Riformula la richiesta descrivendo il contesto di cantiere.",
        });
      }

      const contenuto = dopoFallback(finale.content);
      conv.apiMessaggi.push({ role: "assistant", content: contenuto as BetaContentBlockParam[] });
      const usi = contenuto.filter(
        (b): b is Extract<BetaContentBlock, { type: "tool_use" }> => b.type === "tool_use",
      );

      if (usi.length > 0) {
        const troncato = finale.stop_reason === "max_tokens";
        const prima = contesto.modifiche?.length ?? 0;
        const risultati: BetaToolResultBlockParam[] = await Promise.all(
          usi.map(async (uso): Promise<BetaToolResultBlockParam> => {
            const esito = troncato
              ? { contenuto: "Input troncato per limite di lunghezza: ripeti la chiamata.", errore: true }
              : revisione
                ? await eseguiStrumentoRevisione(uso.name, uso.input, contesto)
                : await eseguiStrumento(uso.name, uso.input, contesto);
            return {
              type: "tool_result",
              tool_use_id: uso.id,
              content: esito.contenuto,
              ...(esito.errore ? { is_error: true } : {}),
            };
          }),
        );
        conv.apiMessaggi.push({ role: "user", content: risultati });
        if ((contesto.modifiche?.length ?? 0) > prima) emetti({ tipo: "scheda", cantiereId: conv.cantiereId });
        const testo = testoDi(contenuto);
        if (testo) partiCompletate.push(...partiFinali(testo, conv.modalita).parti);
        continue;
      }

      const risposta = partiFinali(testoDi(contenuto), conv.modalita);
      partiCompletate.push(...risposta.parti);
      titolo = risposta.titolo;
      if (finale.stop_reason === "max_tokens") {
        return conModifiche({
          id,
          ruolo: "assistente",
          parti: numeraDocumenti(conv, partiCompletate),
          creatoIl: new Date().toISOString(),
          errore: "La risposta era troppo lunga ed è stata interrotta. Chiedi di continuare o di accorciare.",
        });
      }
      break;
    }
  } catch (e) {
    // Si torna allo stato subito dopo il messaggio del DL: «Rigenera» riparte da lì.
    conv.apiMessaggi.length = lunghezzaIniziale;
    return conModifiche({
      id,
      ruolo: "assistente",
      parti: [],
      creatoIl: new Date().toISOString(),
      errore: messaggioErrore(e),
    });
  }

  if (titolo.trim()) conv.titolo = titolo.trim().slice(0, 60);
  if (partiCompletate.length === 0) {
    return conModifiche({
      id,
      ruolo: "assistente",
      parti: [],
      creatoIl: new Date().toISOString(),
      errore: "Il Redattore non ha prodotto una risposta leggibile. Prova a rigenerarla.",
    });
  }
  return conModifiche({
    id,
    ruolo: "assistente",
    parti: numeraDocumenti(conv, partiCompletate),
    creatoIl: new Date().toISOString(),
  });
}

/**
 * Revisione: prima di rigenerare, se il tentativo precedente ha già modificato la scheda,
 * il messaggio dell'utente (in coda alla cronologia) riceve la scheda com'è ora, così il
 * Redattore non ripete modifiche già fatte.
 */
export async function schedaPerRigenera(conv: ConversazioneSalvata) {
  const c = scheda(conv.cantiereId);
  const ultimo = conv.apiMessaggi.at(-1);
  if (!c || conv.modalita !== ID_REVISIONE || ultimo?.role !== "user" || !Array.isArray(ultimo.content)) return;
  const testoScheda = await schedaInRevisione(c);
  const impronta = createHash("sha256").update(testoScheda).digest("hex").slice(0, 16);
  if (conv.schedaInviata === impronta) return;
  ultimo.content.push({
    type: "text",
    text: `[Il tentativo di risposta precedente ha già modificato la scheda: non ripetere quelle modifiche. Scheda com'è ora:\n${testoScheda}]`,
  });
  conv.schedaInviata = impronta;
}

/** Riporta la conversazione a subito dopo l'ultimo messaggio del DL, per rigenerare la risposta. */
export function tornaAllUltimoMessaggio(conv: ConversazioneSalvata): boolean {
  const indice = conv.messaggi.map((m) => m.ruolo).lastIndexOf("utente");
  if (indice < 0) return false;
  const ultimo = conv.messaggi[indice];
  const inizio = conv.inizioTurno[ultimo.id];
  if (inizio === undefined) return false;
  conv.messaggi.length = indice + 1;
  conv.apiMessaggi.length = inizio + 1;
  return true;
}

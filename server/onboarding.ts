// Onboarding del cantiere: caricamento dei documenti di progetto e loro lettura in coda.
// Ogni documento produce dati per la scheda (anagrafica, soggetti, contratto, date,
// lavorazioni), per computo e programma (salvati come dati NowVision) o ambienti dalle
// planimetrie. Alla fine una proposta di zone collega voci e attività.
// Lo stato di ogni documento sta nella scheda: dopo un riavvio la lettura riprende.

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { PDFDocument } from "pdf-lib";
import readXlsxFile from "read-excel-file/node";
import * as z from "zod";
import {
  NOMI_DOCUMENTO_PROGETTO,
  TIPI_ZONA,
  type DocumentoProgetto,
  type Fonte,
  type SchedaCantiere,
  type TipoDocumentoProgetto,
  type Zona,
} from "../shared/cantieri";
import type { AnomaliaComputo, AttivitaProgramma, VoceComputo } from "../shared/nowvision";
import { formatEuro } from "../shared/numeri";
import { scriviAtomico } from "./archivio-json";
import { cartellaCantiere, salvaScheda, scheda, tutteLeSchede } from "./cantieri";
import { estraiStrutturato, MODELLO_DOCUMENTI, MODELLO_TABELLE } from "./estrazione";
import { datiNowVision, leggiComputo, leggiProgramma, rimuoviEstratti, salvaEstratti } from "./nowvision";
import { messaggioErrore } from "./redattore";
import { controllaConti, normWbs, riattaccaAttivita, riattaccaColonne, uniscAnomalie } from "./tabelle";
import { consumoVuoto, registra, type Consumo } from "./utilizzo";

const PARALLELI = 2;
/** Pagine per chiamata: documenti di testo, tabelle (molte righe da restituire), disegni. */
const PAGINE = { testo: 90, tabelle: 20, disegni: 30 };
const RIGHE_PER_BLOCCO = 150;

// ---------------------------------------------------------------------------
// Caricamento

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function riconosci(contenuto: Buffer, nome: string): { mediaType: string; estensione: string } {
  if (contenuto.subarray(0, 5).toString("latin1") === "%PDF-") return { mediaType: "application/pdf", estensione: "pdf" };
  if (contenuto.subarray(0, 8).equals(PNG)) return { mediaType: "image/png", estensione: "png" };
  if (contenuto[0] === 0xff && contenuto[1] === 0xd8) return { mediaType: "image/jpeg", estensione: "jpg" };
  if (contenuto[0] === 0x50 && contenuto[1] === 0x4b && /\.xlsx$/i.test(nome)) {
    return { mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", estensione: "xlsx" };
  }
  if (/\.xls$/i.test(nome)) throw new Error("Il formato .xls non si legge: salva il file come .xlsx e ricaricalo.");
  if (/\.csv$/i.test(nome) && !contenuto.includes(0)) return { mediaType: "text/csv", estensione: "csv" };
  throw new Error("Formato non supportato: carica PDF, xlsx, csv o immagini JPG/PNG.");
}

async function contaPagine(contenuto: Buffer): Promise<number | null> {
  try {
    return (await PDFDocument.load(contenuto, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
  } catch {
    return null;
  }
}

const cartellaDocumenti = (s: SchedaCantiere) => path.join(cartellaCantiere(s.id), "documenti");
const fileEstratti = (s: SchedaCantiere, d: DocumentoProgetto) => path.join(cartellaCantiere(s.id), "estratti", `${d.id}.json`);
export const fileDocumento = (s: SchedaCantiere, d: DocumentoProgetto) => path.join(cartellaDocumenti(s), d.file);

export async function aggiungiDocumento(
  s: SchedaCantiere,
  tipo: TipoDocumentoProgetto,
  nome: string,
  contenuto: Buffer,
  personaId: string,
  sostituisce?: string,
): Promise<DocumentoProgetto> {
  if (contenuto.length === 0) throw new Error("Il file è vuoto.");
  const { mediaType, estensione } = riconosci(contenuto, nome);
  const id = randomUUID();
  const d: DocumentoProgetto = {
    id,
    nome: nome.replace(/[\\/]/g, "-").slice(0, 160) || `documento.${estensione}`,
    tipo,
    file: `${id}.${estensione}`,
    mediaType,
    byte: contenuto.length,
    pagine: mediaType === "application/pdf" ? await contaPagine(contenuto) : null,
    hash: createHash("sha256").update(contenuto).digest("hex"),
    caricatoIl: new Date().toISOString(),
    caricatoDa: personaId,
    stato: "in_coda",
    trovato: "",
  };
  await scriviAtomico(path.join(cartellaDocumenti(s), d.file), contenuto);
  const vecchio = sostituisce ? s.documenti.find((x) => x.id === sostituisce) : undefined;
  s.documenti.push(d);
  if (vecchio) sostituiti.set(d.id, vecchio);
  await salvaScheda(s);
  accoda(s.id, d.id);
  return d;
}

/** Documento nuovo → versione precedente che sostituisce, finché non è stato letto. */
const sostituiti = new Map<string, DocumentoProgetto>();

export async function eliminaDocumento(s: SchedaCantiere, documentoId: string) {
  const d = s.documenti.find((x) => x.id === documentoId);
  if (!d) throw new Error("Documento non trovato.");
  if (d.stato === "in_lettura") throw new Error("Il documento è in lettura: aspetta che finisca.");
  s.documenti = s.documenti.filter((x) => x.id !== documentoId);
  await fs.rm(fileDocumento(s, d), { force: true });
  await fs.rm(fileEstratti(s, d), { force: true });
  if (d.tipo === "computo" || d.tipo === "cronoprogramma") await ricomponi(s, d.tipo);
  await salvaScheda(s);
}

// ---------------------------------------------------------------------------
// Coda

const coda: { cantiere: string; documento: string }[] = [];
let attivi = 0;

export function accoda(cantiere: string, documento: string) {
  if (!coda.some((l) => l.cantiere === cantiere && l.documento === documento)) coda.push({ cantiere, documento });
  avanza();
}

function avanza() {
  while (attivi < PARALLELI && coda.length > 0) {
    const lavoro = coda.shift()!;
    attivi += 1;
    void esegui(lavoro.cantiere, lavoro.documento)
      .catch((e) => console.error("Lettura documento:", e))
      .finally(() => {
        attivi -= 1;
        avanza();
      });
  }
}

/** All'avvio: i documenti rimasti in coda o a metà lettura ripartono. */
export async function riprendiLetture() {
  for (const s of tutteLeSchede()) {
    let cambiata = s.zoneInPreparazione === true;
    s.zoneInPreparazione = false;
    for (const d of s.documenti) {
      if (d.stato === "in_lettura" || d.stato === "in_coda") {
        d.stato = "in_coda";
        cambiata = true;
        accoda(s.id, d.id);
      }
    }
    if (cambiata) await salvaScheda(s);
  }
}

export function rileggi(s: SchedaCantiere, documentoId: string) {
  const d = s.documenti.find((x) => x.id === documentoId);
  if (!d) throw new Error("Documento non trovato.");
  if (d.stato === "in_lettura" || d.stato === "in_coda") return;
  d.stato = "in_coda";
  delete d.errore;
  accoda(s.id, d.id);
}

const inCorso = (s: SchedaCantiere) => s.documenti.some((d) => d.stato === "in_coda" || d.stato === "in_lettura");

async function esegui(cantiereId: string, documentoId: string) {
  const s = scheda(cantiereId);
  const d = s?.documenti.find((x) => x.id === documentoId);
  if (!s || !d) return;
  d.stato = "in_lettura";
  delete d.errore;
  await salvaScheda(s);
  const consumo = consumoVuoto();
  const inizio = Date.now();
  try {
    d.trovato = await leggi(s, d, consumo);
    d.stato = "letto";
    d.lettoIl = new Date().toISOString();
  } catch (e) {
    d.stato = "errore";
    d.errore = messaggioErrore(e).replace(/^Si è verificato un errore imprevisto\. /, "") || "Lettura non riuscita.";
    if (!(e instanceof Error) || !e.message.startsWith("Il ")) console.error(`Lettura di «${d.nome}»:`, e);
  }
  d.costo = (d.costo ?? 0) + consumo.costo;
  sostituiti.delete(d.id);
  await salvaScheda(s);
  void registra({
    persona: d.caricatoDa,
    tipo: "onboarding",
    cantiere: s.id,
    esito: d.stato === "letto" ? "ok" : "errore",
    modalita: "lettura",
    dettaglio: `${NOMI_DOCUMENTO_PROGETTO[d.tipo].toLowerCase()} «${d.nome}»${d.errore ? `: ${d.errore}` : ""}`,
    costo: consumo.costo,
    durataMs: Date.now() - inizio,
    token: { input: consumo.input, output: consumo.output, cacheScritti: consumo.cacheScritti, cacheLetti: consumo.cacheLetti },
    modello: consumo.modello || undefined,
  });
  // Finita l'ultima lettura di una scheda in bozza, si propongono le zone.
  if (!inCorso(s) && s.stato === "bozza" && s.documenti.some((x) => x.stato === "letto")) {
    await proponiZone(s, d.caricatoDa);
  }
}

// ---------------------------------------------------------------------------
// Contenuti per il modello

const SISTEMA = `Sei l'assistente di onboarding del Redattore DL di NowVision. Leggi i documenti di progetto di un cantiere edile italiano ed estrai i dati che il Redattore userà per preparare giornali dei lavori, verbali, SAL e report.

Regole:
- Riporta solo ciò che è scritto nel documento. Non inventare nomi, imprese, importi, date, codici o quantità.
- Se un dato non c'è lascialo vuoto ("" o null) con certezza «assente».
- Certezza «letto» se il valore è scritto così nel documento; «dedotto» se lo ricavi dal contesto (per esempio un ruolo non dichiarato esplicitamente).
- Quantità, prezzi e importi si copiano come sono scritti, non si calcolano.
- Date nel formato AAAA-MM-GG. Testi in italiano, come nel documento.
- Pagina: il numero di pagina del documento originale.`;

type Pezzo = { contenuti: BetaContentBlockParam[]; da?: number; a?: number };

/** Il documento in pezzi da mandare al modello: pagine di PDF, immagine, o testo tabellare. */
async function pezzi(s: SchedaCantiere, d: DocumentoProgetto, pagineMax: number): Promise<Pezzo[]> {
  const contenuto = await fs.readFile(fileDocumento(s, d));
  if (d.mediaType === "application/pdf") {
    const totale = d.pagine ?? (await contaPagine(contenuto)) ?? 1;
    if (totale <= pagineMax) {
      return [{ contenuti: [documentoPdf(contenuto, d.nome)], da: 1, a: totale }];
    }
    const originale = await PDFDocument.load(contenuto, { ignoreEncryption: true, updateMetadata: false });
    const elenco: Pezzo[] = [];
    for (let da = 1; da <= totale; da += pagineMax) {
      const a = Math.min(totale, da + pagineMax - 1);
      const parte = await PDFDocument.create();
      const copiate = await parte.copyPages(
        originale,
        Array.from({ length: a - da + 1 }, (_, i) => da - 1 + i),
      );
      copiate.forEach((p) => parte.addPage(p));
      elenco.push({ contenuti: [documentoPdf(Buffer.from(await parte.save()), `${d.nome}, pagine ${da}-${a}`)], da, a });
    }
    return elenco;
  }
  if (d.mediaType.startsWith("image/")) {
    return [
      {
        contenuti: [
          {
            type: "image",
            source: { type: "base64", media_type: d.mediaType as "image/png" | "image/jpeg", data: contenuto.toString("base64") },
          },
        ],
      },
    ];
  }
  // Fogli di calcolo e CSV: testo tabellare a blocchi, con l'intestazione ripetuta.
  const righe = await righeTabellari(s, d, contenuto);
  const elenco: Pezzo[] = [];
  for (const foglio of righe) {
    const [intestazione, ...corpo] = foglio.righe;
    for (let i = 0; i < Math.max(corpo.length, 1); i += RIGHE_PER_BLOCCO) {
      const blocco = corpo.slice(i, i + RIGHE_PER_BLOCCO);
      elenco.push({
        contenuti: [
          {
            type: "text",
            text: `Foglio «${foglio.nome}», righe ${i + 2}-${i + 1 + blocco.length} (colonne separate da «|»):\n${intestazione ?? ""}\n${blocco.join("\n")}`,
          },
        ],
      });
    }
  }
  return elenco;
}

async function righeTabellari(s: SchedaCantiere, d: DocumentoProgetto, contenuto: Buffer) {
  if (d.mediaType === "text/csv") {
    const testo = contenuto.toString("utf8").replace(/^﻿/, "");
    const righe = testo.split(/\r?\n/).filter((r) => r.trim());
    const separatore = (righe[0]?.match(/;/g)?.length ?? 0) > (righe[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
    return [{ nome: d.nome, righe: righe.map((r) => r.split(separatore).map((c) => c.trim()).join(" | ")) }];
  }
  const fogli = (await readXlsxFile(fileDocumento(s, d))) as { sheet: string; data: unknown[][] }[];
  return fogli
    .map((f) => ({
      nome: f.sheet,
      righe: f.data
        .map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? "").trim())))
        .filter((r) => r.some(Boolean))
        .map((r) => r.join(" | ")),
    }))
    .filter((f) => f.righe.length > 0);
}

function documentoPdf(contenuto: Buffer, titolo: string): BetaContentBlockParam {
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: contenuto.toString("base64") }, title: titolo };
}

const intro = (obiettivo: string, d: DocumentoProgetto, p: Pezzo, richiesta: string): BetaContentBlockParam => ({
  type: "text",
  text: `[estrazione:${obiettivo}] Documento «${d.nome}» (${NOMI_DOCUMENTO_PROGETTO[d.tipo]})${
    p.da && p.a && (p.da > 1 || (d.pagine ?? 0) > p.a) ? `: questo estratto contiene le pagine da ${p.da} a ${p.a}; indica le pagine del documento originale` : ""
  }.\n${richiesta}`,
});

// ---------------------------------------------------------------------------
// Schemi di estrazione (piccoli: uno per obiettivo)

const Certezza = z.enum(["letto", "dedotto", "assente"]);
const CampoTesto = z.object({ valore: z.string(), pagina: z.number().int(), certezza: Certezza });
const CampoNumero = z.object({ valore: z.number().nullable(), pagina: z.number().int(), certezza: Certezza });

const Generale = z.object({
  oggetto_lavori: CampoTesto,
  indirizzo: CampoTesto,
  appalto: z.object({ valore: z.enum(["pubblico", "privato", "non_indicato"]), pagina: z.number().int(), certezza: Certezza }),
  cig: CampoTesto,
  cup: CampoTesto,
  soggetti: z.array(
    z.object({
      ruolo: z.string().describe("Committente, Impresa esecutrice, Subappaltatore, Direttore dei Lavori, Direttore operativo, CSE, CSP, RUP, Progettista, Collaudatore…"),
      nome: z.string(),
      dettagli: z.string().describe("Sede, P.IVA, recapiti o iscrizione all'albo, se scritti; altrimenti vuoto."),
      pagina: z.number().int(),
      certezza: z.enum(["letto", "dedotto"]),
    }),
  ),
  contratto: z.object({
    importo: CampoNumero.describe("Importo contrattuale complessivo in euro."),
    oneri_sicurezza: CampoNumero,
    ribasso_percentuale: CampoNumero,
    ritenuta_percentuale: CampoNumero,
  }),
  date: z.object({ consegna_lavori: CampoTesto, durata_giorni: CampoNumero, ultimazione_prevista: CampoTesto }),
  lavorazioni: z.array(
    z.object({
      categoria: z.string().describe("Categoria o macro-lavorazione, es. «Opere strutturali», «OG1»."),
      descrizione: z.string(),
      pagina: z.number().int(),
    }),
  ),
  riepilogo: z.string().describe("Una frase su cosa contiene il documento."),
});

const CertezzaZona = z
  .enum(["letto", "dedotto", "assente"])
  .describe("letto se la zona è in una colonna o in un titolo; dedotto se la ricavi dalla descrizione; assente se non si capisce.");

const Voci = z.object({
  voci: z.array(
    z.object({
      wbs: z.string().describe("Codice della voce (tariffa, articolo o numero d'ordine); se manca, il numero d'ordine."),
      descrizione: z.string(),
      unita: z.string(),
      quantita: z.number().nullable(),
      prezzo: z.number().nullable(),
      importo: z.number().nullable(),
      zona: z
        .string()
        .describe("Zona, piano, unità o corpo: dalla colonna o dal titolo se c'è, altrimenti ricavata dalla descrizione («piano terra», «alloggio A-03», «corpo scala B»); vuoto se non si capisce."),
      zona_certezza: CertezzaZona,
      categoria: z
        .string()
        .describe("Categoria di lavorazione: dal titolo di capitolo se c'è, altrimenti dedotta dalla descrizione (es. «Scavi e fondazioni», «Strutture», «Murature», «Impianti elettrici», «Finiture»)."),
    }),
  ),
  anomalie: z
    .array(
      z.object({
        wbs: z.string(),
        tipo: z.enum(["quantita_anomala", "prezzo_anomalo", "duplicata", "altro"]),
        descrizione: z.string().describe("Una frase: cosa non torna e perché."),
      }),
    )
    .describe("Solo anomalie evidenti: prezzo strano per l'unità di misura o per la lavorazione, quantità incoerente con la descrizione, voce ripetuta. Non segnalare i conti quantità × prezzo: li controllo io."),
  riepilogo: z.string(),
});

const Attivita = z.object({
  attivita: z.array(
    z.object({
      wbs: z.string().describe("Codice o numero dell'attività; se manca, il numero d'ordine."),
      descrizione: z.string(),
      zona: z
        .string()
        .describe("Zona, piano o corpo: dalla colonna se c'è, altrimenti ricavata dalla descrizione; vuoto se non si capisce."),
      zona_certezza: CertezzaZona,
      inizio_previsto: z.string().describe("AAAA-MM-GG o vuoto."),
      fine_prevista: z.string().describe("AAAA-MM-GG o vuoto."),
    }),
  ),
  riepilogo: z.string(),
});

const Ambienti = z.object({
  ambienti: z.array(
    z.object({
      nome: z.string().describe("Nome dell'unità, ambiente o parte d'opera come scritto in pianta, es. «A-03», «Vano scala B»."),
      piano: z.string(),
      tipo: z.enum(TIPI_ZONA),
      pagina: z.number().int(),
    }),
  ),
  riepilogo: z.string(),
});

const Proposta = z.object({
  zone: z.array(
    z.object({
      nome: z.string(),
      piano: z.string(),
      tipo: z.enum(TIPI_ZONA),
      voci: z.array(z.string()).describe("Codici WBS delle voci di computo che riguardano la zona."),
      attivita: z.array(z.string()).describe("Codici WBS delle attività del programma che riguardano la zona."),
      ambiente: z.string().describe("Nome dell'ambiente di pianta corrispondente, se c'è; altrimenti vuoto."),
      note: z.string(),
      certezza: z.enum(["letto", "dedotto"]),
    }),
  ),
  voci_senza_zona: z.array(z.string()),
  decisioni: z.array(z.object({ domanda: z.string(), opzioni: z.array(z.string()) })),
  riepilogo: z.string(),
});

// ---------------------------------------------------------------------------
// Lettura per tipo di documento

function leggi(s: SchedaCantiere, d: DocumentoProgetto, consumo: Consumo): Promise<string> {
  switch (d.tipo) {
    case "computo":
      return leggiComputoProgetto(s, d, consumo);
    case "cronoprogramma":
      return leggiProgrammaProgetto(s, d, consumo);
    case "planimetria":
      return leggiPlanimetria(s, d, consumo);
    default:
      return leggiGenerale(s, d, consumo);
  }
}

const normalizza = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function leggiGenerale(s: SchedaCantiere, d: DocumentoProgetto, consumo: Consumo): Promise<string> {
  const risultati: z.infer<typeof Generale>[] = [];
  for (const p of await pezzi(s, d, PAGINE.testo)) {
    risultati.push(
      await estraiStrutturato({
        modello: MODELLO_DOCUMENTI,
        sforzo: "high",
        sistema: SISTEMA,
        contenuti: [
          intro(
            "generale",
            d,
            p,
            "Estrai oggetto dei lavori, indirizzo del cantiere, tipo di appalto, CIG/CUP, soggetti con il loro ruolo, dati economici del contratto, date contrattuali e lavorazioni previste.",
          ),
          ...p.contenuti,
        ],
        schema: Generale,
        maxToken: 16000,
        consumo,
      }),
    );
  }
  await scriviAtomico(fileEstratti(s, d), JSON.stringify({ generale: risultati }));
  const vecchio = sostituiti.get(d.id);
  const differenze = applicaGenerale(s, d, risultati, vecchio?.id);
  if (vecchio) {
    d.differenze = differenze;
    s.documenti = s.documenti.filter((x) => x.id !== vecchio.id);
  }
  const conteggi = [
    s.soggetti.filter((x) => x.fonte?.documento === d.id).length && `${s.soggetti.filter((x) => x.fonte?.documento === d.id).length} soggetti`,
    s.fonti["contratto.importo"]?.documento === d.id && s.contratto.importo !== null && `importo ${formatEuro(s.contratto.importo)}`,
    (s.fonti["date.consegnaLavori"]?.documento === d.id || s.fonti["date.ultimazionePrevista"]?.documento === d.id) && "date contrattuali",
    s.lavorazioni.filter((x) => x.fonte?.documento === d.id).length && `${s.lavorazioni.filter((x) => x.fonte?.documento === d.id).length} lavorazioni`,
  ].filter(Boolean);
  return conteggi.length ? conteggi.join(", ") : risultati[0]?.riepilogo || "Nessun dato utile trovato";
}

/** Riporta nella scheda i dati letti; restituisce cosa è cambiato rispetto a prima. */
function applicaGenerale(s: SchedaCantiere, d: DocumentoProgetto, risultati: z.infer<typeof Generale>[], sostituito?: string): string[] {
  const differenze: string[] = [];
  const puoScrivere = (chiave: string, attuale: string | number | null) =>
    attuale === null || attuale === "" || s.fonti[chiave]?.documento === d.id || (sostituito && s.fonti[chiave]?.documento === sostituito);
  const fonte = (pagina: number, certezza: "letto" | "dedotto"): Fonte => ({ documento: d.id, pagina: pagina || undefined, certezza });

  function testo(chiave: string, etichetta: string, attuale: string, nuovo: { valore: string; pagina: number; certezza: string }, imposta: (v: string) => void) {
    if (nuovo.certezza === "assente" || !nuovo.valore.trim() || !puoScrivere(chiave, attuale)) return;
    if (attuale && attuale !== nuovo.valore) differenze.push(`${etichetta}: «${attuale}» → «${nuovo.valore}»`);
    imposta(nuovo.valore.trim());
    s.fonti[chiave] = fonte(nuovo.pagina, nuovo.certezza as "letto" | "dedotto");
  }
  function numero(chiave: string, etichetta: string, attuale: number | null, nuovo: { valore: number | null; pagina: number; certezza: string }, imposta: (v: number) => void) {
    if (nuovo.certezza === "assente" || nuovo.valore === null || !puoScrivere(chiave, attuale)) return;
    if (attuale !== null && attuale !== nuovo.valore) differenze.push(`${etichetta}: ${attuale} → ${nuovo.valore}`);
    imposta(nuovo.valore);
    s.fonti[chiave] = fonte(nuovo.pagina, nuovo.certezza as "letto" | "dedotto");
  }

  for (const r of risultati) {
    testo("lavori", "Oggetto dei lavori", s.lavori, r.oggetto_lavori, (v) => (s.lavori = v));
    testo("indirizzo", "Indirizzo", s.indirizzo, r.indirizzo, (v) => (s.indirizzo = v));
    if (r.appalto.valore !== "non_indicato" && puoScrivere("appalto", s.fonti.appalto ? s.appalto : "")) {
      s.appalto = r.appalto.valore;
      s.fonti.appalto = fonte(r.appalto.pagina, r.appalto.certezza === "dedotto" ? "dedotto" : "letto");
    }
    testo("anagrafica.CIG", "CIG", s.anagrafica.CIG ?? "", r.cig, (v) => (s.anagrafica.CIG = v));
    testo("anagrafica.CUP", "CUP", s.anagrafica.CUP ?? "", r.cup, (v) => (s.anagrafica.CUP = v));
    numero("contratto.importo", "Importo contrattuale", s.contratto.importo, r.contratto.importo, (v) => (s.contratto.importo = v));
    numero("contratto.oneriSicurezza", "Oneri della sicurezza", s.contratto.oneriSicurezza, r.contratto.oneri_sicurezza, (v) => (s.contratto.oneriSicurezza = v));
    numero("contratto.ribassoPercentuale", "Ribasso", s.contratto.ribassoPercentuale, r.contratto.ribasso_percentuale, (v) => (s.contratto.ribassoPercentuale = v));
    numero("contratto.ritenutaPercentuale", "Ritenuta", s.contratto.ritenutaPercentuale, r.contratto.ritenuta_percentuale, (v) => (s.contratto.ritenutaPercentuale = v));
    testo("date.consegnaLavori", "Consegna lavori", s.date.consegnaLavori, r.date.consegna_lavori, (v) => (s.date.consegnaLavori = v));
    testo("date.ultimazionePrevista", "Ultimazione prevista", s.date.ultimazionePrevista, r.date.ultimazione_prevista, (v) => (s.date.ultimazionePrevista = v));
    numero("date.durataGiorni", "Durata", s.date.durataGiorni, r.date.durata_giorni, (v) => (s.date.durataGiorni = Math.round(v)));

    for (const x of r.soggetti) {
      if (!x.nome.trim() || !x.ruolo.trim()) continue;
      const chiave = `${normalizza(x.ruolo)}|${normalizza(x.nome)}`;
      const presente = s.soggetti.find((y) => `${normalizza(y.ruolo)}|${normalizza(y.nome)}` === chiave);
      if (presente) {
        if (!presente.dettagli && x.dettagli) presente.dettagli = x.dettagli.trim();
        continue;
      }
      const stessoRuolo = s.soggetti.find((y) => normalizza(y.ruolo) === normalizza(x.ruolo));
      if (stessoRuolo && sostituito && stessoRuolo.fonte?.documento === sostituito) {
        differenze.push(`${x.ruolo}: «${stessoRuolo.nome}» → «${x.nome}»`);
        Object.assign(stessoRuolo, { nome: x.nome.trim(), dettagli: x.dettagli.trim(), fonte: fonte(x.pagina, x.certezza) });
        continue;
      }
      if (sostituito) differenze.push(`Nuovo soggetto: ${x.ruolo} «${x.nome}»`);
      s.soggetti.push({ ruolo: x.ruolo.trim(), nome: x.nome.trim(), dettagli: x.dettagli.trim(), fonte: fonte(x.pagina, x.certezza) });
    }
    for (const l of r.lavorazioni) {
      if (!l.descrizione.trim() || s.lavorazioni.some((y) => normalizza(y.descrizione) === normalizza(l.descrizione))) continue;
      s.lavorazioni.push({ categoria: l.categoria.trim(), descrizione: l.descrizione.trim(), fonte: fonte(l.pagina, "letto") });
    }
  }
  // Le fonti del documento sostituito passano a quello nuovo.
  if (sostituito) {
    for (const [k, f] of Object.entries(s.fonti)) if (f.documento === sostituito) s.fonti[k] = { ...f, documento: d.id };
    for (const x of [...s.soggetti, ...s.lavorazioni]) if (x.fonte?.documento === sostituito) x.fonte = { ...x.fonte, documento: d.id };
  }
  return differenze;
}

async function leggiTabella<T>(
  s: SchedaCantiere,
  d: DocumentoProgetto,
  consumo: Consumo,
  obiettivo: "voci" | "attivita",
  schema: z.ZodType<T>,
  richiesta: string,
): Promise<T[]> {
  const risultati: T[] = [];
  for (const p of await pezzi(s, d, PAGINE.tabelle)) {
    risultati.push(
      await estraiStrutturato({
        modello: MODELLO_TABELLE,
        sforzo: "medium",
        sistema: SISTEMA,
        contenuti: [intro(obiettivo, d, p, richiesta), ...p.contenuti],
        schema,
        maxToken: 32000,
        consumo,
      }),
    );
  }
  return risultati;
}

/** L'export NowVision letto con il parser delle colonne: serve a riattaccare le colonne della piattaforma. */
async function seNowVision<T>(d: DocumentoProgetto, leggi: () => Promise<T>): Promise<T | null> {
  if (!d.file.endsWith(".xlsx")) return null;
  try {
    return await leggi();
  } catch {
    return null;
  }
}

const plurale = (n: number, uno: string, molti: string) => `${n} ${n === 1 ? uno : molti}`;

async function leggiComputoProgetto(s: SchedaCantiere, d: DocumentoProgetto, consumo: Consumo): Promise<string> {
  // Sempre l'IA: interpreta il computo, ricava zone e categorie e segnala le anomalie.
  const blocchi = await leggiTabella(
    s,
    d,
    consumo,
    "voci",
    Voci,
    "Leggi il computo metrico di quest'estratto e restituisci tutte le voci, una per riga, senza saltarne. Righe di titolo o di capitolo senza quantità non sono voci: usale come «categoria» delle voci che seguono. Se manca una colonna di zona, ricava la zona dalla descrizione («piano terra», «alloggio A-03», «corpo scala B») e segnala che è dedotta; se non si capisce lasciala vuota. Segnala solo le anomalie evidenti.",
  );
  const viste = new Set<string>();
  const vociIA = blocchi.flatMap((b) => b.voci).flatMap((v, i): VoceComputo[] => {
    const wbs = v.wbs.trim() || `V.${i + 1}`;
    const chiave = `${normWbs(wbs)}|${normalizza(v.descrizione)}`;
    if (viste.has(chiave) || !v.descrizione.trim()) return [];
    viste.add(chiave);
    const zona = v.zona_certezza === "assente" ? "" : v.zona.trim();
    return [
      {
        wbs,
        descrizione: v.descrizione.trim(),
        unita: v.unita.trim(),
        quantita: v.quantita,
        prezzo: v.prezzo,
        importo: v.importo,
        zone: zona ? [zona] : [],
        misuratoIA: null,
        costoRilevato: null,
        affidabilitaIA: null,
        categoria: v.categoria.trim(),
        zonaDedotta: Boolean(zona) && v.zona_certezza === "dedotto",
      },
    ];
  });
  const dalFile = await seNowVision(d, () => leggiComputo(fileDocumento(s, d)));
  const { voci, recuperate } = dalFile ? riattaccaColonne(vociIA, dalFile) : { voci: vociIA, recuperate: 0 };
  if (voci.length === 0) throw new Error("Il documento non sembra un computo: non ho trovato voci.");

  const codici = new Set(voci.map((v) => v.wbs));
  const anomalie = uniscAnomalie(
    [blocchi.flatMap((b) => b.anomalie).filter((a) => codici.has(a.wbs) && a.descrizione.trim()), controllaConti(voci)],
    [],
  );
  await scriviAtomico(fileEstratti(s, d), JSON.stringify({ voci, anomalie }));
  await sostituisciVecchio(s, d);
  await ricomponi(s, "computo");

  const totale = voci.reduce((t, v) => t + (v.importo ?? 0), 0);
  const categorie = new Set(voci.map((v) => v.categoria).filter(Boolean)).size;
  const dedotte = voci.filter((v) => v.zonaDedotta).length;
  return [
    plurale(voci.length, "voce", "voci"),
    totale ? formatEuro(totale) : "",
    categorie ? plurale(categorie, "categoria", "categorie") : "",
    dedotte ? `zona dedotta per ${plurale(dedotte, "voce", "voci")}` : "",
    anomalie.length ? `${plurale(anomalie.length, "anomalia", "anomalie")} da controllare` : "nessuna anomalia",
    recuperate ? `${plurale(recuperate, "voce recuperata", "voci recuperate")} dal file` : "",
  ]
    .filter(Boolean)
    .join(", ")
    .concat(dalFile ? " (export NowVision: colonne della piattaforma riattaccate)" : "");
}

async function leggiProgrammaProgetto(s: SchedaCantiere, d: DocumentoProgetto, consumo: Consumo): Promise<string> {
  const blocchi = await leggiTabella(
    s,
    d,
    consumo,
    "attivita",
    Attivita,
    "Leggi il cronoprogramma di quest'estratto e restituisci tutte le attività con date previste di inizio e fine. Righe di gruppo senza date: usale come prefisso nella descrizione delle attività che contengono. Se manca una colonna di zona, ricava la zona dalla descrizione e segnala che è dedotta.",
  );
  const iso = (t: string) => (/^\d{4}-\d{2}-\d{2}$/.test(t.trim()) ? t.trim() : null);
  const attivitaIA = blocchi
    .flatMap((b) => b.attivita)
    .filter((a) => a.descrizione.trim())
    .map((a, i): AttivitaProgramma => {
      const zona = a.zona_certezza === "assente" ? "" : a.zona.trim();
      return {
        wbs: a.wbs.trim() || `A.${i + 1}`,
        descrizione: a.descrizione.trim(),
        zone: zona ? [zona] : [],
        inizioPrevisto: iso(a.inizio_previsto),
        finePrevista: iso(a.fine_prevista),
        inizioEffettivo: null,
        fineEffettiva: null,
        avanzamento: null,
        note: "",
        zonaDedotta: Boolean(zona) && a.zona_certezza === "dedotto",
      };
    });
  const dalFile = await seNowVision(d, () => leggiProgramma(fileDocumento(s, d)));
  const { attivita, recuperate } = dalFile ? riattaccaAttivita(attivitaIA, dalFile.attivita) : { attivita: attivitaIA, recuperate: 0 };
  if (attivita.length === 0) throw new Error("Il documento non sembra un cronoprogramma: non ho trovato attività.");
  const dati = { attivita, note: dalFile?.note ?? [] };
  await scriviAtomico(fileEstratti(s, d), JSON.stringify(dati));
  await sostituisciVecchio(s, d);
  await ricomponi(s, "cronoprogramma");
  const date = attivita.flatMap((a) => [a.inizioPrevisto, a.finePrevista]).filter((x): x is string => Boolean(x)).sort();
  const dataIt = (x: string) => x.split("-").reverse().join("/");
  const dedotte = attivita.filter((a) => a.zonaDedotta).length;
  return [
    plurale(attivita.length, "attività", "attività"),
    date.length ? `dal ${dataIt(date[0])} al ${dataIt(date.at(-1)!)}` : "",
    dedotte ? `zona dedotta per ${plurale(dedotte, "attività", "attività")}` : "",
    recuperate ? `${plurale(recuperate, "attività recuperata", "attività recuperate")} dal file` : "",
  ]
    .filter(Boolean)
    .join(", ")
    .concat(dalFile ? " (export NowVision: date effettive e avanzamento riattaccati)" : "");
}

async function leggiPlanimetria(s: SchedaCantiere, d: DocumentoProgetto, consumo: Consumo): Promise<string> {
  const ambienti: (z.infer<typeof Ambienti>["ambienti"][number] & { documento: string })[] = [];
  for (const p of await pezzi(s, d, PAGINE.disegni)) {
    const r = await estraiStrutturato({
      modello: MODELLO_DOCUMENTI,
      sforzo: "high",
      sistema: SISTEMA,
      contenuti: [
        intro(
          "ambienti",
          d,
          p,
          "Elenca le unità, gli ambienti e le parti d'opera riconoscibili nelle tavole (alloggi, locali, corpi scala, autorimessa, coperture, facciate, aree esterne), con il piano. Usa i nomi scritti in pianta; non inventare numerazioni.",
        ),
        ...p.contenuti,
      ],
      schema: Ambienti,
      maxToken: 16000,
      consumo,
    });
    ambienti.push(...r.ambienti.filter((a) => a.nome.trim()).map((a) => ({ ...a, documento: d.id })));
  }
  await scriviAtomico(fileEstratti(s, d), JSON.stringify({ ambienti }));
  await sostituisciVecchio(s, d);
  const piani = new Set(ambienti.map((a) => a.piano).filter(Boolean)).size;
  return ambienti.length ? `${ambienti.length} ambienti${piani ? ` su ${piani} piani` : ""}` : "Nessun ambiente riconoscibile";
}

/** Una nuova versione prende il posto della precedente, che si toglie dalla scheda. */
async function sostituisciVecchio(s: SchedaCantiere, d: DocumentoProgetto) {
  const vecchio = sostituiti.get(d.id);
  if (!vecchio) return;
  const prima = await leggiEstratti(s, vecchio);
  const dopo = await leggiEstratti(s, d);
  d.differenze = confronta(prima, dopo);
  if (s.zone.length && (dopo.voci || dopo.attivita) && !d.differenze[0]?.startsWith("Nessuna")) {
    d.differenze.push("le zone collegano ancora i codici della versione precedente: rifai la proposta delle zone o correggile");
  }
  s.documenti = s.documenti.filter((x) => x.id !== vecchio.id);
  await fs.rm(fileEstratti(s, vecchio), { force: true });
}

type Estratti = {
  voci?: VoceComputo[];
  anomalie?: AnomaliaComputo[];
  attivita?: AttivitaProgramma[];
  ambienti?: { nome: string; piano: string }[];
};

async function leggiEstratti(s: SchedaCantiere, d: DocumentoProgetto): Promise<Estratti> {
  try {
    return JSON.parse(await fs.readFile(fileEstratti(s, d), "utf8")) as Estratti;
  } catch {
    return {};
  }
}

function confronta(prima: Estratti, dopo: Estratti): string[] {
  const righe: string[] = [];
  const insiemi = (a: { wbs: string }[] = [], b: { wbs: string }[] = []) => {
    const A = new Map(a.map((x) => [x.wbs, x]));
    const B = new Map(b.map((x) => [x.wbs, x]));
    return { aggiunte: [...B.keys()].filter((k) => !A.has(k)), tolte: [...A.keys()].filter((k) => !B.has(k)), A, B };
  };
  if (prima.voci || dopo.voci) {
    const { aggiunte, tolte, A, B } = insiemi(prima.voci, dopo.voci);
    const cambiate = [...B.keys()].filter((k) => A.has(k) && (A.get(k) as VoceComputo).quantita !== (B.get(k) as VoceComputo).quantita);
    if (aggiunte.length) righe.push(`${aggiunte.length} voci nuove (${aggiunte.slice(0, 5).join(", ")}${aggiunte.length > 5 ? "…" : ""})`);
    if (tolte.length) righe.push(`${tolte.length} voci tolte (${tolte.slice(0, 5).join(", ")}${tolte.length > 5 ? "…" : ""})`);
    if (cambiate.length) righe.push(`${cambiate.length} voci con quantità cambiata (${cambiate.slice(0, 5).join(", ")}${cambiate.length > 5 ? "…" : ""})`);
  }
  if (prima.attivita || dopo.attivita) {
    const { aggiunte, tolte, A, B } = insiemi(prima.attivita, dopo.attivita);
    const spostate = [...B.keys()].filter((k) => {
      const [a, b] = [A.get(k) as AttivitaProgramma | undefined, B.get(k) as AttivitaProgramma];
      return a && (a.inizioPrevisto !== b.inizioPrevisto || a.finePrevista !== b.finePrevista);
    });
    if (aggiunte.length) righe.push(`${aggiunte.length} attività nuove`);
    if (tolte.length) righe.push(`${tolte.length} attività tolte`);
    if (spostate.length) righe.push(`${spostate.length} attività con date cambiate (${spostate.slice(0, 5).join(", ")}${spostate.length > 5 ? "…" : ""})`);
  }
  if (prima.ambienti || dopo.ambienti) {
    const n = (x?: { nome: string }[]) => new Set((x ?? []).map((a) => a.nome));
    const [a, b] = [n(prima.ambienti), n(dopo.ambienti)];
    const nuovi = [...b].filter((x) => !a.has(x)).length;
    const tolti = [...a].filter((x) => !b.has(x)).length;
    if (nuovi) righe.push(`${nuovi} ambienti nuovi`);
    if (tolti) righe.push(`${tolti} ambienti non più presenti`);
  }
  return righe.length ? righe : ["Nessuna differenza nei dati letti"];
}

/** Computo o programma del cantiere: l'unione dei documenti letti di quel tipo. */
async function ricomponi(s: SchedaCantiere, tipo: "computo" | "cronoprogramma") {
  const documenti = s.documenti.filter((x) => x.tipo === tipo);
  const estratti = await Promise.all(documenti.map((x) => leggiEstratti(s, x)));
  const nome = documenti.map((x) => x.nome).join(", ");
  if (tipo === "computo") {
    const voci = estratti.flatMap((e) => e.voci ?? []);
    if (voci.length) await salvaEstratti(s.id, "computo", nome, voci);
    else await rimuoviEstratti(s.id, "computo");
    s.anomalie = uniscAnomalie(estratti.map((e) => e.anomalie ?? []), s.anomalieIgnorate);
  } else {
    const attivita = estratti.flatMap((e) => e.attivita ?? []);
    if (attivita.length) await salvaEstratti(s.id, "cronoprogramma", nome, { attivita, note: [] });
    else await rimuoviEstratti(s.id, "cronoprogramma");
  }
}

// ---------------------------------------------------------------------------
// Proposta delle zone

const taglia = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function slugZona(nome: string, usati: Set<string>): string {
  const base = `z-${normalizza(nome).replace(/ /g, "-").slice(0, 40) || "zona"}`;
  let id = base;
  for (let i = 2; usati.has(id); i++) id = `${base}-${i}`;
  usati.add(id);
  return id;
}

/** Propone le zone dai dati letti. In background: l'interfaccia vede `zoneInPreparazione`. */
export async function proponiZone(s: SchedaCantiere, personaId: string) {
  const nv = await datiNowVision(s.id);
  const planimetrie = s.documenti.filter((d) => d.tipo === "planimetria" && d.stato === "letto");
  const ambienti = (await Promise.all(planimetrie.map((d) => leggiEstratti(s, d)))).flatMap(
    (e) => (e.ambienti ?? []) as { nome: string; piano: string; tipo: string; pagina: number; documento: string }[],
  );
  const voci = nv.computo?.voci ?? [];
  const attivita = nv.programma?.attivita ?? [];
  if (!voci.length && !attivita.length && !ambienti.length) return;

  s.zoneInPreparazione = true;
  await salvaScheda(s);
  const consumo = consumoVuoto();
  const inizio = Date.now();
  let errore: string | undefined;
  try {
    const righe = [
      `[estrazione:zone] Cantiere «${s.nome}»${s.lavori ? `: ${s.lavori}` : ""}.`,
      "Proponi le zone in cui seguire l'avanzamento dei lavori e i sopralluoghi. Una zona è un'unità, un piano, un corpo scala, una facciata, l'esterno o una parte d'opera come le strutture: deve servire a ritrovare le voci di computo e le attività del programma che la riguardano. Ogni voce e attività va in al massimo una zona; quelle che non riesci ad assegnare vanno in voci_senza_zona. Nelle decisioni metti le scelte che spettano all'utente (es. seguire le unità una per una o per piano), al massimo tre, con due o tre opzioni ciascuna.",
      nv.zone.length ? `Zone già indicate nei file del cantiere (usa questi nomi): ${nv.zone.join(", ")}.` : "",
      voci.length ? `\n## Voci di computo (wbs | descrizione | zona indicata)\n${voci.slice(0, 900).map((v) => `${v.wbs} | ${taglia(v.descrizione, 90)} | ${v.zone.join(", ")}${v.zonaDedotta ? " (dedotta)" : ""}`).join("\n")}` : "",
      attivita.length ? `\n## Attività del cronoprogramma (wbs | descrizione | zona | inizio | fine)\n${attivita.slice(0, 300).map((a) => `${a.wbs} | ${taglia(a.descrizione, 90)} | ${a.zone.join(", ")} | ${a.inizioPrevisto ?? ""} | ${a.finePrevista ?? ""}`).join("\n")}` : "",
      ambienti.length ? `\n## Ambienti dalle planimetrie (nome | piano | tipo)\n${ambienti.slice(0, 300).map((a) => `${a.nome} | ${a.piano} | ${a.tipo}`).join("\n")}` : "",
      s.lavorazioni.length ? `\n## Lavorazioni previste dal contratto\n${s.lavorazioni.slice(0, 60).map((l) => `- ${l.categoria}: ${l.descrizione}`).join("\n")}` : "",
    ].filter(Boolean);
    const r = await estraiStrutturato({
      modello: MODELLO_DOCUMENTI,
      sforzo: "high",
      sistema: SISTEMA,
      contenuti: [{ type: "text", text: righe.join("\n") }],
      schema: Proposta,
      maxToken: 32000,
      consumo,
    });
    const wbsVoci = new Set(voci.map((v) => v.wbs));
    const wbsAttivita = new Set(attivita.map((a) => a.wbs));
    const usati = new Set<string>();
    s.zone = r.zone
      .filter((z) => z.nome.trim())
      .map((z): Zona => {
        const ambiente = ambienti.find((a) => z.ambiente && normalizza(a.nome) === normalizza(z.ambiente));
        return {
          id: slugZona(z.nome, usati),
          nome: z.nome.trim(),
          piano: z.piano.trim(),
          tipo: z.tipo,
          vociComputo: [...new Set(z.voci.filter((w) => wbsVoci.has(w)))],
          attivita: [...new Set(z.attivita.filter((w) => wbsAttivita.has(w)))],
          ...(ambiente ? { planimetria: { documento: ambiente.documento, pagina: ambiente.pagina || undefined } } : {}),
          note: z.note.trim(),
          certezza: z.certezza,
        };
      });
    const assegnate = new Set(s.zone.flatMap((z) => z.vociComputo));
    s.vociSenzaZona = [...new Set([...r.voci_senza_zona.filter((w) => wbsVoci.has(w)), ...[...wbsVoci].filter((w) => !assegnate.has(w))])];
    s.decisioni = r.decisioni
      .filter((x) => x.domanda.trim())
      .slice(0, 3)
      .map((x, i) => ({ id: `d-${i + 1}`, domanda: x.domanda.trim(), opzioni: x.opzioni.slice(0, 4), risposta: "" }));
  } catch (e) {
    errore = messaggioErrore(e);
    console.error("Proposta delle zone:", e);
  } finally {
    s.zoneInPreparazione = false;
    await salvaScheda(s);
  }
  void registra({
    persona: personaId,
    tipo: "onboarding",
    cantiere: s.id,
    esito: errore ? "errore" : "ok",
    modalita: "zone",
    dettaglio: errore ? `${s.nome}: ${errore}` : s.nome,
    costo: consumo.costo,
    durataMs: Date.now() - inizio,
    modello: consumo.modello || undefined,
  });
}

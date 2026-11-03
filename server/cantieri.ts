// Cantieri creati con l'onboarding: una scheda per cantiere in data/cantieri/<id>/scheda.json,
// con i documenti di progetto in data/cantieri/<id>/documenti/. I cantieri di esempio di
// shared/cantieri.ts restano risolvibili (per le conversazioni già fatte) ma si vedono e si
// usano solo in demo e in sviluppo.

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as z from "zod";
import {
  CANTIERI,
  TIPI_ZONA,
  breveDi,
  esempio,
  type Cantiere,
  type CantiereBreve,
  type SchedaCantiere,
} from "../shared/cantieri";
import { ACCESSO_LIBERO } from "./ambiente";
import { CARTELLA_DATI, leggiJson, scriviAtomico } from "./archivio-json";

const CARTELLA = path.join(CARTELLA_DATI, "cantieri");
export const ID_CANTIERE = /^[a-z0-9-]+$/;

const schede = new Map<string, SchedaCantiere>();

export function cartellaCantiere(id: string): string {
  if (!ID_CANTIERE.test(id)) throw new Error("Cantiere non valido");
  return path.join(CARTELLA, id);
}

const fileScheda = (id: string) => path.join(cartellaCantiere(id), "scheda.json");

function nuovaScheda(base: Partial<Cantiere> & { id: string; nome: string }, creatoDa: string): SchedaCantiere {
  const ora = new Date().toISOString();
  return {
    breve: base.nome.slice(0, 24),
    indirizzo: "",
    appalto: "privato",
    lavori: "",
    anagrafica: {},
    persone: [],
    ...base,
    scheda: true,
    stato: "bozza",
    creatoDa,
    creatoIl: ora,
    aggiornataIl: ora,
    soggetti: [],
    contratto: { importo: null, oneriSicurezza: null, ribassoPercentuale: null, ritenutaPercentuale: null },
    date: { consegnaLavori: "", durataGiorni: null, ultimazionePrevista: "" },
    lavorazioni: [],
    zone: [],
    vociSenzaZona: [],
    decisioni: [],
    documenti: [],
    fonti: {},
  };
}

export async function caricaCantieri() {
  await fs.mkdir(CARTELLA, { recursive: true });
  for (const id of await fs.readdir(CARTELLA)) {
    if (!ID_CANTIERE.test(id)) continue;
    const s = await leggiJson<SchedaCantiere | null>(fileScheda(id), null);
    if (s?.scheda) schede.set(id, s);
  }
  await convertiIncanto();
}

/**
 * Residenze Incanto aveva già dati NowVision caricati quando i cantieri erano fissi nel
 * codice: diventa un cantiere vero (attivo) così conversazioni e riprese restano valide.
 */
async function convertiIncanto() {
  const statico = esempio("residenze-incanto");
  if (!statico || schede.has(statico.id)) return;
  try {
    await fs.access(path.join(CARTELLA_DATI, "nowvision", statico.id, "indice.json"));
  } catch {
    return;
  }
  const s = nuovaScheda(
    {
      ...statico,
      indirizzo: statico.indirizzo.startsWith("[") ? "" : statico.indirizzo,
      anagrafica: Object.fromEntries(Object.entries(statico.anagrafica).filter(([, v]) => !v.startsWith("["))),
    },
    "admin",
  );
  s.stato = "attiva";
  s.confermataIl = s.creatoIl;
  s.soggetti = Object.entries(s.anagrafica).map(([ruolo, nome]) => ({ ruolo, nome, dettagli: "" }));
  await salvaScheda(s);
}

export async function salvaScheda(s: SchedaCantiere) {
  s.aggiornataIl = new Date().toISOString();
  // I soggetti alimentano anche le «persone ricorrenti» del prompt e dei menu.
  s.persone = s.soggetti.filter((x) => x.nome).map((x) => ({ nome: x.nome, ruolo: x.ruolo }));
  schede.set(s.id, s);
  await scriviAtomico(fileScheda(s.id), JSON.stringify(s, null, 2));
}

export function scheda(id: string): SchedaCantiere | null {
  return schede.get(id) ?? null;
}

/** Il cantiere con questo id, anche se di esempio: serve a mostrare conversazioni già fatte. */
export function trovaCantiere(id: string | undefined): Cantiere | null {
  if (!id) return null;
  return schede.get(id) ?? esempio(id) ?? null;
}

/** Nome breve da mostrare, anche per un cantiere che non esiste più. */
export function breveCantiere(id: string | undefined): string {
  return trovaCantiere(id)?.breve ?? "cantiere non più disponibile";
}

export function nomeCantiere(id: string | undefined): string {
  return trovaCantiere(id)?.nome ?? "Cantiere non più disponibile";
}

/** I cantieri utilizzabili: le schede, più gli esempi solo in demo e in sviluppo. */
export function idVisibili(): string[] {
  const esempi = ACCESSO_LIBERO ? CANTIERI.map((c) => c.id).filter((id) => !schede.has(id)) : [];
  return [...esempi, ...schede.keys()];
}

export function esisteCantiere(id: string): boolean {
  return idVisibili().includes(id);
}

export function elencoBreve(ids: string[]): CantiereBreve[] {
  return ids.flatMap((id) => {
    const c = trovaCantiere(id);
    return c ? [breveDi(c)] : [];
  });
}

function slug(testo: string): string {
  return (
    testo
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "cantiere"
  );
}

export async function creaCantiere(nome: string, creatoDa: string): Promise<SchedaCantiere> {
  const pulito = nome.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!pulito) throw new Error("Serve il nome del cantiere.");
  const id = `${slug(pulito)}-${randomBytes(2).toString("hex")}`;
  const s = nuovaScheda({ id, nome: pulito }, creatoDa);
  await fs.mkdir(path.join(cartellaCantiere(id), "documenti"), { recursive: true });
  await salvaScheda(s);
  return s;
}

// ---------------------------------------------------------------------------
// Modifiche dall'interfaccia: solo i campi che l'utente può correggere.

const FonteZ = z.object({
  documento: z.string(),
  pagina: z.number().int().optional(),
  certezza: z.enum(["letto", "dedotto"]),
});

const testo = (massimo: number) => z.string().transform((t) => t.replace(/[ \t]+/g, " ").trim().slice(0, massimo));
const numeroONull = z.number().finite().nullable();

const Modifiche = z
  .object({
    nome: testo(100).refine((t) => t.length > 0, "Serve il nome del cantiere."),
    breve: testo(30),
    indirizzo: testo(160),
    appalto: z.enum(["pubblico", "privato"]),
    lavori: testo(600),
    anagrafica: z.record(testo(60), testo(200)),
    soggetti: z
      .array(z.object({ ruolo: testo(80), nome: testo(160), dettagli: testo(300), fonte: FonteZ.optional() }))
      .max(60),
    contratto: z.object({
      importo: numeroONull,
      oneriSicurezza: numeroONull,
      ribassoPercentuale: numeroONull,
      ritenutaPercentuale: numeroONull,
    }),
    date: z.object({
      consegnaLavori: testo(10),
      durataGiorni: z.number().int().nonnegative().nullable(),
      ultimazionePrevista: testo(10),
    }),
    lavorazioni: z
      .array(z.object({ categoria: testo(80), descrizione: testo(300), fonte: FonteZ.optional() }))
      .max(120),
    fonti: z.record(z.string(), FonteZ),
    zone: z
      .array(
        z.object({
          id: z.string().regex(/^z-[a-z0-9-]+$/),
          nome: testo(80).refine((t) => t.length > 0, "Ogni zona ha bisogno di un nome."),
          piano: testo(40),
          tipo: z.enum(TIPI_ZONA),
          vociComputo: z.array(testo(40)).max(2000),
          attivita: z.array(testo(40)).max(500),
          planimetria: z.object({ documento: z.string(), pagina: z.number().int().optional() }).optional(),
          note: testo(300),
          certezza: z.enum(["letto", "dedotto"]),
        }),
      )
      .max(200),
    vociSenzaZona: z.array(testo(40)).max(2000),
    decisioni: z
      .array(z.object({ id: z.string(), domanda: testo(300), opzioni: z.array(testo(120)).max(6), risposta: testo(200) }))
      .max(20),
  })
  .partial();

export type ModificheScheda = z.input<typeof Modifiche>;

export async function aggiornaScheda(id: string, dati: unknown): Promise<SchedaCantiere> {
  const s = schede.get(id);
  if (!s) throw new Error("Cantiere non trovato.");
  const r = Modifiche.safeParse(dati);
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Dati della scheda non validi.");
  Object.assign(s, r.data);
  // Un valore corretto a mano non è più «dedotto»: la fonte resta, ma come letta dall'utente.
  await salvaScheda(s);
  return s;
}

export async function confermaScheda(id: string): Promise<SchedaCantiere> {
  const s = schede.get(id);
  if (!s) throw new Error("Cantiere non trovato.");
  if (s.documenti.some((d) => d.stato === "in_coda" || d.stato === "in_lettura")) {
    throw new Error("Aspetta che finisca la lettura dei documenti.");
  }
  s.stato = "attiva";
  s.confermataIl = new Date().toISOString();
  await salvaScheda(s);
  return s;
}

export function tutteLeSchede(): SchedaCantiere[] {
  return [...schede.values()];
}

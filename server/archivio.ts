// Conversazioni e foto su disco, in `data/`. Un file JSON per conversazione:
// contiene sia ciò che vede l'interfaccia sia la cronologia esatta inviata all'API,
// che cresce solo in coda (i blocchi di thinking restano validi tra un turno e l'altro).

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Conversazione, ConversazioneMeta, Messaggio } from "../shared/schema";

const CARTELLA_DATI = path.resolve(process.env.REDATTORE_DATI ?? "data");
const CARTELLA_CONVERSAZIONI = path.join(CARTELLA_DATI, "conversazioni");
const CARTELLA_FOTO = path.join(CARTELLA_DATI, "foto");

export interface ConversazioneSalvata extends Conversazione {
  sistema: string;
  apiMessaggi: BetaMessageParam[];
  /** Per ogni messaggio utente, la posizione in `apiMessaggi` da cui parte il suo turno. */
  inizioTurno: Record<string, number>;
  contatoreFoto: number;
  /** Note per il modello da anteporre al prossimo messaggio del DL. */
  notePendenti: string[];
  /** Versione dei dati NowVision già inviata al modello (date di caricamento dei file). */
  nowvisionInviato?: string;
  /** Chi l'ha creata. Le conversazioni senza proprietario sono dell'amministratore. */
  personaId?: string;
}

export interface FotoSalvata {
  id: string;
  nome: string;
  ora: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export async function preparaCartelle() {
  await fs.mkdir(CARTELLA_CONVERSAZIONI, { recursive: true });
  await fs.mkdir(CARTELLA_FOTO, { recursive: true });
}

const ID_VALIDO = /^[a-zA-Z0-9-]+$/;

function fileConversazione(id: string) {
  if (!ID_VALIDO.test(id)) throw new Error("Id non valido");
  return path.join(CARTELLA_CONVERSAZIONI, `${id}.json`);
}

async function scriviAtomico(file: string, contenuto: string | Buffer) {
  const temporaneo = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporaneo, contenuto);
  await fs.rename(temporaneo, file);
}

export function meta(c: Conversazione): ConversazioneMeta {
  const { id, titolo, modalita, cantiereId, creataIl, aggiornataIl } = c;
  return { id, titolo, modalita, cantiereId, creataIl, aggiornataIl };
}

/** Ciò che l'interfaccia riceve: senza prompt né cronologia API. */
export function perInterfaccia(c: ConversazioneSalvata): Conversazione {
  const { sistema, apiMessaggi, inizioTurno, contatoreFoto, notePendenti, nowvisionInviato, personaId, ...resto } = c;
  return resto;
}

export function proprietario(c: ConversazioneSalvata): string {
  return c.personaId ?? "admin";
}

export function nuovaConversazione(
  dati: Pick<Conversazione, "titolo" | "modalita" | "cantiereId"> & { sistema: string; personaId: string },
): ConversazioneSalvata {
  const ora = new Date().toISOString();
  return {
    id: randomUUID(),
    ...dati,
    creataIl: ora,
    aggiornataIl: ora,
    messaggi: [],
    modificheManuali: {},
    apiMessaggi: [],
    inizioTurno: {},
    contatoreFoto: 0,
    notePendenti: [],
  };
}

export async function salva(c: ConversazioneSalvata) {
  c.aggiornataIl = new Date().toISOString();
  await scriviAtomico(fileConversazione(c.id), JSON.stringify(c));
}

export async function leggi(id: string): Promise<ConversazioneSalvata | null> {
  try {
    return JSON.parse(await fs.readFile(fileConversazione(id), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function tutte(): Promise<ConversazioneSalvata[]> {
  const file = (await fs.readdir(CARTELLA_CONVERSAZIONI)).filter((f) => f.endsWith(".json"));
  const lette = await Promise.all(file.map((f) => leggi(f.slice(0, -5)).catch(() => null)));
  return lette.filter((c): c is ConversazioneSalvata => c !== null && c.messaggi.length > 0);
}

function testoCercabile(m: Messaggio): string {
  if (m.ruolo === "utente") return m.testo;
  return m.parti
    .map((p) => (p.tipo === "testo" ? p.testo : p.tipo === "documento" ? p.documento.titolo : ""))
    .join(" ");
}

export async function elenco(personaId: string, cerca?: string): Promise<ConversazioneMeta[]> {
  const ago = cerca?.trim().toLowerCase();
  return (await tutte())
    .filter((c) => proprietario(c) === personaId)
    .filter(
      (c) =>
        !ago ||
        c.titolo.toLowerCase().includes(ago) ||
        c.messaggi.some((m) => testoCercabile(m).toLowerCase().includes(ago)),
    )
    .map(meta)
    .sort((a, b) => b.aggiornataIl.localeCompare(a.aggiornataIl));
}

// ---------------------------------------------------------------------------
// Foto

const ESTENSIONI: Record<FotoSalvata["mediaType"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function salvaFoto(dataUrl: string, nome: string, ora: string): Promise<FotoSalvata> {
  const corrispondenza = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!corrispondenza) throw new Error("Formato immagine non supportato");
  const mediaType = corrispondenza[1] as FotoSalvata["mediaType"];
  const foto: FotoSalvata = { id: randomUUID(), nome, ora, mediaType };
  await scriviAtomico(
    path.join(CARTELLA_FOTO, `${foto.id}.${ESTENSIONI[mediaType]}`),
    Buffer.from(corrispondenza[2], "base64"),
  );
  await scriviAtomico(path.join(CARTELLA_FOTO, `${foto.id}.json`), JSON.stringify(foto));
  return foto;
}

export async function leggiFoto(id: string): Promise<{ foto: FotoSalvata; file: string } | null> {
  if (!ID_VALIDO.test(id)) return null;
  try {
    const foto: FotoSalvata = JSON.parse(
      await fs.readFile(path.join(CARTELLA_FOTO, `${id}.json`), "utf8"),
    );
    return { foto, file: path.join(CARTELLA_FOTO, `${id}.${ESTENSIONI[foto.mediaType]}`) };
  } catch {
    return null;
  }
}

export function urlFoto(id: string) {
  return `/api/foto/${id}`;
}

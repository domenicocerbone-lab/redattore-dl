// Firme grafiche delle persone. L'immagine PNG si salva per contenuto in data/firme/<hash>.png:
// chi rifà la firma non cambia quelle già apposte. I dati per persona stanno in data/firme.json.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FirmaProfilo } from "../shared/accessi";
import { ArchivioJson, CARTELLA_DATI, scriviAtomico } from "./archivio-json";

const CARTELLA = path.join(CARTELLA_DATI, "firme");
const archivio = new ArchivioJson<Record<string, FirmaProfilo>>(path.join(CARTELLA_DATI, "firme.json"), () => ({}));
const HASH_VALIDO = /^[a-f0-9]{64}$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MASSIMO_BYTE = 400 * 1024;

export async function caricaFirme() {
  await fs.mkdir(CARTELLA, { recursive: true });
  await archivio.carica();
}

export function firmaDi(personaId: string): FirmaProfilo | null {
  return archivio.valore[personaId] ?? null;
}

export interface DatiFirma {
  /** data:image/png;base64,… preparata dal browser (sfondo trasparente, ritagliata). Facoltativa se la firma c'è già. */
  immagine?: string;
  nome: string;
  titolo: string;
  albo: string;
}

const testo = (v: unknown, massimo: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, massimo) : "");

export async function salvaFirma(personaId: string, dati: DatiFirma): Promise<FirmaProfilo> {
  const nome = testo(dati.nome, 80);
  if (!nome) throw new Error("Serve il nome per esteso.");
  let hash = archivio.valore[personaId]?.hash;
  if (dati.immagine !== undefined) {
    const corrispondenza = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dati.immagine);
    const byte = corrispondenza ? Buffer.from(corrispondenza[1], "base64") : null;
    if (!byte || !byte.subarray(0, 8).equals(PNG)) throw new Error("L'immagine della firma deve essere un PNG.");
    if (byte.length > MASSIMO_BYTE) throw new Error("L'immagine della firma è troppo grande.");
    hash = createHash("sha256").update(byte).digest("hex");
    const file = path.join(CARTELLA, `${hash}.png`);
    try {
      await fs.access(file);
    } catch {
      await scriviAtomico(file, byte);
    }
  }
  if (!hash) throw new Error("Disegna o carica la firma.");
  const firma: FirmaProfilo = {
    hash,
    nome,
    titolo: testo(dati.titolo, 20),
    albo: testo(dati.albo, 120),
    aggiornataIl: new Date().toISOString(),
  };
  archivio.valore[personaId] = firma;
  await archivio.salva();
  return firma;
}

/** Toglie la firma dal profilo; le immagini restano per i documenti già firmati. */
export async function eliminaFirma(personaId: string) {
  delete archivio.valore[personaId];
  await archivio.salva();
}

export function fileFirma(hash: string): string | null {
  return HASH_VALIDO.test(hash) ? path.join(CARTELLA, `${hash}.png`) : null;
}

/** L'immagine incorporata nel PDF, dove la rete è chiusa. */
export async function firmaComeDataUrl(hash: string): Promise<string | null> {
  const file = fileFirma(hash);
  if (!file) return null;
  try {
    return `data:image/png;base64,${(await fs.readFile(file)).toString("base64")}`;
  } catch {
    return null;
  }
}

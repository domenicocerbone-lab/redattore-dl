// Scritture su file sicure anche in parallelo: file temporaneo con nome unico, poi rename,
// e una coda per file così due salvataggi ravvicinati non si sovrappongono.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const CARTELLA_DATI = path.resolve(process.env.REDATTORE_DATI ?? "data");

const code = new Map<string, Promise<void>>();

export function scriviAtomico(file: string, contenuto: string | Buffer): Promise<void> {
  const precedente = code.get(file) ?? Promise.resolve();
  const scrittura = precedente
    .catch(() => undefined)
    .then(async () => {
      const temporaneo = `${file}.${process.pid}.${randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(temporaneo, contenuto);
      await fs.rename(temporaneo, file);
    });
  code.set(file, scrittura);
  void scrittura.finally(() => {
    if (code.get(file) === scrittura) code.delete(file);
  });
  return scrittura;
}

export async function leggiJson<T>(file: string, vuoto: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return vuoto;
    throw e;
  }
}

/** Dati piccoli tenuti in memoria e salvati interi a ogni modifica. */
export class ArchivioJson<T> {
  private dati: T;

  constructor(
    private readonly file: string,
    private readonly vuoto: () => T,
  ) {
    this.dati = vuoto();
  }

  async carica(): Promise<void> {
    this.dati = await leggiJson(this.file, this.vuoto());
  }

  get valore(): T {
    return this.dati;
  }

  salva(): Promise<void> {
    return scriviAtomico(this.file, JSON.stringify(this.dati, null, 2));
  }
}

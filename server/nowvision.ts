// Dati NowVision per cantiere, in `<dati>/nowvision/<cantiere>/`: i file xlsx come
// escono dalla piattaforma, le riprese 360° con zona e data, e il riepilogo che il
// Redattore riceve insieme alle riprese.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import readXlsxFile from "read-excel-file/node";
import {
  avanzamentoAtteso,
  dataItaliana,
  type AttivitaProgramma,
  type DatiNowVision,
  type FileCaricato,
  type Ripresa,
  type SintesiNowVision,
  type VoceComputo,
} from "../shared/nowvision";
import { formatEuro, formatNumero } from "../shared/numeri";

const CARTELLA = path.join(path.resolve(process.env.REDATTORE_DATI ?? "data"), "nowvision");
const ESEMPI = path.resolve("esempi", "nowvision");
const ID_VALIDO = /^[a-zA-Z0-9-]+$/;

type Cella = string | number | boolean | Date | null;

interface Indice {
  computo?: FileCaricato;
  cronoprogramma?: FileCaricato;
  riprese: Omit<Ripresa, "url">[];
}

function cartella(cantiereId: string) {
  if (!ID_VALIDO.test(cantiereId)) throw new Error("Cantiere non valido");
  return path.join(CARTELLA, cantiereId);
}

async function leggiIndice(cantiereId: string): Promise<Indice> {
  try {
    return JSON.parse(await fs.readFile(path.join(cartella(cantiereId), "indice.json"), "utf8"));
  } catch {
    return { riprese: [] };
  }
}

async function scriviIndice(cantiereId: string, indice: Indice) {
  await fs.mkdir(cartella(cantiereId), { recursive: true });
  const file = path.join(cartella(cantiereId), "indice.json");
  await fs.writeFile(`${file}.tmp`, JSON.stringify(indice, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

/** Al primo avvio copia i dati di esempio (se ci sono) nella cartella dati. */
export async function seminaEsempi() {
  let cantieri: string[];
  try {
    cantieri = await fs.readdir(ESEMPI);
  } catch {
    return;
  }
  for (const id of cantieri) {
    const destinazione = path.join(CARTELLA, id);
    try {
      await fs.access(destinazione);
    } catch {
      await fs.cp(path.join(ESEMPI, id), destinazione, { recursive: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Lettura dei file xlsx

function normalizza(testo: unknown): string {
  return String(testo ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

/** Trova la riga d'intestazione e la colonna di ogni campo, cercando per nome. */
function colonne<K extends string>(righe: Cella[][], campi: Record<K, string[]>) {
  for (let r = 0; r < Math.min(righe.length, 10); r++) {
    const intestazioni = righe[r].map(normalizza);
    const indici = {} as Record<K, number>;
    let trovati = 0;
    for (const [campo, nomi] of Object.entries(campi) as [K, string[]][]) {
      indici[campo] = intestazioni.findIndex((h) => nomi.includes(h));
      if (indici[campo] >= 0) trovati++;
    }
    if (trovati >= 3) return { riga: r, indici };
  }
  return null;
}

function numero(valore: Cella): number | null {
  if (valore === null || valore === "" || typeof valore === "boolean" || valore instanceof Date) return null;
  if (typeof valore === "number") return valore;
  const t = valore.trim();
  if (!t || t === "—" || t === "-") return null;
  // «1,000» e «3,500.00» (formato inglese del template) oppure «1.234,56» (italiano).
  const inglese = /^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(t);
  const n = Number(inglese ? t.replace(/,/g, "") : t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function data(valore: Cella): string | null {
  if (valore instanceof Date) return valore.toISOString().slice(0, 10);
  if (typeof valore === "string") {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(valore);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const it = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(valore.trim());
    if (it) return `${it[3]}-${it[2].padStart(2, "0")}-${it[1].padStart(2, "0")}`;
  }
  return null;
}

function zone(valore: Cella): string[] {
  return String(valore ?? "")
    .split(",")
    .map((z) => z.trim())
    .filter(Boolean);
}

function codiceWbs(valore: Cella): string {
  if (typeof valore === "number") return Number.isInteger(valore) ? `${valore}.0` : String(valore);
  return String(valore ?? "").trim();
}

function testo(valore: Cella): string {
  return valore === null || valore === undefined ? "" : String(valore).trim();
}

async function fogli(file: string) {
  return (await readXlsxFile(file)) as { sheet: string; data: Cella[][] }[];
}

export async function leggiComputo(file: string): Promise<VoceComputo[]> {
  for (const { data: righe } of await fogli(file)) {
    const trovate = colonne(righe, {
      wbs: ["wbs", "wbs code", "codice"],
      descrizione: ["descrizione", "lavorazione", "description"],
      unita: ["unita", "unit", "u m", "um"],
      quantita: ["quantita", "quantity", "qty"],
      prezzo: ["prezzo unitario", "unit price", "prezzo"],
      importo: ["costo totale", "importo", "total cost"],
      misurato: ["misurato dall ia", "measured by ai"],
      rilevato: ["costo rilevato", "measured cost"],
      zona: ["zona", "zone", "zones"],
      affidabilita: ["affidabilita dell ia", "ai confidence"],
    });
    if (!trovate) continue;
    const c = trovate.indici;
    const voci: VoceComputo[] = [];
    let zoneGruppo: string[] = [];
    for (const riga of righe.slice(trovate.riga + 1)) {
      const descrizione = testo(riga[c.descrizione]);
      if (!descrizione) continue;
      const wbs = codiceWbs(riga[c.wbs]);
      const zoneRiga = c.zona >= 0 ? zone(riga[c.zona]) : [];
      const quantita = numero(riga[c.quantita]);
      // Template di import: le righe «n.0» senza quantità sono gruppi e passano la zona ai figli.
      if (/^\d+\.0$/.test(wbs) && quantita === null) {
        zoneGruppo = zoneRiga;
        continue;
      }
      const misurato = c.misurato >= 0 ? /([\d.,]+)\s*\(([\d.,]+)%\)/.exec(testo(riga[c.misurato])) : null;
      const affidabilita = c.affidabilita >= 0 ? testo(riga[c.affidabilita]) : "";
      voci.push({
        wbs,
        descrizione,
        unita: c.unita >= 0 ? testo(riga[c.unita]) : "",
        quantita,
        prezzo: c.prezzo >= 0 ? numero(riga[c.prezzo]) : null,
        importo: c.importo >= 0 ? numero(riga[c.importo]) : null,
        zone: zoneRiga.length ? zoneRiga : zoneGruppo,
        misuratoIA: misurato ? { quantita: numero(misurato[1]) ?? 0, percentuale: numero(misurato[2]) ?? 0 } : null,
        costoRilevato: c.rilevato >= 0 ? numero(riga[c.rilevato]) : null,
        affidabilitaIA: affidabilita && affidabilita !== "None" ? affidabilita : null,
      });
    }
    if (voci.length) return voci;
  }
  throw new Error("Non trovo le colonne del computo (WBS, Descrizione o Lavorazione, Unità, Quantità…).");
}

export async function leggiProgramma(file: string): Promise<{ attivita: AttivitaProgramma[]; note: string[] }> {
  const tutti = await fogli(file);
  for (const { data: righe } of tutti) {
    const trovate = colonne(righe, {
      zona: ["zones", "zona", "zone"],
      wbs: ["wbs code", "wbs"],
      descrizione: ["activity description", "descrizione attivita", "attivita", "descrizione"],
      inizio: ["planned start date", "inizio pianificato", "inizio previsto"],
      fine: ["planned end date", "fine pianificata", "fine prevista"],
      inizioEffettivo: ["actual start date", "inizio effettivo"],
      fineEffettiva: ["actual end date", "fine effettiva"],
      avanzamento: ["% progress", "progress", "avanzamento", "% avanzamento"],
      note: ["remarks", "note"],
    });
    if (!trovate) continue;
    const c = trovate.indici;
    const grezze = righe
      .slice(trovate.riga + 1)
      .map((riga) => ({ riga, wbs: codiceWbs(riga[c.wbs]), descrizione: testo(riga[c.descrizione]) }))
      // La riga di totale non ha codice WBS.
      .filter((r) => r.wbs && r.descrizione);
    const conFigli = new Set(
      grezze.filter((r) => !/\.0$/.test(r.wbs)).map((r) => `${r.wbs.split(".")[0]}.0`),
    );
    let zoneGruppo: string[] = [];
    const attivita: AttivitaProgramma[] = [];
    for (const { riga, wbs, descrizione } of grezze) {
      const zoneRiga = zone(riga[c.zona]);
      if (conFigli.has(wbs)) {
        zoneGruppo = zoneRiga;
        continue;
      }
      let avanzamento = c.avanzamento >= 0 ? numero(riga[c.avanzamento]) : null;
      if (avanzamento !== null && avanzamento > 1) avanzamento /= 100;
      attivita.push({
        wbs,
        descrizione,
        zone: zoneRiga.length ? zoneRiga : zoneGruppo,
        inizioPrevisto: data(riga[c.inizio]),
        finePrevista: data(riga[c.fine]),
        inizioEffettivo: c.inizioEffettivo >= 0 ? data(riga[c.inizioEffettivo]) : null,
        fineEffettiva: c.fineEffettiva >= 0 ? data(riga[c.fineEffettiva]) : null,
        avanzamento,
        note: c.note >= 0 ? testo(riga[c.note]) : "",
      });
    }
    // Gli altri fogli (es. «Note & Assunzioni») spiegano come è costruito il programma.
    const note = tutti
      .filter((f) => f.data !== righe)
      .flatMap((f) => f.data.map((r) => r.map(testo).filter(Boolean).join(" ")))
      .filter(Boolean);
    if (attivita.length) return { attivita, note };
  }
  throw new Error("Non trovo le colonne del cronoprogramma (WBS Code, Activity Description, Planned Start/End Date…).");
}

// ---------------------------------------------------------------------------
// Archivio

const NOMI_FILE = { computo: "computo.xlsx", cronoprogramma: "cronoprogramma.xlsx" } as const;

export async function salvaFile(
  cantiereId: string,
  tipo: keyof typeof NOMI_FILE,
  nome: string,
  contenuto: Buffer,
) {
  await fs.mkdir(cartella(cantiereId), { recursive: true });
  const destinazione = path.join(cartella(cantiereId), NOMI_FILE[tipo]);
  const prova = `${destinazione}.nuovo.xlsx`;
  await fs.writeFile(prova, contenuto);
  try {
    // Si accetta il file solo se si legge.
    if (tipo === "computo") await leggiComputo(prova);
    else await leggiProgramma(prova);
  } catch (e) {
    await fs.rm(prova, { force: true });
    // I messaggi della libreria sono in inglese e tecnici: si tengono solo i nostri.
    const nostro = e instanceof Error && e.message.startsWith("Non trovo");
    throw nostro ? e : new Error("Il file non è un .xlsx leggibile. Esportalo di nuovo da NowVision.");
  }
  await fs.rename(prova, destinazione);
  const indice = await leggiIndice(cantiereId);
  indice[tipo] = { nome, caricatoIl: new Date().toISOString() };
  await scriviIndice(cantiereId, indice);
}

export async function salvaRipresa(cantiereId: string, dataUrl: string, nome: string, zona: string, giorno: string) {
  const corrispondenza = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl);
  if (!corrispondenza) throw new Error("Formato immagine non supportato");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) throw new Error("Data della ripresa non valida");
  if (!zona.trim()) throw new Error("Indica la zona della ripresa");
  const id = randomUUID();
  const estensione = corrispondenza[1] === "jpeg" ? "jpg" : corrispondenza[1];
  await fs.mkdir(path.join(cartella(cantiereId), "riprese"), { recursive: true });
  await fs.writeFile(
    path.join(cartella(cantiereId), "riprese", `${id}.${estensione}`),
    Buffer.from(corrispondenza[2], "base64"),
  );
  const indice = await leggiIndice(cantiereId);
  const ripresa = { id, zona: zona.trim(), data: giorno, nome: `${id}.${estensione}` };
  indice.riprese.push(ripresa);
  await scriviIndice(cantiereId, indice);
  return { ...ripresa, url: urlRipresa(cantiereId, id) };
}

export async function eliminaRipresa(cantiereId: string, id: string) {
  const indice = await leggiIndice(cantiereId);
  const ripresa = indice.riprese.find((r) => r.id === id);
  if (!ripresa) return;
  indice.riprese = indice.riprese.filter((r) => r.id !== id);
  await scriviIndice(cantiereId, indice);
  await fs.rm(path.join(cartella(cantiereId), "riprese", ripresa.nome), { force: true });
}

export function urlRipresa(cantiereId: string, id: string) {
  return `/api/nowvision/${cantiereId}/riprese/${id}`;
}

export async function fileRipresa(cantiereId: string, id: string) {
  if (!ID_VALIDO.test(id)) return null;
  const ripresa = (await leggiIndice(cantiereId)).riprese.find((r) => r.id === id);
  if (!ripresa) return null;
  return { ripresa, file: path.join(cartella(cantiereId), "riprese", ripresa.nome) };
}

// Le letture dei file xlsx si tengono in memoria finché il file non cambia.
const cache = new Map<string, { quando: string; valore: unknown }>();
async function memorizzato<T>(chiave: string, quando: string | undefined, leggi: () => Promise<T>): Promise<T> {
  const voce = cache.get(chiave);
  if (voce && voce.quando === quando) return voce.valore as T;
  const valore = await leggi();
  cache.set(chiave, { quando: quando ?? "", valore });
  return valore;
}

export async function datiNowVision(cantiereId: string): Promise<DatiNowVision> {
  const indice = await leggiIndice(cantiereId);
  const base = cartella(cantiereId);
  const computo = indice.computo
    ? {
        ...indice.computo,
        voci: await memorizzato(`${cantiereId}/computo`, indice.computo.caricatoIl, () =>
          leggiComputo(path.join(base, NOMI_FILE.computo)),
        ),
      }
    : null;
  const programma = indice.cronoprogramma
    ? {
        ...indice.cronoprogramma,
        ...(await memorizzato(`${cantiereId}/programma`, indice.cronoprogramma.caricatoIl, () =>
          leggiProgramma(path.join(base, NOMI_FILE.cronoprogramma)),
        )),
      }
    : null;
  const riprese = indice.riprese
    .map((r) => ({ ...r, url: urlRipresa(cantiereId, r.id) }))
    .sort((a, b) => b.data.localeCompare(a.data) || a.zona.localeCompare(b.zona));
  const zone = new Set<string>();
  computo?.voci.forEach((v) => v.zone.forEach((z) => zone.add(z)));
  programma?.attivita.forEach((a) => a.zone.forEach((z) => zone.add(z)));
  riprese.forEach((r) => zone.add(r.zona));
  return { cantiereId, computo, programma, riprese, zone: [...zone].sort() };
}

export async function sintesi(cantiereId: string): Promise<SintesiNowVision> {
  const d = await datiNowVision(cantiereId);
  return {
    cantiereId,
    computo: d.computo && {
      nome: d.computo.nome,
      caricatoIl: d.computo.caricatoIl,
      voci: d.computo.voci.length,
      totale: d.computo.voci.reduce((s, v) => s + (v.importo ?? 0), 0),
      rilevato: d.computo.voci.reduce((s, v) => s + (v.costoRilevato ?? 0), 0),
    },
    programma: d.programma && {
      nome: d.programma.nome,
      caricatoIl: d.programma.caricatoIl,
      attivita: d.programma.attivita.length,
    },
    riprese: d.riprese,
    zone: d.zone,
  };
}

// ---------------------------------------------------------------------------
// Contesto per il modello

const percento = (n: number | null) => (n === null ? "—" : `${formatNumero(n * 100, 0)}%`);

/**
 * Situazione registrata in NowVision, in testo compatto, alla data delle riprese.
 * I calcoli (avanzamento atteso, totali, rilevato) li fa il server, non il modello.
 */
export function contestoPerIlModello(d: DatiNowVision, riferimento: string, zoneRiprese: string[]): string {
  const parti: string[] = [
    `[Dati della piattaforma NowVision per questo cantiere, come registrati oggi. Data di riferimento del confronto: ${dataItaliana(riferimento)} (ripresa più recente). Zone delle riprese: ${zoneRiprese.join(", ")}.]`,
  ];

  if (d.programma) {
    parti.push(`## Cronoprogramma (file «${d.programma.nome}»)`);
    if (d.programma.note.length) parti.push(`Note del file:\n${d.programma.note.map((n) => `- ${n}`).join("\n")}`);
    parti.push(
      "WBS | Attività | Zone | Previsto | Atteso al riferimento (lineare) | Registrato nel cronoprogramma (può non essere aggiornato) | Note",
      ...d.programma.attivita.map((a) => {
        const registrato =
          a.inizioEffettivo || a.fineEffettiva || (a.avanzamento ?? 0) > 0
            ? `inizio ${dataItaliana(a.inizioEffettivo)}, fine ${dataItaliana(a.fineEffettiva)}, ${percento(a.avanzamento)}`
            : "nessuna data effettiva, 0%";
        return [
          a.wbs,
          a.descrizione,
          a.zone.join(", ") || "—",
          `dal ${dataItaliana(a.inizioPrevisto)} al ${dataItaliana(a.finePrevista)}`,
          percento(avanzamentoAtteso(a, riferimento)),
          registrato,
          a.note || "—",
        ].join(" | ");
      }),
    );
  } else {
    parti.push("## Cronoprogramma: non caricato.");
  }

  if (d.computo) {
    const voci = d.computo.voci;
    const totale = voci.reduce((s, v) => s + (v.importo ?? 0), 0);
    const rilevato = voci.reduce((s, v) => s + (v.costoRilevato ?? 0), 0);
    const nelleZone = (v: VoceComputo) => v.zone.some((z) => zoneRiprese.includes(z));
    const riga = (v: VoceComputo) =>
      [
        v.wbs,
        v.descrizione,
        v.zone.join(", ") || "—",
        v.quantita === null ? "—" : `${formatNumero(v.quantita)} ${v.unita}`,
        v.importo === null ? "—" : formatEuro(v.importo),
        v.misuratoIA
          ? `misurato IA ${formatNumero(v.misuratoIA.quantita)} ${v.unita} (${formatNumero(v.misuratoIA.percentuale)}%)${v.affidabilitaIA ? `, affidabilità ${v.affidabilitaIA}` : ""}`
          : "nessuna misura IA",
      ].join(" | ");
    parti.push(
      `## Computo metrico (file «${d.computo.nome}»): ${voci.length} voci, totale ${formatEuro(totale)}` +
        (rilevato > 0 ? `; rilevato dall'IA NowVision ${formatEuro(rilevato)} (${formatNumero((rilevato / totale) * 100, 1)}%)` : ""),
      "I codici del computo non coincidono con quelli del cronoprogramma: collega le voci alle attività per significato.",
      ...zoneRiprese.map((z) => {
        const diZona = voci.filter((v) => v.zone.includes(z));
        const importo = diZona.reduce((s, v) => s + (v.importo ?? 0), 0);
        const misurato = diZona.reduce((s, v) => s + (v.costoRilevato ?? 0), 0);
        return importo > 0
          ? `Zona ${z}: ${diZona.length} voci, ${formatEuro(importo)}, misurato dall'IA ${formatEuro(misurato)} (${formatNumero((misurato / importo) * 100, 1)}%). Le voci condivise con altre zone sono contate per intero.`
          : `Zona ${z}: nessuna voce di computo.`;
      }),
      "### Voci delle zone riprese o già misurate dall'IA",
      "Codice | Lavorazione | Zone | Quantità prevista | Importo | Misurato IA",
      ...voci.filter((v) => nelleZone(v) || (v.misuratoIA?.percentuale ?? 0) > 0).map(riga),
      "### Altre voci (non ancora misurate, altre zone)",
      ...voci
        .filter((v) => !nelleZone(v) && !((v.misuratoIA?.percentuale ?? 0) > 0))
        .map((v) => `${v.wbs} | ${v.descrizione} | ${v.zone.join(", ") || "—"}`),
    );
  } else {
    parti.push("## Computo: non caricato.");
  }
  return parti.join("\n");
}

// Funzioni pure per computo e cronoprogramma letti dall'IA: riattaccano le colonne
// dell'export NowVision alle voci per codice WBS, recuperano le righe che l'IA ha
// saltato, e controllano i conti (quantità × prezzo) senza affidarsi al modello.

import type { AnomaliaComputo, AttivitaProgramma, VoceComputo } from "../shared/nowvision";
import { formatEuro, formatNumero } from "../shared/numeri";

/** «Art. 3.1 », «3.1» e «art3.1» sono lo stesso codice. */
export function normWbs(wbs: string): string {
  return wbs
    .trim()
    .toLowerCase()
    .replace(/^(art(icolo)?\.?|voce|n\.?)\s*/, "")
    .replace(/\s+/g, "");
}

/**
 * Le voci lette dall'IA restano la base (descrizione, categoria, zona dedotta); dal file
 * NowVision si prendono i numeri esatti delle celle e le colonne della piattaforma.
 * Le voci del file che l'IA non ha restituito si aggiungono in fondo.
 */
export function riattaccaColonne(vociIA: VoceComputo[], vociFile: VoceComputo[]) {
  const dalFile = new Map(vociFile.map((v) => [normWbs(v.wbs), v]));
  const usate = new Set<string>();
  let riattaccate = 0;
  const voci = vociIA.map((v): VoceComputo => {
    const chiave = normWbs(v.wbs);
    const f = dalFile.get(chiave);
    if (!f || usate.has(chiave)) return v;
    usate.add(chiave);
    riattaccate += 1;
    return {
      ...v,
      unita: f.unita || v.unita,
      quantita: f.quantita ?? v.quantita,
      prezzo: f.prezzo ?? v.prezzo,
      importo: f.importo ?? v.importo,
      // Una zona scritta nel file vale più di una zona dedotta.
      zone: f.zone.length ? f.zone : v.zone,
      zonaDedotta: f.zone.length ? false : v.zonaDedotta,
      misuratoIA: f.misuratoIA,
      costoRilevato: f.costoRilevato,
      affidabilitaIA: f.affidabilitaIA,
    };
  });
  const mancanti = vociFile.filter((f) => !usate.has(normWbs(f.wbs)));
  return { voci: [...voci, ...mancanti], riattaccate, recuperate: mancanti.length };
}

/** Come per il computo: date effettive, avanzamento e note dal file, il resto dall'IA. */
export function riattaccaAttivita(attIA: AttivitaProgramma[], attFile: AttivitaProgramma[]) {
  const dalFile = new Map(attFile.map((a) => [normWbs(a.wbs), a]));
  const usate = new Set<string>();
  let riattaccate = 0;
  const attivita = attIA.map((a): AttivitaProgramma => {
    const chiave = normWbs(a.wbs);
    const f = dalFile.get(chiave);
    if (!f || usate.has(chiave)) return a;
    usate.add(chiave);
    riattaccate += 1;
    return {
      ...a,
      inizioPrevisto: f.inizioPrevisto ?? a.inizioPrevisto,
      finePrevista: f.finePrevista ?? a.finePrevista,
      inizioEffettivo: f.inizioEffettivo,
      fineEffettiva: f.fineEffettiva,
      avanzamento: f.avanzamento,
      note: f.note || a.note,
      zone: f.zone.length ? f.zone : a.zone,
      zonaDedotta: f.zone.length ? false : a.zonaDedotta,
    };
  });
  const mancanti = attFile.filter((f) => !usate.has(normWbs(f.wbs)));
  return { attivita: [...attivita, ...mancanti], riattaccate, recuperate: mancanti.length };
}

/** Conti che non tornano e voci ripetute: si controllano nel codice, non con il modello. */
export function controllaConti(voci: VoceComputo[]): AnomaliaComputo[] {
  const anomalie: AnomaliaComputo[] = [];
  for (const v of voci) {
    if (v.quantita === null || v.prezzo === null || v.importo === null) continue;
    const atteso = v.quantita * v.prezzo;
    if (Math.abs(atteso - v.importo) > Math.max(1, Math.abs(v.importo) * 0.005)) {
      anomalie.push({
        wbs: v.wbs,
        tipo: "importo_non_torna",
        descrizione: `${formatNumero(v.quantita)} × ${formatEuro(v.prezzo)} = ${formatEuro(atteso)}, ma l'importo indicato è ${formatEuro(v.importo)}.`,
      });
    }
  }
  const viste = new Map<string, string>();
  for (const v of voci) {
    const chiave = `${v.descrizione.toLowerCase().replace(/\s+/g, " ").trim()}|${v.unita}|${v.quantita}`;
    const prima = viste.get(chiave);
    if (prima !== undefined) {
      anomalie.push({ wbs: v.wbs, tipo: "duplicata", descrizione: `Stessa descrizione, unità e quantità della voce ${prima}.` });
    } else {
      viste.set(chiave, v.wbs);
    }
  }
  return anomalie;
}

/** Unione di più elenchi di anomalie senza doppioni, tolte quelle che l'utente ha ignorato. */
export function uniscAnomalie(elenchi: AnomaliaComputo[][], ignorate: string[]): AnomaliaComputo[] {
  const escluse = new Set(ignorate);
  const viste = new Set<string>();
  return elenchi.flat().filter((a) => {
    const chiave = `${a.wbs}|${a.tipo}`;
    if (escluse.has(chiave) || viste.has(chiave)) return false;
    viste.add(chiave);
    return true;
  });
}

// Numeri in formato italiano e i due calcoli che il Redattore non fa mai «a mente»:
// le righe del libretto delle misure e l'acconto del SAL.

const formatter = new Map<number, Intl.NumberFormat>();

export function formatNumero(n: number, decimali = 2): string {
  let f = formatter.get(decimali);
  if (!f) {
    f = new Intl.NumberFormat("it-IT", {
      minimumFractionDigits: decimali,
      maximumFractionDigits: decimali,
      useGrouping: "always",
    });
    formatter.set(decimali, f);
  }
  return f.format(n);
}

export function formatEuro(n: number): string {
  return `€ ${formatNumero(n)}`;
}

/** Arrotonda al centesimo, come nei computi: mezzo centesimo per eccesso. */
export function arrotonda(n: number): number {
  return Math.round(n * 100 + (n >= 0 ? 1e-7 : -1e-7)) / 100;
}

export interface RigaMisura {
  descrizione: string;
  fattori: number[];
  deduzione: boolean;
}

export interface RigaMisuraCalcolata extends RigaMisura {
  quantita: number;
}

export function calcolaMisure(righe: RigaMisura[]) {
  const calcolate: RigaMisuraCalcolata[] = righe.map((r) => ({
    ...r,
    quantita: arrotonda(r.fattori.reduce((a, b) => a * b, 1)),
  }));
  const totale = arrotonda(
    calcolate.reduce((s, r) => s + (r.deduzione ? -r.quantita : r.quantita), 0),
  );
  return { righe: calcolate, totale };
}

export interface VoceSal {
  tariffa: string;
  descrizione: string;
  um: string;
  quantita: number;
  prezzo: number;
}

export interface DatiSal {
  voci: VoceSal[];
  ribassoPercentuale: number;
  oneriSicurezza: number;
  ritenutaPercentuale: number;
  accontiPrecedenti: number;
  recuperoAnticipazione: number | null;
}

export function calcolaSal(d: DatiSal) {
  const voci = d.voci.map((v) => ({ ...v, importo: arrotonda(v.quantita * v.prezzo) }));
  const importoLavori = arrotonda(voci.reduce((s, v) => s + v.importo, 0));
  const ribasso = arrotonda((importoLavori * d.ribassoPercentuale) / 100);
  const nettoLavori = arrotonda(importoLavori - ribasso);
  const totale = arrotonda(nettoLavori + d.oneriSicurezza);
  const ritenuta = arrotonda((totale * d.ritenutaPercentuale) / 100);
  const recupero = d.recuperoAnticipazione ?? 0;
  const acconto = arrotonda(totale - ritenuta - d.accontiPrecedenti - recupero);
  return {
    voci,
    importoLavori,
    ribasso,
    nettoLavori,
    oneriSicurezza: d.oneriSicurezza,
    totale,
    ritenuta,
    accontiPrecedenti: d.accontiPrecedenti,
    recuperoAnticipazione: d.recuperoAnticipazione,
    acconto,
  };
}

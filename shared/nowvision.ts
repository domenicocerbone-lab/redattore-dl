// Dati della piattaforma NowVision usati dal Redattore: computo (export «WBS Mode»
// o template di import), cronoprogramma («Construction Schedule») e riprese 360°.

export interface VoceComputo {
  wbs: string;
  descrizione: string;
  unita: string;
  quantita: number | null;
  prezzo: number | null;
  importo: number | null;
  zone: string[];
  /** «Misurato dall'IA» della piattaforma, se presente nell'export. */
  misuratoIA: { quantita: number; percentuale: number } | null;
  costoRilevato: number | null;
  affidabilitaIA: string | null;
}

export interface AttivitaProgramma {
  wbs: string;
  descrizione: string;
  zone: string[];
  /** Date in formato AAAA-MM-GG. */
  inizioPrevisto: string | null;
  finePrevista: string | null;
  inizioEffettivo: string | null;
  fineEffettiva: string | null;
  /** Da 0 a 1, come nella colonna «% Progress». */
  avanzamento: number | null;
  note: string;
}

export interface FileCaricato {
  nome: string;
  caricatoIl: string;
}

export interface Ripresa {
  id: string;
  zona: string;
  /** AAAA-MM-GG */
  data: string;
  nome: string;
  url: string;
}

export interface DatiNowVision {
  cantiereId: string;
  computo: (FileCaricato & { voci: VoceComputo[] }) | null;
  programma: (FileCaricato & { attivita: AttivitaProgramma[]; note: string[] }) | null;
  riprese: Ripresa[];
  /** Zone che compaiono nei file e nelle riprese, per i menu. */
  zone: string[];
}

/** Riepilogo leggero per l'interfaccia. */
export interface SintesiNowVision {
  cantiereId: string;
  computo: (FileCaricato & { voci: number; totale: number; rilevato: number }) | null;
  programma: (FileCaricato & { attivita: number }) | null;
  riprese: Ripresa[];
  zone: string[];
}

const GIORNO = 86_400_000;

export function giorni(da: string, a: string): number {
  return Math.round((Date.parse(a) - Date.parse(da)) / GIORNO);
}

/** Avanzamento atteso alla data, se il programma procedesse lineare tra inizio e fine previsti. */
export function avanzamentoAtteso(a: AttivitaProgramma, data: string): number | null {
  if (!a.inizioPrevisto || !a.finePrevista) return null;
  if (data < a.inizioPrevisto) return 0;
  if (data >= a.finePrevista) return 1;
  return (giorni(a.inizioPrevisto, data) + 1) / (giorni(a.inizioPrevisto, a.finePrevista) + 1);
}

export function dataItaliana(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, g] = iso.split("-");
  return `${g}/${m}/${a}`;
}

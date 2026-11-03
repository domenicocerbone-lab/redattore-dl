// Cosa c'è e cosa manca nella scheda del cantiere: la lista di controllo della revisione.

import type { SchedaCantiere, TabelleCantiere } from "../../../shared/cantieri";
import { formatEuro } from "../../../shared/numeri";

export interface Controllo {
  ok: boolean;
  testo: string;
  /** Accanto a un controllo non superato: «manca», o niente se il testo basta. */
  etichetta: string;
}

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function controlliScheda(s: SchedaCantiere, tabelle: TabelleCantiere | null): Controllo[] {
  return elenco(s, tabelle).map((c) => ({ etichetta: "manca", ...c }));
}

function elenco(s: SchedaCantiere, tabelle: TabelleCantiere | null): (Omit<Controllo, "etichetta"> & { etichetta?: string })[] {
  const ruolo = (...parole: string[]) => s.soggetti.some((x) => parole.some((p) => norm(x.ruolo).includes(p)) && x.nome.trim());
  const voci = tabelle?.voci.length ?? 0;
  const totale = (tabelle?.voci ?? []).reduce((t, v) => t + (v.importo ?? 0), 0);
  return [
    { ok: ruolo("committente", "stazione appaltante"), testo: "Committente o stazione appaltante" },
    { ok: ruolo("impresa", "appaltator", "esecutore"), testo: "Impresa esecutrice" },
    { ok: ruolo("direttore dei lavori", "direzione lavori"), testo: "Direttore dei Lavori" },
    {
      ok: s.contratto.importo !== null,
      testo: s.contratto.importo !== null ? `Importo contrattuale ${formatEuro(s.contratto.importo)}` : "Importo contrattuale",
    },
    { ok: Boolean(s.date.consegnaLavori || s.date.ultimazionePrevista), testo: "Date contrattuali" },
    { ok: voci > 0, testo: voci ? `Computo: ${voci} voci${totale ? `, ${formatEuro(totale)}` : ""}` : "Computo metrico" },
    ...(voci > 0
      ? [
          {
            ok: s.anomalie.length === 0,
            etichetta: "",
            testo: s.anomalie.length
              ? `${s.anomalie.length === 1 ? "1 anomalia" : `${s.anomalie.length} anomalie`} del computo da controllare`
              : "Nessuna anomalia aperta nel computo",
          },
        ]
      : []),
    {
      ok: (tabelle?.attivita.length ?? 0) > 0,
      testo: tabelle?.attivita.length ? `Programma: ${tabelle.attivita.length} attività` : "Cronoprogramma",
    },
    {
      ok: s.zone.length > 0,
      testo: s.zone.length
        ? `${s.zone.length === 1 ? "1 zona" : `${s.zone.length} zone`}${s.vociSenzaZona.length ? `, ${s.vociSenzaZona.length} ${s.vociSenzaZona.length === 1 ? "voce" : "voci"} senza zona` : ""}`
        : "Zone",
    },
  ];
}

/** Valori dedotti dai documenti e non ancora confermati dall'utente. */
export function daVerificare(s: SchedaCantiere): number {
  return (
    Object.values(s.fonti).filter((f) => f.certezza === "dedotto").length +
    s.soggetti.filter((x) => x.fonte?.certezza === "dedotto").length +
    s.zone.filter((z) => z.certezza === "dedotto").length
  );
}

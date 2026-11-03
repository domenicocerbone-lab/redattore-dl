// Il computo come l'ha letto l'IA: importi per categoria, voci con zona dedotta e
// anomalie da controllare (i conti li verifica il codice, il resto l'IA). «Ignora» le toglie.

import { useEffect, useMemo, useState } from "react";
import type { SchedaCantiere, TabelleCantiere } from "../../../shared/cantieri";
import type { AnomaliaComputo } from "../../../shared/nowvision";
import { formatEuro } from "../../../shared/numeri";
import { api } from "../../lib/api";
import { impostaCantiere } from "../../lib/cantieri";

const MOTIVI: Record<AnomaliaComputo["tipo"], string> = {
  importo_non_torna: "Conto che non torna",
  quantita_anomala: "Quantità da verificare",
  prezzo_anomalo: "Prezzo da verificare",
  duplicata: "Voce ripetuta",
  altro: "Da verificare",
};

export function SezioneComputo({ s }: { s: SchedaCantiere }) {
  const [tabelle, setTabelle] = useState<TabelleCantiere | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const letti = s.documenti.filter((d) => d.stato === "letto").length;

  useEffect(() => {
    let attuale = true;
    api.tabelleCantiere(s.id).then(
      (t) => attuale && setTabelle(t),
      () => undefined,
    );
    return () => {
      attuale = false;
    };
  }, [s.id, letti]);

  const categorie = useMemo(() => {
    const m = new Map<string, { voci: number; importo: number }>();
    for (const v of tabelle?.voci ?? []) {
      const c = v.categoria || "Senza categoria";
      const x = m.get(c) ?? { voci: 0, importo: 0 };
      x.voci += 1;
      x.importo += v.importo ?? 0;
      m.set(c, x);
    }
    return [...m.entries()].sort((a, b) => b[1].importo - a[1].importo);
  }, [tabelle]);
  const voci = useMemo(() => new Map((tabelle?.voci ?? []).map((v) => [v.wbs, v])), [tabelle]);

  if (!tabelle || tabelle.voci.length === 0) return null;
  const totale = tabelle.voci.reduce((t, v) => t + (v.importo ?? 0), 0);
  const dedotte = tabelle.voci.filter((v) => v.zonaDedotta).length;

  async function ignora(a: AnomaliaComputo) {
    setErrore(null);
    try {
      impostaCantiere(
        await api.aggiornaCantiere(s.id, {
          anomalie: s.anomalie.filter((x) => !(x.wbs === a.wbs && x.tipo === a.tipo)),
          anomalieIgnorate: [...s.anomalieIgnorate, `${a.wbs}|${a.tipo}`],
        }),
      );
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  return (
    <section className="cantiere__sezione" aria-labelledby="titolo-computo">
      <div className="cantiere__sezione-testa">
        <h2 id="titolo-computo" className="cantiere__sottotitolo">
          Computo
        </h2>
        <span className="pillola pillola--neutra">
          {tabelle.voci.length} voci · {formatEuro(totale)}
        </span>
      </div>
      <p className="cantiere__nota">
        L'ho letto voce per voce: categorie e zone vengono dai titoli e dalle colonne, o le ho ricavate dalle descrizioni.
        {dedotte > 0 && ` Per ${dedotte === 1 ? "1 voce" : `${dedotte} voci`} la zona è dedotta: controllala nelle zone qui sotto.`}
      </p>

      <table className="cantiere__tabella">
        <thead>
          <tr>
            <th>Categoria</th>
            <th className="a-destra">Voci</th>
            <th className="a-destra">Importo</th>
          </tr>
        </thead>
        <tbody>
          {categorie.map(([c, x]) => (
            <tr key={c}>
              <td>{c}</td>
              <td className="a-destra">{x.voci}</td>
              <td className="a-destra">{formatEuro(x.importo)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {s.anomalie.length > 0 ? (
        <div className="cantiere__riquadro cantiere__riquadro--attenzione">
          <strong>{s.anomalie.length === 1 ? "1 anomalia da controllare" : `${s.anomalie.length} anomalie da controllare`}</strong>
          <ul className="anomalie">
            {s.anomalie.map((a) => (
              <li key={`${a.wbs}|${a.tipo}`} className="anomalia">
                <span className="anomalia__testo">
                  <span className="etichetta-mono">{MOTIVI[a.tipo]}</span>
                  <span>
                    <span className="codice">{a.wbs}</span> {voci.get(a.wbs)?.descrizione ?? ""}
                  </span>
                  <span className="cantiere__aiuto">{a.descrizione}</span>
                </span>
                <button type="button" className="btn btn--piccolo" onClick={() => void ignora(a)}>
                  Ignora
                </button>
              </li>
            ))}
          </ul>
          {errore && <span className="cantiere__errore">{errore}</span>}
        </div>
      ) : (
        <p className="cantiere__aiuto">Nessuna anomalia nel computo{s.anomalieIgnorate.length ? " (alcune le hai ignorate)" : ""}.</p>
      )}
    </section>
  );
}

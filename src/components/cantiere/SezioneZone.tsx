// Zone proposte: accetta, rinomina, unisci, togli, aggiungi. Ogni zona collega voci di
// computo e attività del programma; le voci rimaste fuori e le scelte aperte sono sotto.

import { useEffect, useMemo, useState } from "react";
import { NOMI_TIPO_ZONA, TIPI_ZONA, type SchedaCantiere, type TabelleCantiere, type TipoZona, type Zona } from "../../../shared/cantieri";
import { formatEuro } from "../../../shared/numeri";
import { api } from "../../lib/api";
import { impostaCantiere } from "../../lib/cantieri";
import { Icona } from "../Icone";

type Bozza = Pick<SchedaCantiere, "zone" | "vociSenzaZona" | "decisioni">;
const daScheda = (s: SchedaCantiere): Bozza => ({
  zone: s.zone.map((z) => ({ ...z })),
  vociSenzaZona: [...s.vociSenzaZona],
  decisioni: s.decisioni.map((d) => ({ ...d })),
});

function idNuovo(zone: Zona[]): string {
  let n = zone.length + 1;
  while (zone.some((z) => z.id === `z-nuova-${n}`)) n++;
  return `z-nuova-${n}`;
}

export function SezioneZone({ s }: { s: SchedaCantiere }) {
  const [b, setB] = useState<Bozza>(() => daScheda(s));
  const [sporca, setSporca] = useState(false);
  const [scelte, setScelte] = useState<Set<string>>(new Set());
  const [aperta, setAperta] = useState<string | null>(null);
  const [tabelle, setTabelle] = useState<TabelleCantiere | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const letti = s.documenti.filter((d) => d.stato === "letto").length;

  useEffect(() => {
    if (!sporca) setB(daScheda(s));
  }, [s, sporca]);

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

  const voci = useMemo(() => new Map((tabelle?.voci ?? []).map((v) => [v.wbs, v])), [tabelle]);
  const attivita = useMemo(() => new Map((tabelle?.attivita ?? []).map((a) => [a.wbs, a])), [tabelle]);

  function cambia(f: (x: Bozza) => Bozza) {
    setB((x) => f(x));
    setSporca(true);
  }
  const zona = (id: string, modifica: Partial<Zona>) =>
    cambia((x) => ({ ...x, zone: x.zone.map((z) => (z.id === id ? { ...z, ...modifica, certezza: "letto" } : z)) }));

  function unisci() {
    const [prima, ...altre] = b.zone.filter((z) => scelte.has(z.id));
    if (!prima || altre.length === 0) return;
    const unita: Zona = {
      ...prima,
      vociComputo: [...new Set([prima, ...altre].flatMap((z) => z.vociComputo))],
      attivita: [...new Set([prima, ...altre].flatMap((z) => z.attivita))],
      note: [prima, ...altre].map((z) => z.note).filter(Boolean).join(" · "),
      certezza: "letto",
    };
    cambia((x) => ({ ...x, zone: x.zone.filter((z) => !altre.some((a) => a.id === z.id)).map((z) => (z.id === prima.id ? unita : z)) }));
    setScelte(new Set());
  }

  function togli(id: string) {
    const z = b.zone.find((x) => x.id === id);
    if (!z) return;
    // Le sue voci tornano tra quelle senza zona.
    cambia((x) => ({ ...x, zone: x.zone.filter((y) => y.id !== id), vociSenzaZona: [...new Set([...x.vociSenzaZona, ...z.vociComputo])] }));
  }

  async function salva() {
    setOccupato(true);
    setErrore(null);
    try {
      const nuova = await api.aggiornaCantiere(s.id, { ...b, zone: b.zone.map((z) => ({ ...z, nome: z.nome.trim() || "Zona senza nome" })) });
      impostaCantiere(nuova);
      setSporca(false);
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  async function proponi() {
    if (b.zone.length && !window.confirm("Rifaccio la proposta delle zone? Quelle attuali, con le tue modifiche, verranno sostituite.")) return;
    setErrore(null);
    try {
      impostaCantiere(await api.proponiZone(s.id));
      setSporca(false);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  return (
    <section className="cantiere__sezione" aria-labelledby="titolo-zone">
      <div className="cantiere__sezione-testa">
        <h2 id="titolo-zone" className="cantiere__sottotitolo">
          Zone
        </h2>
        {!s.zoneInPreparazione && letti > 0 && (
          <button type="button" className="btn btn--piccolo" onClick={() => void proponi()}>
            <Icona nome="rigenera" dimensione={15} />
            {b.zone.length ? "Proponi di nuovo" : "Proponi le zone"}
          </button>
        )}
      </div>
      <p className="cantiere__nota">
        Le zone servono a seguire l'avanzamento e i sopralluoghi: ogni zona raccoglie le sue voci di computo e attività del
        programma. Più avanti serviranno anche ad assegnare riprese 360° e foto.
      </p>

      {s.zoneInPreparazione && (
        <p className="cantiere__lavoro" role="status">
          <span className="documento-progetto__punto" aria-hidden="true" />
          Sto preparando la proposta delle zone dai documenti letti…
        </p>
      )}
      {!s.zoneInPreparazione && b.zone.length === 0 && (
        <p className="cantiere__aiuto">
          {letti ? "Nessuna zona ancora: premi «Proponi le zone» o aggiungile a mano." : "Le zone arrivano quando ho letto computo, programma o planimetrie."}
        </p>
      )}

      {b.zone.length > 0 && (
        <ul className="zone">
          {b.zone.map((z) => {
            const importo = z.vociComputo.reduce((t, w) => t + (voci.get(w)?.importo ?? 0), 0);
            return (
              <li key={z.id} className={`zona${z.certezza === "dedotto" ? " zona--dedotta" : ""}`}>
                <div className="zona__riga">
                  <input
                    type="checkbox"
                    aria-label={`Scegli ${z.nome} per unirla`}
                    checked={scelte.has(z.id)}
                    onChange={(e) =>
                      setScelte((x) => {
                        const n = new Set(x);
                        if (e.target.checked) n.add(z.id);
                        else n.delete(z.id);
                        return n;
                      })
                    }
                  />
                  <input className="zona__nome" aria-label="Nome della zona" value={z.nome} onChange={(e) => zona(z.id, { nome: e.target.value })} />
                  <input className="zona__piano" aria-label="Piano" placeholder="Piano" value={z.piano} onChange={(e) => zona(z.id, { piano: e.target.value })} />
                  <select aria-label="Tipo di zona" value={z.tipo} onChange={(e) => zona(z.id, { tipo: e.target.value as TipoZona })}>
                    {TIPI_ZONA.map((t) => (
                      <option key={t} value={t}>
                        {NOMI_TIPO_ZONA[t]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn-icona" aria-label={`Togli ${z.nome}`} onClick={() => togli(z.id)}>
                    <Icona nome="chiudi" dimensione={15} />
                  </button>
                </div>
                <button
                  type="button"
                  className="zona__conteggi"
                  aria-expanded={aperta === z.id}
                  onClick={() => setAperta((a) => (a === z.id ? null : z.id))}
                >
                  {z.vociComputo.length} {z.vociComputo.length === 1 ? "voce" : "voci"}
                  {importo ? ` · ${formatEuro(importo)}` : ""} · {z.attivita.length} attività
                  {z.certezza === "dedotto" && <span className="chip-fonte chip-fonte--dedotto">da verificare</span>}
                  <Icona nome={aperta === z.id ? "su" : "giu"} dimensione={13} />
                </button>
                {aperta === z.id && (
                  <div className="zona__dettaglio">
                    {z.note && <p>{z.note}</p>}
                    {z.attivita.length > 0 && (
                      <ul>
                        {z.attivita.map((w) => (
                          <li key={w}>
                            <span className="codice">{w}</span> {attivita.get(w)?.descrizione ?? ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {z.vociComputo.length > 0 && (
                      <ul>
                        {z.vociComputo.slice(0, 40).map((w) => (
                          <li key={w}>
                            <span className="codice">{w}</span> {voci.get(w)?.descrizione ?? ""}
                          </li>
                        ))}
                        {z.vociComputo.length > 40 && <li>… altre {z.vociComputo.length - 40} voci</li>}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="cantiere__comandi">
        <button
          type="button"
          className="btn btn--piccolo"
          onClick={() =>
            cambia((x) => ({
              ...x,
              zone: [...x.zone, { id: idNuovo(x.zone), nome: "Nuova zona", piano: "", tipo: "unita", vociComputo: [], attivita: [], note: "", certezza: "letto" }],
            }))
          }
        >
          <Icona nome="piu" dimensione={15} />
          Aggiungi zona
        </button>
        <button type="button" className="btn btn--piccolo" disabled={scelte.size < 2} onClick={unisci}>
          Unisci le {scelte.size > 1 ? scelte.size : ""} scelte
        </button>
      </div>

      {b.vociSenzaZona.length > 0 && (
        <details className="cantiere__riquadro">
          <summary>
            {b.vociSenzaZona.length === 1 ? "1 voce di computo senza zona" : `${b.vociSenzaZona.length} voci di computo senza zona`}
          </summary>
          <p className="cantiere__aiuto">Restano consultabili nel computo, ma non compaiono nell'avanzamento per zona.</p>
          <ul>
            {b.vociSenzaZona.slice(0, 60).map((w) => (
              <li key={w}>
                <span className="codice">{w}</span> {voci.get(w)?.descrizione ?? ""}
              </li>
            ))}
            {b.vociSenzaZona.length > 60 && <li>… altre {b.vociSenzaZona.length - 60}</li>}
          </ul>
        </details>
      )}

      {b.decisioni.length > 0 && (
        <div className="cantiere__riquadro">
          <strong>Da decidere</strong>
          {b.decisioni.map((d) => (
            <div key={d.id} className="decisione">
              <span>{d.domanda}</span>
              <div className="decisione__opzioni" role="radiogroup" aria-label={d.domanda}>
                {d.opzioni.map((o) => (
                  <button
                    key={o}
                    type="button"
                    role="radio"
                    aria-checked={d.risposta === o}
                    className={`chip${d.risposta === o ? " chip--scelto" : ""}`}
                    onClick={() => cambia((x) => ({ ...x, decisioni: x.decisioni.map((y) => (y.id === d.id ? { ...y, risposta: o } : y)) }))}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(sporca || errore) && (
        <div className="cantiere__salva" role="region" aria-label="Modifiche alle zone da salvare">
          {errore ? <span className="cantiere__errore">{errore}</span> : <span>Hai modifiche alle zone non salvate.</span>}
          <button
            type="button"
            className="btn btn--piccolo"
            disabled={occupato}
            onClick={() => {
              setB(daScheda(s));
              setSporca(false);
              setErrore(null);
            }}
          >
            Annulla
          </button>
          <button type="button" className="btn btn--piccolo btn--primario" disabled={occupato} onClick={() => void salva()}>
            {occupato ? "Salvo…" : "Salva le zone"}
          </button>
        </div>
      )}
    </section>
  );
}

// Pannello accanto alla chat di revisione: la scheda del cantiere com'è adesso, aggiornata
// a ogni modifica del Redattore. Si legge e basta: le correzioni si fanno parlando.

import { useEffect, useMemo, useState } from "react";
import {
  NOMI_DOCUMENTO_PROGETTO,
  NOMI_TIPO_ZONA,
  eScheda,
  type Fonte,
  type SchedaCantiere,
  type TabelleCantiere,
} from "../../../shared/cantieri";
import { formatEuro, formatNumero } from "../../../shared/numeri";
import { api } from "../../lib/api";
import { ricaricaCantiere, useCantiere } from "../../lib/cantieri";
import { Icona } from "../Icone";
import { controlliScheda, daVerificare } from "./controlli";
import "../documento/pannello.css";
import "./cantiere.css";

interface Props {
  cantiereId: string;
  /** Messaggio da mandare in chat a nome dell'utente (es. «Conferma la scheda»). */
  onInvia: (testo: string) => void;
  onUsa: (cantiereId: string) => void;
  onChiudi: () => void;
}

const dataIt = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);
const dedotto = (f?: Fonte) => f?.certezza === "dedotto";

function Valore({ etichetta, valore, fonte }: { etichetta: string; valore: string; fonte?: Fonte }) {
  return (
    <div className={`scheda-pannello__valore${!valore ? " scheda-pannello__valore--manca" : ""}${dedotto(fonte) && valore ? " scheda-pannello__valore--dedotto" : ""}`}>
      <dt className="etichetta-mono">{etichetta}</dt>
      <dd>
        {valore || "manca"}
        {valore && dedotto(fonte) && <span className="chip-fonte chip-fonte--dedotto">da verificare</span>}
      </dd>
    </div>
  );
}

export default function PannelloScheda({ cantiereId, onInvia, onUsa, onChiudi }: Props) {
  const voce = useCantiere(cantiereId);
  const s = voce?.stato === "pronto" && eScheda(voce.cantiere) ? voce.cantiere : null;
  const [tabelle, setTabelle] = useState<TabelleCantiere | null>(null);
  const inLettura = s?.documenti.filter((d) => d.stato === "in_coda" || d.stato === "in_lettura") ?? [];
  const lavoro = inLettura.length > 0 || Boolean(s?.zoneInPreparazione);
  const letti = s?.documenti.filter((d) => d.stato === "letto").length ?? 0;

  // Mentre il server legge i documenti allegati in chat, il pannello si aggiorna da solo.
  useEffect(() => {
    if (!lavoro) return;
    const t = window.setInterval(() => void ricaricaCantiere(cantiereId), 2000);
    return () => window.clearInterval(t);
  }, [cantiereId, lavoro]);

  useEffect(() => {
    let attuale = true;
    api.tabelleCantiere(cantiereId).then(
      (t) => attuale && setTabelle(t),
      () => undefined,
    );
    return () => {
      attuale = false;
    };
  }, [cantiereId, letti]);

  const importi = useMemo(() => new Map((tabelle?.voci ?? []).map((v) => [v.wbs, v])), [tabelle]);

  return (
    <aside className="pannello-doc scheda-pannello" aria-label="Scheda del cantiere">
      <header className="pannello-doc__testa">
        <div className="pannello-doc__titolo">
          <span className="pannello-doc__nome">{s?.nome ?? "Scheda del cantiere"}</span>
          {s?.stato === "bozza" && <span className="pillola pillola--stato-bozza">In bozza</span>}
          {s?.stato === "attiva" && <span className="pillola pillola--stato-firmato">Confermata</span>}
        </div>
        <div className="pannello-doc__azioni">
          {s?.stato === "attiva" && (
            <a className="btn btn--piccolo" href={`#/cantieri/${cantiereId}`}>
              Modifica a mano
            </a>
          )}
          <button type="button" className="btn-icona" aria-label="Chiudi la scheda" onClick={onChiudi}>
            <Icona nome="chiudi" dimensione={18} />
          </button>
        </div>
      </header>

      <div className="pannello-doc__corpo scheda-pannello__corpo">
        {!s ? (
          <p className="cantiere__aiuto">{voce?.stato === "errore" ? voce.errore : "Carico la scheda…"}</p>
        ) : (
          <SchedaLetta s={s} tabelle={tabelle} importi={importi} inLettura={inLettura.map((d) => d.nome)} onInvia={onInvia} onUsa={onUsa} />
        )}
      </div>
    </aside>
  );
}

function SchedaLetta({
  s,
  tabelle,
  importi,
  inLettura,
  onInvia,
  onUsa,
}: {
  s: SchedaCantiere;
  tabelle: TabelleCantiere | null;
  importi: Map<string, TabelleCantiere["voci"][number]>;
  inLettura: string[];
  onInvia: (testo: string) => void;
  onUsa: (id: string) => void;
}) {
  const controlli = controlliScheda(s, tabelle);
  const verificare = daVerificare(s);
  const k = s.contratto;
  const decisioniAperte = s.decisioni.filter((d) => !d.risposta);

  return (
    <>
      {(inLettura.length > 0 || s.zoneInPreparazione) && (
        <p className="cantiere__lavoro" role="status">
          <span className="documento-progetto__punto" aria-hidden="true" />
          {inLettura.length ? `Sto leggendo ${inLettura.map((n) => `«${n}»`).join(", ")}…` : "Preparo la proposta delle zone…"}
        </p>
      )}

      {s.stato === "attiva" ? (
        <section className="scheda-pannello__pronto">
          <strong>Scheda confermata</strong>
          <p className="cantiere__nota">Da ora il Redattore la usa in ogni nuovo report di questo cantiere.</p>
          <button type="button" className="btn btn--primario" onClick={() => onUsa(s.id)}>
            Inizia un report →
          </button>
        </section>
      ) : (
        <section className="scheda-pannello__sezione">
          <h3 className="scheda-pannello__titolo">Da controllare</h3>
          <ul className="cantiere__controlli">
            {controlli.map((c) => (
              <li key={c.testo} className={c.ok ? "" : "cantiere__controllo--manca"}>
                <Icona nome={c.ok ? "spunta" : "trattino"} dimensione={16} />
                {c.testo}
                {!c.ok && c.etichetta && <span className="etichetta-mono"> · {c.etichetta}</span>}
              </li>
            ))}
          </ul>
          {verificare > 0 && (
            <p className="cantiere__nota">
              {verificare === 1 ? "1 valore è" : `${verificare} valori sono`} da verificare: il Redattore te li chiede in chat.
            </p>
          )}
          <button
            type="button"
            className="btn btn--piccolo scheda-pannello__conferma"
            disabled={inLettura.length > 0}
            onClick={() => onInvia("Conferma la scheda.")}
          >
            Conferma la scheda
          </button>
        </section>
      )}

      <section className="scheda-pannello__sezione">
        <h3 className="scheda-pannello__titolo">Cantiere</h3>
        <dl className="scheda-pannello__valori">
          <Valore etichetta="Indirizzo" valore={s.indirizzo} fonte={s.fonti.indirizzo} />
          <Valore etichetta="Appalto" valore={s.fonti.appalto ? s.appalto : ""} fonte={s.fonti.appalto} />
          <Valore etichetta="Lavori" valore={s.lavori} fonte={s.fonti.lavori} />
          {Object.entries(s.anagrafica).map(([voce, v]) => (
            <Valore key={voce} etichetta={voce} valore={v} fonte={s.fonti[`anagrafica.${voce}`]} />
          ))}
        </dl>
      </section>

      <section className="scheda-pannello__sezione">
        <h3 className="scheda-pannello__titolo">Soggetti</h3>
        {s.soggetti.length ? (
          <ul className="scheda-pannello__elenco">
            {s.soggetti.map((x, i) => (
              <li key={i} className={dedotto(x.fonte) ? "scheda-pannello__valore--dedotto" : ""}>
                <span className="etichetta-mono">{x.ruolo}</span>
                <span>
                  {x.nome}
                  {dedotto(x.fonte) && <span className="chip-fonte chip-fonte--dedotto">da verificare</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cantiere__aiuto">Nessun soggetto ancora.</p>
        )}
      </section>

      <section className="scheda-pannello__sezione">
        <h3 className="scheda-pannello__titolo">Contratto e date</h3>
        <dl className="scheda-pannello__valori">
          <Valore etichetta="Importo" valore={k.importo === null ? "" : formatEuro(k.importo)} fonte={s.fonti["contratto.importo"]} />
          <Valore etichetta="Oneri sicurezza" valore={k.oneriSicurezza === null ? "" : formatEuro(k.oneriSicurezza)} fonte={s.fonti["contratto.oneriSicurezza"]} />
          <Valore etichetta="Ribasso" valore={k.ribassoPercentuale === null ? "" : `${formatNumero(k.ribassoPercentuale, 3)}%`} fonte={s.fonti["contratto.ribassoPercentuale"]} />
          <Valore etichetta="Ritenuta" valore={k.ritenutaPercentuale === null ? "" : `${formatNumero(k.ritenutaPercentuale)}%`} fonte={s.fonti["contratto.ritenutaPercentuale"]} />
          <Valore etichetta="Consegna lavori" valore={dataIt(s.date.consegnaLavori)} fonte={s.fonti["date.consegnaLavori"]} />
          <Valore etichetta="Durata" valore={s.date.durataGiorni === null ? "" : `${s.date.durataGiorni} giorni`} fonte={s.fonti["date.durataGiorni"]} />
          <Valore etichetta="Ultimazione" valore={dataIt(s.date.ultimazionePrevista)} fonte={s.fonti["date.ultimazionePrevista"]} />
        </dl>
      </section>

      {s.lavorazioni.length > 0 && (
        <details className="scheda-pannello__sezione scheda-pannello__apribile">
          <summary className="scheda-pannello__titolo">Lavorazioni previste · {s.lavorazioni.length}</summary>
          <ul className="scheda-pannello__elenco">
            {s.lavorazioni.map((l, i) => (
              <li key={i}>
                {l.categoria && <span className="etichetta-mono">{l.categoria}</span>}
                <span>{l.descrizione}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {s.anomalie.length > 0 && (
        <section className="scheda-pannello__sezione cantiere__riquadro cantiere__riquadro--attenzione">
          <h3 className="scheda-pannello__titolo">
            {s.anomalie.length === 1 ? "1 anomalia del computo" : `${s.anomalie.length} anomalie del computo`}
          </h3>
          <ul className="scheda-pannello__elenco">
            {s.anomalie.slice(0, 12).map((a) => (
              <li key={`${a.wbs}|${a.tipo}`}>
                <span className="codice">{a.wbs}</span>
                <span>
                  {importi.get(a.wbs)?.descrizione ? `${importi.get(a.wbs)!.descrizione.slice(0, 70)} · ` : ""}
                  <span className="cantiere__aiuto">{a.descrizione}</span>
                </span>
              </li>
            ))}
          </ul>
          {s.anomalie.length > 12 && <p className="cantiere__aiuto">… e altre {s.anomalie.length - 12}.</p>}
        </section>
      )}

      <section className="scheda-pannello__sezione">
        <h3 className="scheda-pannello__titolo">Zone{s.zone.length ? ` · ${s.zone.length}` : ""}</h3>
        {s.zone.length ? (
          <ul className="scheda-pannello__elenco">
            {s.zone.map((z) => {
              const importo = z.vociComputo.reduce((t, w) => t + (importi.get(w)?.importo ?? 0), 0);
              return (
                <li key={z.id} className={z.certezza === "dedotto" ? "scheda-pannello__valore--dedotto" : ""}>
                  <span className="etichetta-mono">
                    {z.piano || NOMI_TIPO_ZONA[z.tipo]}
                  </span>
                  <span>
                    {z.nome}
                    <span className="cantiere__aiuto">
                      {" "}
                      · {z.vociComputo.length} {z.vociComputo.length === 1 ? "voce" : "voci"}
                      {importo ? ` · ${formatEuro(importo)}` : ""} · {z.attivita.length} attività
                    </span>
                    {z.certezza === "dedotto" && <span className="chip-fonte chip-fonte--dedotto">da verificare</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="cantiere__aiuto">{s.zoneInPreparazione ? "In preparazione." : "Nessuna zona ancora."}</p>
        )}
        {s.vociSenzaZona.length > 0 && (
          <p className="cantiere__aiuto">
            {s.vociSenzaZona.length === 1 ? "1 voce di computo è" : `${s.vociSenzaZona.length} voci di computo sono`} senza zona.
          </p>
        )}
        {decisioniAperte.map((d) => (
          <p key={d.id} className="cantiere__nota">
            <strong>Da decidere:</strong> {d.domanda}
          </p>
        ))}
      </section>

      <section className="scheda-pannello__sezione">
        <h3 className="scheda-pannello__titolo">Documenti di progetto</h3>
        {s.documenti.length ? (
          <ul className="scheda-pannello__elenco">
            {s.documenti.map((d) => (
              <li key={d.id}>
                <span className="etichetta-mono">{NOMI_DOCUMENTO_PROGETTO[d.tipo]}</span>
                <span>
                  {d.nome}
                  <span className={d.stato === "errore" ? "cantiere__errore" : "cantiere__aiuto"}>
                    {" "}
                    · {d.stato === "letto" ? d.trovato : d.stato === "errore" ? (d.errore ?? "non letto") : "in lettura"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cantiere__aiuto">Nessun documento: allegali in chat con la graffetta.</p>
        )}
      </section>
    </>
  );
}

// Tutti i documenti della persona: bozze e ultimati (firmati o segnati come definitivi),
// con filtri per cantiere e tipo. L'amministratore può vedere quelli di tutte le persone.

import { useEffect, useMemo, useState } from "react";
import { TIPI_DOCUMENTO, tipoDocumento } from "../../../shared/documenti";
import { linkDocumento, type StatoDocumento, type VoceArchivio } from "../../../shared/versioni";
import { api, scaricaPdf } from "../../lib/api";
import { quando } from "../../lib/date";
import { nomeFile } from "../../lib/documenti";
import { cantieriConsentiti, infoCantiere, useSessione } from "../../lib/sessione";
import { Icona } from "../Icone";
import "./documenti.css";

type Filtro = "tutti" | "bozze" | "ultimati";

const ETICHETTE: Record<StatoDocumento, string> = { bozza: "Bozza", definitivo: "Definitivo", firmato: "Firmato" };

export function PillolaStato({ stato }: { stato: StatoDocumento }) {
  return <span className={`pillola pillola--stato-${stato}`}>{ETICHETTE[stato]}</span>;
}

function mese(iso: string) {
  const t = new Date(iso).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function PaginaDocumenti({ onApriMenu }: { onApriMenu: () => void }) {
  const s = useSessione();
  const [filtro, setFiltro] = useState<Filtro>("tutti");
  const [cerca, setCerca] = useState("");
  const [cantiereId, setCantiereId] = useState("");
  const [tipo, setTipo] = useState("");
  const [tutte, setTutte] = useState(false);
  const [voci, setVoci] = useState<VoceArchivio[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [pdfInCorso, setPdfInCorso] = useState<string | null>(null);

  useEffect(() => {
    let attuale = true;
    const attesa = window.setTimeout(() => {
      api
        .documenti({
          stato: filtro === "tutti" ? undefined : filtro,
          cerca: cerca.trim() || undefined,
          cantiere: cantiereId || undefined,
          tipo: tipo || undefined,
          persona: tutte ? "tutte" : undefined,
        })
        .then(
          (v) => attuale && (setVoci(v), setErrore(null)),
          (e: Error) => attuale && setErrore(e.message),
        );
    }, cerca ? 200 : 0);
    return () => {
      attuale = false;
      window.clearTimeout(attesa);
    };
  }, [filtro, cerca, cantiereId, tipo, tutte]);

  const gruppi = useMemo(() => {
    const g = new Map<string, VoceArchivio[]>();
    for (const v of voci ?? []) {
      const m = mese(v.aggiornatoIl);
      g.set(m, [...(g.get(m) ?? []), v]);
    }
    return [...g.entries()];
  }, [voci]);

  const filtriAttivi = Boolean(cerca || cantiereId || tipo || filtro !== "tutti");
  const togliFiltri = () => {
    setFiltro("tutti");
    setCerca("");
    setCantiereId("");
    setTipo("");
  };

  async function pdf(v: VoceArchivio) {
    const chiave = `${v.conversazione}/${v.id}`;
    setPdfInCorso(chiave);
    try {
      await scaricaPdf(v.conversazione, v.id, v.versione, nomeFile(`${v.titolo} v${v.versione}`, "pdf"));
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setPdfInCorso(null);
    }
  }

  const cantieri = cantieriConsentiti();

  return (
    <main className="vista documenti">
      <header className="testata testata--bordo">
        <div className="testata__sinistra">
          <button type="button" className="btn-icona testata__menu" aria-label="Apri menu" onClick={onApriMenu}>
            <Icona nome="menu" dimensione={22} />
          </button>
          <h1 className="testata__titolo documenti__titolo">Documenti</h1>
        </div>
        {s?.persona.admin && (
          <label className="documenti__persone">
            <input type="checkbox" checked={tutte} onChange={(e) => setTutte(e.target.checked)} />
            Tutte le persone
          </label>
        )}
      </header>

      <div className="documenti__corpo">
        <div className="documenti__filtri">
          <div className="documenti__schede" role="radiogroup" aria-label="Stato">
            {(["tutti", "bozze", "ultimati"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={filtro === f}
                className={`documenti__scheda${filtro === f ? " documenti__scheda--scelta" : ""}`}
                onClick={() => setFiltro(f)}
              >
                {f === "tutti" ? "Tutti" : f === "bozze" ? "Bozze" : "Ultimati"}
              </button>
            ))}
          </div>
          <label className="documenti__cerca">
            <Icona nome="cerca" dimensione={16} />
            <span className="sr-only">Cerca per titolo</span>
            <input type="search" placeholder="Cerca per titolo" value={cerca} onChange={(e) => setCerca(e.target.value)} />
          </label>
          {cantieri.length > 1 && (
            <label className="documenti__scelta">
              <span className="sr-only">Cantiere</span>
              <select value={cantiereId} onChange={(e) => setCantiereId(e.target.value)}>
                <option value="">Tutti i cantieri</option>
                {cantieri.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.breve}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="documenti__scelta">
            <span className="sr-only">Tipo di documento</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Tutti i tipi</option>
              {TIPI_DOCUMENTO.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </label>
        </div>

        {errore && (
          <p className="documenti__errore" role="alert">
            {errore}
          </p>
        )}

        {voci === null && !errore && <p className="documenti__vuoto">Carico i documenti…</p>}

        {voci?.length === 0 &&
          (filtriAttivi ? (
            <div className="documenti__vuoto">
              <p>Nessun documento con questi filtri.</p>
              <button type="button" className="btn btn--piccolo" onClick={togliFiltri}>
                Togli i filtri
              </button>
            </div>
          ) : (
            <div className="documenti__vuoto">
              <p>
                Qui trovi le bozze e i documenti ultimati. Prepara un report e chiedi la bozza al Redattore: comparirà
                qui. Quando la firmi o la segni come definitiva passa tra gli ultimati.
              </p>
              <a className="btn btn--piccolo btn--primario" href="#/">
                Nuovo report
              </a>
            </div>
          ))}

        {gruppi.map(([titolo, elenco]) => (
          <section key={titolo} className="documenti__gruppo" aria-label={titolo}>
            <h2 className="etichetta-mono documenti__mese">{titolo}</h2>
            <ul className="documenti__elenco">
              {elenco.map((v) => {
                const t = tipoDocumento(v.tipo);
                const chiave = `${v.conversazione}/${v.id}`;
                return (
                  <li key={chiave} className="documenti__voce">
                    <span className={`documenti__icona${t?.attenzione ? " documenti__icona--attenzione" : ""}`} aria-hidden="true">
                      <Icona nome={t?.icona ?? "documento"} dimensione={18} />
                    </span>
                    <a className="documenti__testo" href={linkDocumento(v)}>
                      <span className="documenti__nome">{v.titolo}</span>
                      <span className="documenti__dettagli">
                        {[
                          infoCantiere(v.cantiereId).breve,
                          quando(v.aggiornatoIl),
                          v.versioni > 1 ? `v${v.versione} di ${v.versioni}` : `v${v.versione}`,
                          v.modificata ? "modificata a mano" : "",
                          v.persona ?? "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {v.stato === "firmato" && v.firmatoDa.length > 0 && (
                        <span className="documenti__nota">Firmato da {v.firmatoDa.join(", ")}</span>
                      )}
                      {v.precedenteUltimata && (
                        <span className="documenti__nota">
                          La v{v.precedenteUltimata.versione} è {v.precedenteUltimata.stato === "firmato" ? "firmata" : "definitiva"}: questa è una bozza successiva
                        </span>
                      )}
                    </a>
                    <PillolaStato stato={v.stato} />
                    <span className="documenti__azioni">
                      <button
                        type="button"
                        className="btn btn--piccolo"
                        disabled={pdfInCorso === chiave}
                        onClick={() => void pdf(v)}
                        aria-label={`Scarica il PDF di ${v.titolo}`}
                      >
                        <Icona nome="scarica" dimensione={15} />
                        {pdfInCorso === chiave ? "PDF…" : "PDF"}
                      </button>
                      <a className="btn btn--piccolo" href={linkDocumento(v)}>
                        Apri
                      </a>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

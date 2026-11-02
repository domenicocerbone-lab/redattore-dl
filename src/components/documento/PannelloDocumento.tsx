// Pannello laterale con la bozza: versioni, modifica a mano, copia ed esportazione.

import { useEffect, useRef, useState } from "react";
import type { Documento, ModificaManuale, Parziale, RifDocumento } from "../../../shared/schema";
import { chiaveVersione } from "../../../shared/schema";
import { api } from "../../lib/api";
import { esportaExcel, esportaWord, testoDelFoglio } from "../../lib/documenti";
import { salvaModifica } from "../../lib/stato";
import { Icona } from "../Icone";
import { Menu, VoceMenu } from "../Menu";
import { DocumentoView } from "./DocumentoView";
import "./pannello.css";

interface Props {
  conversazioneId: string;
  documento: Parziale<Documento>;
  rif: RifDocumento | null;
  versioni: RifDocumento[];
  modifica?: ModificaManuale;
  onVersione: (rif: RifDocumento) => void;
  onChiudi: () => void;
}

export function PannelloDocumento(p: Props) {
  const foglio = useRef<HTMLDivElement>(null);
  const [inModifica, setInModifica] = useState(false);
  const [salvataggio, setSalvataggio] = useState(false);
  const [copiato, setCopiato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [rivisione, setRevisione] = useState(0);
  const inScrittura = p.rif === null;
  const titolo = p.documento.titolo || "Bozza";
  const sal = p.documento.tipo_documento === "sal";

  const articolo = () => foglio.current?.querySelector<HTMLElement>("article.doc") ?? null;

  useEffect(() => {
    setInModifica(false);
    setErrore(null);
  }, [p.rif?.id, p.rif?.versione]);

  useEffect(() => {
    const a = articolo();
    if (!a) return;
    a.contentEditable = inModifica ? "true" : "false";
    if (inModifica) a.focus();
  }, [inModifica, rivisione]);

  async function salva() {
    const a = articolo();
    if (!a || !p.rif) return;
    setSalvataggio(true);
    setErrore(null);
    try {
      a.contentEditable = "false";
      await salvaModifica(p.conversazioneId, chiaveVersione(p.rif), testoDelFoglio(a), a.innerHTML);
      setInModifica(false);
    } catch (e) {
      setErrore((e as Error).message);
      a.contentEditable = "true";
    } finally {
      setSalvataggio(false);
    }
  }

  function annulla() {
    setInModifica(false);
    setRevisione((r) => r + 1);
  }

  function esportato(formato: "pdf" | "word" | "excel") {
    api.evento({ tipo: "esportazione", formato, conversazione: p.conversazioneId, documento: titolo });
  }

  function copia() {
    const a = articolo();
    if (!a) return;
    void navigator.clipboard.writeText(testoDelFoglio(a)).then(() => {
      api.evento({ tipo: "copia", cosa: "documento", conversazione: p.conversazioneId });
      setCopiato(true);
      window.setTimeout(() => setCopiato(false), 1500);
    });
  }

  const etichettaVersione = inScrittura
    ? "In scrittura…"
    : `V${p.rif!.versione}${p.modifica ? " · modificata" : ""}`;

  return (
    <section
      aria-label="Documento"
      className={`pannello-doc${sal ? " pannello-doc--largo" : p.documento.tipo_documento === "giornale_lavori" ? " pannello-doc--stretto" : ""}`}
    >
      <header className="pannello-doc__testa">
        <div className="pannello-doc__titolo">
          <span className="pannello-doc__nome">{titolo}</span>
          {p.versioni.length > 1 && !inScrittura ? (
            <Menu
              className="pillola pillola--neutra pannello-doc__versione"
              contenuto={
                <>
                  {etichettaVersione}
                  <Icona nome="giu" dimensione={12} />
                </>
              }
              larghezza={180}
            >
              {(chiudi) =>
                [...p.versioni].reverse().map((v) => (
                  <VoceMenu
                    key={v.versione}
                    attiva={v.versione === p.rif?.versione}
                    onClick={() => {
                      p.onVersione(v);
                      chiudi();
                    }}
                  >
                    Versione {v.versione}
                  </VoceMenu>
                ))
              }
            </Menu>
          ) : (
            <span className={`pillola pillola--neutra${inScrittura ? " pannello-doc__scrittura" : ""}`}>{etichettaVersione}</span>
          )}
        </div>
        <div className="pannello-doc__azioni">
          {inModifica ? (
            <>
              <button type="button" className="btn btn--piccolo" onClick={annulla} disabled={salvataggio}>
                Annulla
              </button>
              <button type="button" className="btn btn--piccolo btn--primario" onClick={() => void salva()} disabled={salvataggio}>
                {salvataggio ? "Salvo…" : "Salva modifiche"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn--piccolo" disabled={inScrittura} onClick={() => setInModifica(true)}>
                <Icona nome="matita" dimensione={15} />
                Modifica
              </button>
              <button type="button" className="btn btn--piccolo" disabled={inScrittura} onClick={copia}>
                <Icona nome={copiato ? "spunta" : "copia"} dimensione={15} />
                {copiato ? "Copiato" : "Copia"}
              </button>
              {sal && (
                <button
                  type="button"
                  className="btn btn--piccolo"
                  disabled={inScrittura}
                  onClick={() => {
                    const a = articolo();
                    if (a) esportaExcel(titolo, a);
                    esportato("excel");
                  }}
                >
                  Esporta Excel
                </button>
              )}
              {sal ? (
                <button
                  type="button"
                  className="btn btn--piccolo btn--primario"
                  disabled={inScrittura}
                  onClick={() => {
                    esportato("pdf");
                    window.print();
                  }}
                >
                  Esporta PDF ↓
                </button>
              ) : (
                <Menu
                  className="btn btn--piccolo btn--primario"
                  disabled={inScrittura}
                  allinea="destra"
                  larghezza={220}
                  contenuto="Esporta PDF / Word ↓"
                >
                  {(chiudi) => (
                    <>
                      <VoceMenu
                        onClick={() => {
                          chiudi();
                          esportato("pdf");
                          window.print();
                        }}
                      >
                        <Icona nome="documento" dimensione={16} />
                        PDF (stampa)
                      </VoceMenu>
                      <VoceMenu
                        onClick={() => {
                          chiudi();
                          const a = articolo();
                          if (a) esportaWord(titolo, a);
                          esportato("word");
                        }}
                      >
                        <Icona nome="scarica" dimensione={16} />
                        Word (.doc)
                      </VoceMenu>
                    </>
                  )}
                </Menu>
              )}
            </>
          )}
          <button type="button" className="btn-icona" aria-label="Chiudi documento" onClick={p.onChiudi}>
            <Icona nome="chiudi" dimensione={16} />
          </button>
        </div>
      </header>
      {errore && (
        <div className="pannello-doc__errore" role="alert">
          {errore}
        </div>
      )}
      <div className="pannello-doc__corpo" ref={foglio} key={`${p.rif?.id}@${p.rif?.versione}#${rivisione}`}>
        <DocumentoView documento={p.documento} html={p.modifica?.html} />
      </div>
    </section>
  );
}

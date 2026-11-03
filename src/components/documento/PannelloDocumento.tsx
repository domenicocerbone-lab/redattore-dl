// Pannello laterale con la bozza: versioni, modifica a mano, copia, esportazione,
// firma e stato (bozza, definitivo, firmato).

import { useEffect, useRef, useState } from "react";
import type { Documento, FirmaApposta, ModificaManuale, Parziale, RifDocumento } from "../../../shared/schema";
import { chiaveVersione } from "../../../shared/schema";
import type { StatoDocumento } from "../../../shared/versioni";
import { api, scaricaPdf, urlFirma } from "../../lib/api";
import { esportaExcel, esportaWord, nomeFile, testoDelFoglio } from "../../lib/documenti";
import { useSessione } from "../../lib/sessione";
import { apponiFirma, impostaDefinitivo, salvaModifica, togliFirma } from "../../lib/stato";
import { Icona } from "../Icone";
import { Menu, VoceMenu } from "../Menu";
import { DocumentoView, type FirmaVisibile } from "./DocumentoView";
import "./documento.css";
import "./stampa.css";
import "./pannello.css";

interface Props {
  conversazioneId: string;
  documento: Parziale<Documento>;
  rif: RifDocumento | null;
  versioni: RifDocumento[];
  modifica?: ModificaManuale;
  firme: FirmaApposta[];
  stato: StatoDocumento;
  onVersione: (rif: RifDocumento) => void;
  onChiudi: () => void;
}

const PAROLE_VUOTE = new Set(["della", "delle", "dello", "degli", "nella", "nelle", "per", "dei", "del", "fase"]);

const parole = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z]+/)
    .filter((p) => p.length > 2 && !PAROLE_VUOTE.has(p));

/** I riquadri firma che corrispondono al ruolo della persona (tutte le parole del ruolo presenti). */
function riquadriDelRuolo(firme: { ruolo?: string }[], ruolo: string): number[] {
  const cercate = parole(ruolo);
  if (cercate.length === 0) return [];
  return firme.flatMap((f, i) => {
    const presenti = new Set(parole(f.ruolo ?? ""));
    return cercate.every((p) => presenti.has(p)) ? [i] : [];
  });
}

export function PannelloDocumento(p: Props) {
  const foglio = useRef<HTMLDivElement>(null);
  const s = useSessione();
  const [inModifica, setInModifica] = useState(false);
  const [occupato, setOccupato] = useState<null | "salvo" | "pdf" | "firma" | "stato">(null);
  const [copiato, setCopiato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [rivisione, setRevisione] = useState(0);
  const inScrittura = p.rif === null;
  const titolo = p.documento.titolo || "Bozza";
  const sal = p.documento.tipo_documento === "sal";
  const riquadri = p.documento.firme ?? [];
  const miaFirma = s?.firma ?? null;
  const firmataDaMe = Boolean(s && p.firme.some((f) => f.personaId === s.persona.id));
  const chiave = p.rif ? chiaveVersione(p.rif) : "";

  const articolo = () => foglio.current?.querySelector<HTMLElement>("article.doc") ?? null;
  const contenuto = () => foglio.current?.querySelector<HTMLElement>(".doc-contenuto") ?? null;

  useEffect(() => {
    setInModifica(false);
    setErrore(null);
  }, [p.rif?.id, p.rif?.versione]);

  useEffect(() => {
    const c = contenuto();
    if (!c) return;
    c.contentEditable = inModifica ? "true" : "false";
    if (inModifica) c.focus();
  }, [inModifica, rivisione]);

  async function esegui(cosa: NonNullable<typeof occupato>, lavoro: () => Promise<unknown>) {
    setOccupato(cosa);
    setErrore(null);
    try {
      await lavoro();
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(null);
    }
  }

  async function salva() {
    const c = contenuto();
    if (!c || !p.rif) return;
    c.contentEditable = "false";
    await esegui("salvo", async () => {
      try {
        await salvaModifica(p.conversazioneId, chiave, testoDelFoglio(c), c.innerHTML);
        setInModifica(false);
      } catch (e) {
        c.contentEditable = "true";
        throw e;
      }
    });
  }

  function annulla() {
    setInModifica(false);
    setRevisione((r) => r + 1);
  }

  function iniziaModifica() {
    if (p.stato !== "bozza") {
      const avviso =
        p.stato === "firmato"
          ? "Modificando questa versione la firma verrà tolta e tornerà bozza. Continuare?"
          : "Modificando questa versione tornerà bozza. Continuare?";
      if (!window.confirm(avviso)) return;
    }
    setInModifica(true);
  }

  function esportato(formato: "stampa" | "word" | "excel") {
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

  const pdf = () =>
    esegui("pdf", () =>
      scaricaPdf(p.conversazioneId, p.rif!.id, p.rif!.versione, nomeFile(`${titolo} v${p.rif!.versione}`, "pdf")),
    );

  const firma = (slot: number) => esegui("firma", () => apponiFirma(p.conversazioneId, chiave, slot));

  const etichettaVersione = inScrittura
    ? "In scrittura…"
    : `V${p.rif!.versione}${p.modifica ? " · modificata" : ""}`;

  const firmeVisibili: FirmaVisibile[] = p.firme.map((f) => ({ ...f, src: urlFirma(f.hash) }));
  const delRuolo = s ? riquadriDelRuolo(riquadri, s.persona.ruolo) : [];

  function pulsanteFirma() {
    const disabilitato = inScrittura || occupato !== null;
    if (firmataDaMe) {
      return (
        <Menu
          className="btn btn--piccolo btn--firmata"
          disabled={disabilitato}
          allinea="destra"
          larghezza={220}
          contenuto={
            <>
              <Icona nome="spunta" dimensione={15} />
              Firmata
            </>
          }
        >
          {(chiudi) => (
            <VoceMenu
              onClick={() => {
                chiudi();
                void esegui("firma", () => togliFirma(p.conversazioneId, chiave));
              }}
            >
              Togli la mia firma
            </VoceMenu>
          )}
        </Menu>
      );
    }
    if (!miaFirma) {
      return (
        <button
          type="button"
          className="btn btn--piccolo btn--primario"
          disabled={disabilitato}
          title="Imposta prima la tua firma nel Profilo"
          onClick={() => (window.location.hash = "#/profilo")}
        >
          <Icona nome="firma" dimensione={15} />
          Firma
        </button>
      );
    }
    if (riquadri.length === 0) {
      return (
        <button type="button" className="btn btn--piccolo btn--primario" disabled title="Il documento non ha riquadri firma">
          <Icona nome="firma" dimensione={15} />
          Firma
        </button>
      );
    }
    if (delRuolo.length === 1) {
      return (
        <button
          type="button"
          className="btn btn--piccolo btn--primario"
          disabled={disabilitato}
          title={`Firma come «${riquadri[delRuolo[0]]?.ruolo}»`}
          onClick={() => void firma(delRuolo[0])}
        >
          <Icona nome="firma" dimensione={15} />
          {occupato === "firma" ? "Firmo…" : "Firma"}
        </button>
      );
    }
    return (
      <Menu
        className="btn btn--piccolo btn--primario"
        disabled={disabilitato}
        allinea="destra"
        larghezza={260}
        contenuto={
          <>
            <Icona nome="firma" dimensione={15} />
            {occupato === "firma" ? "Firmo…" : "Firma come…"}
          </>
        }
      >
        {(chiudi) =>
          riquadri.map((r, i) => (
            <VoceMenu
              key={i}
              onClick={() => {
                chiudi();
                void firma(i);
              }}
            >
              {r.ruolo}
            </VoceMenu>
          ))
        }
      </Menu>
    );
  }

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
          {!inScrittura && p.stato !== "bozza" && (
            <span className={`pillola pillola--stato-${p.stato}`}>{p.stato === "firmato" ? "Firmata" : "Definitiva"}</span>
          )}
        </div>
        <div className="pannello-doc__azioni">
          {inModifica ? (
            <>
              <button type="button" className="btn btn--piccolo" onClick={annulla} disabled={occupato === "salvo"}>
                Annulla
              </button>
              <button type="button" className="btn btn--piccolo btn--primario" onClick={() => void salva()} disabled={occupato === "salvo"}>
                {occupato === "salvo" ? "Salvo…" : "Salva modifiche"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn--piccolo" disabled={inScrittura} onClick={iniziaModifica}>
                <Icona nome="matita" dimensione={15} />
                Modifica
              </button>
              <button type="button" className="btn btn--piccolo" disabled={inScrittura} onClick={copia}>
                <Icona nome={copiato ? "spunta" : "copia"} dimensione={15} />
                {copiato ? "Copiato" : "Copia"}
              </button>
              <Menu
                className="btn btn--piccolo"
                disabled={inScrittura || occupato === "pdf"}
                allinea="destra"
                larghezza={230}
                contenuto={occupato === "pdf" ? "Preparo il PDF…" : "Esporta ↓"}
              >
                {(chiudi) => (
                  <>
                    <VoceMenu
                      onClick={() => {
                        chiudi();
                        void pdf();
                      }}
                    >
                      <Icona nome="scarica" dimensione={16} />
                      PDF
                    </VoceMenu>
                    <VoceMenu
                      onClick={() => {
                        chiudi();
                        esportato("stampa");
                        window.print();
                      }}
                    >
                      <Icona nome="stampa" dimensione={16} />
                      Stampa
                    </VoceMenu>
                    <VoceMenu
                      onClick={() => {
                        chiudi();
                        const a = articolo();
                        if (a) esportaWord(titolo, a);
                        esportato("word");
                      }}
                    >
                      <Icona nome="documento" dimensione={16} />
                      Word (.doc)
                    </VoceMenu>
                    {sal && (
                      <VoceMenu
                        onClick={() => {
                          chiudi();
                          const a = articolo();
                          if (a) esportaExcel(titolo, a);
                          esportato("excel");
                        }}
                      >
                        <Icona nome="barre" dimensione={16} />
                        Excel (.csv)
                      </VoceMenu>
                    )}
                  </>
                )}
              </Menu>
              {pulsanteFirma()}
              <Menu
                className="btn-icona"
                ariaLabel="Altre azioni sul documento"
                disabled={inScrittura || occupato !== null}
                allinea="destra"
                larghezza={260}
                contenuto={<Icona nome="altro" dimensione={18} />}
              >
                {(chiudi) =>
                  p.stato === "firmato" ? (
                    <p className="menu__nota">Versione firmata: per riaprirla togli la firma o chiedi una modifica in chat.</p>
                  ) : (
                    <VoceMenu
                      onClick={() => {
                        chiudi();
                        void esegui("stato", () => impostaDefinitivo(p.conversazioneId, chiave, p.stato !== "definitivo"));
                      }}
                    >
                      <Icona nome={p.stato === "definitivo" ? "rigenera" : "spunta"} dimensione={16} />
                      {p.stato === "definitivo" ? "Riporta in bozza" : "Segna come definitivo"}
                    </VoceMenu>
                  )
                }
              </Menu>
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
        <DocumentoView documento={p.documento} html={p.modifica?.html} firmeApposte={firmeVisibili} />
      </div>
    </section>
  );
}

// Profilo della persona: chi è e la sua firma grafica, apposta con un clic sulle versioni
// che ha controllato.

import { useEffect, useRef, useState, type PointerEvent as EventoPuntatore } from "react";
import { api, urlFirma } from "../../lib/api";
import { caricaSuTela, firmaDallaTela, separaTitolo } from "../../lib/firma";
import { aggiornaSessione, useSessione } from "../../lib/sessione";
import { Icona } from "../Icone";
import "./profilo.css";

const ALTEZZA_TELA = 180;
const INCHIOSTRO = "#0c0a08";

/** Tela su cui disegnare la firma con dito, penna o mouse. */
function TelaFirma({ tela, onCambia }: { tela: React.RefObject<HTMLCanvasElement>; onCambia: (vuota: boolean) => void }) {
  const ultimo = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = tela.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(ALTEZZA_TELA * dpr);
  }, [tela]);

  function punto(e: EventoPuntatore<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * e.currentTarget.width,
      y: ((e.clientY - r.top) / r.height) * e.currentTarget.height,
    };
  }

  function traccia(e: EventoPuntatore<HTMLCanvasElement>) {
    if (!ultimo.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = punto(e);
    const dpr = window.devicePixelRatio || 1;
    const pressione = e.pressure > 0 && e.pointerType === "pen" ? 0.6 + e.pressure : 1;
    ctx.strokeStyle = INCHIOSTRO;
    ctx.lineWidth = 2.4 * dpr * pressione;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(ultimo.current.x, ultimo.current.y);
    const medio = { x: (ultimo.current.x + p.x) / 2, y: (ultimo.current.y + p.y) / 2 };
    ctx.quadraticCurveTo(ultimo.current.x, ultimo.current.y, medio.x, medio.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimo.current = p;
  }

  return (
    <canvas
      ref={tela}
      className="profilo__tela"
      style={{ height: ALTEZZA_TELA }}
      aria-label="Riquadro per disegnare la firma"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        ultimo.current = punto(e);
        onCambia(false);
      }}
      onPointerMove={traccia}
      onPointerUp={() => (ultimo.current = null)}
      onPointerCancel={() => (ultimo.current = null)}
    />
  );
}

export default function PaginaProfilo({ onApriMenu }: { onApriMenu: () => void }) {
  const s = useSessione();
  const firma = s?.firma ?? null;
  const [inModifica, setInModifica] = useState(!firma);
  const predefiniti = separaTitolo(s?.persona.nome ?? "");
  const [titolo, setTitolo] = useState(firma?.titolo ?? predefiniti.titolo);
  const [nome, setNome] = useState(firma?.nome ?? predefiniti.nome);
  const [albo, setAlbo] = useState(firma?.albo ?? "");
  const [telaVuota, setTelaVuota] = useState(true);
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [salvata, setSalvata] = useState(false);
  const tela = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);

  if (!s) return null;

  function pulisci() {
    const c = tela.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(ALTEZZA_TELA * dpr);
    setTelaVuota(true);
  }

  async function caricata(f: File | undefined) {
    if (!f || !tela.current) return;
    setErrore(null);
    try {
      await caricaSuTela(f, tela.current);
      setTelaVuota(false);
    } catch {
      setErrore("Non riesco a leggere l'immagine: usa un PNG o un JPG.");
    }
  }

  async function salva() {
    setErrore(null);
    const immagine = telaVuota ? undefined : (firmaDallaTela(tela.current!) ?? undefined);
    if (!immagine && !firma) {
      setErrore("Disegna la firma nel riquadro o carica un'immagine.");
      return;
    }
    setOccupato(true);
    try {
      const nuova = await api.salvaFirma({ immagine, nome, titolo, albo });
      aggiornaSessione({ firma: nuova });
      setInModifica(false);
      setTelaVuota(true);
      setSalvata(true);
      window.setTimeout(() => setSalvata(false), 2500);
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  async function rimuovi() {
    if (!window.confirm("Togliere la firma dal profilo? I documenti già firmati restano firmati.")) return;
    setOccupato(true);
    try {
      await api.eliminaFirma();
      aggiornaSessione({ firma: null });
      setInModifica(true);
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  return (
    <main className="vista profilo">
      <header className="testata testata--bordo">
        <div className="testata__sinistra">
          <button type="button" className="btn-icona testata__menu" aria-label="Apri menu" onClick={onApriMenu}>
            <Icona nome="menu" dimensione={22} />
          </button>
          <h1 className="testata__titolo profilo__titolo">Profilo</h1>
        </div>
      </header>

      <div className="profilo__corpo">
        <section className="profilo__scheda profilo__chi" aria-label="Chi sei">
          <span className="avatar profilo__avatar" aria-hidden="true">
            {s.iniziali}
          </span>
          <span>
            <strong>{s.persona.nome}</strong>
            <span className="etichetta-mono">{s.persona.ruolo}</span>
          </span>
        </section>

        <section className="profilo__scheda" aria-labelledby="titolo-firma">
          <div className="profilo__intestazione">
            <h2 id="titolo-firma" className="profilo__sottotitolo">
              Firma
            </h2>
            {salvata && (
              <span className="pillola pillola--stato-firmato" role="status">
                Salvata
              </span>
            )}
          </div>
          <p className="profilo__nota">
            Compare nei documenti solo quando premi <strong>Firma</strong> su una versione che hai controllato. Se poi la
            versione cambia, la firma va rimessa.
          </p>

          {firma && !inModifica ? (
            <>
              <div className="profilo__anteprima">
                <img src={urlFirma(firma.hash)} alt={`Firma di ${firma.nome}`} />
                <span className="profilo__linea">{[firma.titolo, firma.nome].filter(Boolean).join(" ")}</span>
                {firma.albo && <span className="profilo__albo">{firma.albo}</span>}
              </div>
              <div className="profilo__pulsanti">
                <button type="button" className="btn btn--piccolo" onClick={() => void rimuovi()} disabled={occupato}>
                  Togli la firma
                </button>
                <button type="button" className="btn btn--piccolo btn--primario" onClick={() => setInModifica(true)}>
                  <Icona nome="matita" dimensione={15} />
                  Cambia
                </button>
              </div>
            </>
          ) : (
            <div className="profilo__modulo">
              <div className="profilo__campo">
                <span className="etichetta-mono">
                  {firma ? "Nuova firma (lascia vuoto per tenere quella attuale)" : "Disegna la firma qui sotto"}
                </span>
                <div className="profilo__riquadro">
                  <TelaFirma tela={tela} onCambia={setTelaVuota} />
                  <span className="profilo__guida" aria-hidden="true" />
                  {telaVuota && (
                    <span className="profilo__suggerimento" aria-hidden="true">
                      Firma con il dito, la penna o il mouse
                    </span>
                  )}
                </div>
                <div className="profilo__comandi-tela">
                  <button type="button" className="btn btn--piccolo" onClick={() => file.current?.click()}>
                    <Icona nome="immagine" dimensione={15} />
                    Carica una scansione
                  </button>
                  <button type="button" className="btn btn--piccolo" onClick={pulisci} disabled={telaVuota}>
                    Cancella
                  </button>
                  <input
                    ref={file}
                    type="file"
                    accept="image/png,image/jpeg"
                    hidden
                    onChange={(e) => {
                      void caricata(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>

              <div className="profilo__righe">
                <label className="profilo__campo profilo__campo--titolo">
                  <span className="etichetta-mono">Titolo</span>
                  <input list="titoli-professionali" value={titolo} onChange={(e) => setTitolo(e.target.value)} placeholder="Ing." />
                  <datalist id="titoli-professionali">
                    <option value="Ing." />
                    <option value="Arch." />
                    <option value="Geom." />
                    <option value="Dott." />
                    <option value="P.I." />
                  </datalist>
                </label>
                <label className="profilo__campo">
                  <span className="etichetta-mono">Nome per esteso</span>
                  <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
                </label>
              </div>
              <label className="profilo__campo">
                <span className="etichetta-mono">Iscrizione all'albo (facoltativa)</span>
                <input
                  value={albo}
                  onChange={(e) => setAlbo(e.target.value)}
                  placeholder="Ordine degli Ingegneri di Milano n. 1234"
                />
              </label>

              {errore && (
                <p className="profilo__errore" role="alert">
                  {errore}
                </p>
              )}
              <div className="profilo__pulsanti">
                {firma && (
                  <button
                    type="button"
                    className="btn btn--piccolo"
                    onClick={() => {
                      setInModifica(false);
                      setErrore(null);
                    }}
                    disabled={occupato}
                  >
                    Annulla
                  </button>
                )}
                <button type="button" className="btn btn--piccolo btn--primario" onClick={() => void salva()} disabled={occupato || !nome.trim()}>
                  {occupato ? "Salvo…" : "Salva la firma"}
                </button>
              </div>
            </div>
          )}

          <p className="profilo__avviso">
            È una firma grafica: va bene per documenti privati, verbali e comunicazioni. Dove serve la firma digitale
            (per esempio negli appalti pubblici) scarica il PDF e firmalo con il tuo software di firma.
          </p>
        </section>
      </div>
    </main>
  );
}

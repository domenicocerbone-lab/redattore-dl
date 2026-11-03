// Finestra «Riprese NowVision»: stato di cronoprogramma e computo caricati,
// riprese 360° per data e zona da allegare al messaggio, import di nuovi file.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Ripresa, SintesiNowVision } from "../../shared/nowvision";
import { formatEuro, formatNumero } from "../../shared/numeri";
import { api } from "../lib/api";
import { preparaFoto } from "../lib/immagini";
import { comeBase64, dataBreve } from "../lib/nowvision";
import { Icona } from "./Icone";
import { infoCantiere } from "../lib/sessione";
import "./riprese.css";

interface Props {
  cantiereId: string;
  sintesi: SintesiNowVision;
  onAggiornata: (s: SintesiNowVision) => void;
  onUsa: (riprese: Ripresa[]) => void;
  onChiudi: () => void;
}

/** Di partenza: le riprese delle due giornate più recenti della zona più recente. */
function selezioneIniziale(riprese: Ripresa[]): Set<string> {
  const zona = riprese[0]?.zona;
  const giornate = [...new Set(riprese.filter((r) => r.zona === zona).map((r) => r.data))].slice(0, 2);
  return new Set(riprese.filter((r) => r.zona === zona && giornate.includes(r.data)).map((r) => r.id));
}

function oggi() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SceltaRiprese({ cantiereId, sintesi, onAggiornata, onUsa, onChiudi }: Props) {
  const [scelte, setScelte] = useState(() => selezioneIniziale(sintesi.riprese));
  const [zona, setZona] = useState<string>("tutte");
  const [aggiunta, setAggiunta] = useState(false);
  const [nuovaZona, setNuovaZona] = useState(sintesi.riprese[0]?.zona ?? sintesi.zone[0] ?? "");
  const [nuovaData, setNuovaData] = useState(oggi);
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const finestra = useRef<HTMLDivElement>(null);
  const selettoreRiprese = useRef<HTMLInputElement>(null);

  useEffect(() => {
    finestra.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onChiudi();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onChiudi]);

  const zoneRiprese = useMemo(() => [...new Set(sintesi.riprese.map((r) => r.zona))].sort(), [sintesi.riprese]);
  const visibili = sintesi.riprese.filter((r) => zona === "tutte" || r.zona === zona);
  const gruppi = useMemo(() => {
    const mappa = new Map<string, Ripresa[]>();
    for (const r of visibili) {
      const chiave = `${r.data}|${r.zona}`;
      mappa.set(chiave, [...(mappa.get(chiave) ?? []), r]);
    }
    return [...mappa.entries()];
  }, [visibili]);
  const selezionate = sintesi.riprese.filter((r) => scelte.has(r.id));

  function cambia(id: string) {
    setScelte((s) => {
      const nuovo = new Set(s);
      if (nuovo.has(id)) nuovo.delete(id);
      else nuovo.add(id);
      return nuovo;
    });
  }

  async function caricaFile(tipo: "computo" | "cronoprogramma", file: File | undefined) {
    if (!file) return;
    setInCorso(tipo);
    setErrore(null);
    try {
      onAggiornata(await api.caricaFileNowVision(cantiereId, tipo, file.name, await comeBase64(file)));
    } catch (e) {
      setErrore(`${file.name}: ${(e as Error).message}`);
    } finally {
      setInCorso(null);
    }
  }

  async function caricaRiprese(files: FileList | null) {
    if (!files?.length) return;
    if (!nuovaZona.trim()) {
      setErrore("Indica la zona delle riprese prima di caricarle.");
      return;
    }
    setInCorso("riprese");
    setErrore(null);
    const nuove: string[] = [];
    try {
      for (const file of [...files].filter((f) => f.type.startsWith("image/"))) {
        const r = await api.caricaRipresa(cantiereId, {
          dataUrl: await preparaFoto(file),
          nome: file.name,
          zona: nuovaZona,
          data: nuovaData,
        });
        nuove.push(r.id);
      }
      onAggiornata(await api.nowvision(cantiereId));
      setScelte(new Set(nuove));
      setAggiunta(false);
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setInCorso(null);
    }
  }

  const c = sintesi.computo;
  const p = sintesi.programma;

  return (
    <div className="velo" onMouseDown={(e) => e.target === e.currentTarget && onChiudi()}>
      <div
        ref={finestra}
        className="riprese"
        role="dialog"
        aria-modal="true"
        aria-labelledby="riprese-titolo"
        tabIndex={-1}
      >
        <header className="riprese__testa">
          <div className="riprese__titolo">
            <span className="pillola">NowVision</span>
            <h2 id="riprese-titolo">Riprese 360° · {infoCantiere(cantiereId).nome}</h2>
          </div>
          <button type="button" className="btn-icona" aria-label="Chiudi" onClick={onChiudi}>
            <Icona nome="chiudi" dimensione={18} />
          </button>
        </header>

        <div className="riprese__corpo">
          <section className="riprese__dati" aria-label="Dati del cantiere">
            <div className="riprese__file">
              <Icona nome="calendario" colore="var(--nv-mint-dark)" />
              <div className="riprese__file-testo">
                <span className="riprese__file-nome">Cronoprogramma</span>
                <span className="etichetta-mono riprese__file-dettaglio">
                  {p ? `${p.nome} · ${p.attivita} attività` : "Non caricato"}
                </span>
              </div>
              <label className="btn btn--piccolo riprese__carica">
                {inCorso === "cronoprogramma" ? "Carico…" : p ? "Sostituisci" : "Carica xlsx"}
                <input
                  type="file"
                  accept=".xlsx"
                  hidden
                  disabled={inCorso !== null}
                  onChange={(e) => {
                    void caricaFile("cronoprogramma", e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <div className="riprese__file">
              <Icona nome="barre" colore="var(--nv-mint-dark)" />
              <div className="riprese__file-testo">
                <span className="riprese__file-nome">Computo metrico</span>
                <span className="etichetta-mono riprese__file-dettaglio">
                  {c
                    ? `${c.nome} · ${c.voci} voci · ${formatEuro(c.totale)}` +
                      (c.rilevato > 0 ? ` · rilevato IA ${formatNumero((c.rilevato / c.totale) * 100, 1)}%` : "")
                    : "Non caricato"}
                </span>
              </div>
              <label className="btn btn--piccolo riprese__carica">
                {inCorso === "computo" ? "Carico…" : c ? "Sostituisci" : "Carica xlsx"}
                <input
                  type="file"
                  accept=".xlsx"
                  hidden
                  disabled={inCorso !== null}
                  onChange={(e) => {
                    void caricaFile("computo", e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </section>

          <section className="riprese__elenco" aria-label="Riprese">
            <div className="riprese__barra">
              <label className="riprese__campo">
                <span className="etichetta-mono">Zona</span>
                <select value={zona} onChange={(e) => setZona(e.target.value)}>
                  <option value="tutte">Tutte le zone</option>
                  {zoneRiprese.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn--piccolo"
                aria-expanded={aggiunta}
                onClick={() => setAggiunta((a) => !a)}
              >
                <Icona nome="piu" dimensione={15} />
                Aggiungi riprese
              </button>
            </div>

            {aggiunta && (
              <div className="riprese__aggiunta">
                <label className="riprese__campo">
                  <span className="etichetta-mono">Zona</span>
                  <input list="riprese-zone" value={nuovaZona} onChange={(e) => setNuovaZona(e.target.value)} />
                  <datalist id="riprese-zone">
                    {sintesi.zone.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                </label>
                <label className="riprese__campo">
                  <span className="etichetta-mono">Data della ripresa</span>
                  <input type="date" value={nuovaData} onChange={(e) => setNuovaData(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="btn btn--piccolo btn--primario"
                  disabled={inCorso !== null}
                  onClick={() => selettoreRiprese.current?.click()}
                >
                  {inCorso === "riprese" ? "Carico…" : "Scegli immagini"}
                </button>
                <input
                  ref={selettoreRiprese}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    void caricaRiprese(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
            )}

            {errore && (
              <p className="riprese__errore" role="alert">
                {errore}
              </p>
            )}

            {gruppi.length === 0 && <p className="riprese__vuoto">Nessuna ripresa per questo cantiere. Aggiungi le immagini esportate da NowVision.</p>}
            {gruppi.map(([chiave, elenco]) => {
              const [giorno, zonaGruppo] = chiave.split("|");
              return (
                <div key={chiave} className="riprese__giornata">
                  <div className="riprese__giornata-testa">
                    <span className="riprese__giornata-data">{dataBreve(giorno)}</span>
                    <span className="etichetta-mono">
                      {zonaGruppo} · {elenco.length} {elenco.length === 1 ? "ripresa" : "riprese"}
                    </span>
                  </div>
                  <div className="riprese__griglia">
                    {elenco.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={`riprese__miniatura${scelte.has(r.id) ? " riprese__miniatura--scelta" : ""}`}
                        aria-pressed={scelte.has(r.id)}
                        aria-label={`Ripresa ${zonaGruppo} del ${dataBreve(giorno)}`}
                        onClick={() => cambia(r.id)}
                      >
                        <img src={r.url} alt="" loading="lazy" />
                        <span className="riprese__spunta" aria-hidden="true">
                          {scelte.has(r.id) && <Icona nome="spunta" dimensione={14} tratto={2.4} />}
                        </span>
                        <span className="riprese__etichetta">360°</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        </div>

        <footer className="riprese__piede">
          <span className="riprese__nota">
            Il Redattore confronta le riprese con cronoprogramma e computo alla data della più recente.
          </span>
          <div className="riprese__azioni">
            <button type="button" className="btn btn--piccolo" onClick={onChiudi}>
              Annulla
            </button>
            <button
              type="button"
              className="btn btn--piccolo btn--primario"
              disabled={selezionate.length === 0}
              onClick={() => onUsa(selezionate)}
            >
              Usa {selezionate.length} {selezionate.length === 1 ? "ripresa" : "riprese"} →
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// Campo di scrittura: testo, foto, dettatura e (in home) scelta del documento.
// «grande» è quello della home, «compatto» quello in fondo alla chat.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { MODALITA_FOTO, TIPI_DOCUMENTO, nomeModalita, tipoDocumento } from "../../shared/documenti";
import type { Ripresa } from "../../shared/nowvision";
import type { FotoAllegata } from "../../shared/schema";
import { api } from "../lib/api";
import { durata, useDettatura } from "../lib/dettatura";
import { preparaFoto } from "../lib/immagini";
import type { Invio } from "../lib/stato";
import { Icona } from "./Icone";
import { Menu, VoceMenu } from "./Menu";
import "./composer.css";

interface FotoInCaricamento {
  chiave: string;
  anteprima: string;
  nome: string;
  stato: "carica" | "pronta" | "errore";
  caricata?: FotoAllegata;
}

export interface ComposerHandle {
  scrivi: (testo: string) => void;
  apriFoto: () => void;
  focus: () => void;
  /** Allega riprese 360° NowVision (sostituisce quelle già scelte). */
  allegaRiprese: (riprese: Ripresa[]) => void;
}

interface Props {
  variante: "grande" | "compatto";
  modalita: string;
  onModalita?: (m: string) => void;
  segnaposto?: string;
  inCorso: boolean;
  disabilitato?: boolean;
  onInvia: (invio: Omit<Invio, "modalita"> & { modalita?: string }) => void;
  onInterrompi?: () => void;
  /** Se il cantiere ha dati NowVision, apre la scelta delle riprese. */
  onApriRiprese?: () => void;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { variante, modalita, onModalita, segnaposto, inCorso, disabilitato, onInvia, onInterrompi, onApriRiprese },
  ref,
) {
  const [testo, setTesto] = useState("");
  const [provvisorio, setProvvisorio] = useState("");
  const [foto, setFoto] = useState<FotoInCaricamento[]>([]);
  const [riprese, setRiprese] = useState<Ripresa[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [secondiDettati, setSecondiDettati] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const selettore = useRef<HTMLInputElement>(null);

  const dettatura = useDettatura((definitivo, prov) => {
    if (definitivo) setTesto((t) => (t && !t.endsWith(" ") ? `${t} ` : t) + definitivo.trim());
    setProvvisorio(prov);
  });

  useEffect(() => {
    if (dettatura.attiva) setSecondiDettati(dettatura.secondi);
  }, [dettatura.attiva, dettatura.secondi]);

  useImperativeHandle(ref, () => ({
    scrivi: (t) => {
      setTesto(t);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(t.length, t.length);
      });
    },
    apriFoto: () => selettore.current?.click(),
    focus: () => area.current?.focus(),
    allegaRiprese: (r) => setRiprese([...r].sort((a, b) => a.data.localeCompare(b.data))),
  }));

  // L'area di testo cresce con il contenuto.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [testo, provvisorio]);

  async function aggiungiFoto(files: FileList | null) {
    if (!files?.length) return;
    setErrore(null);
    const nuove = [...files].filter((f) => f.type.startsWith("image/"));
    for (const file of nuove) {
      const chiave = crypto.randomUUID();
      const anteprima = URL.createObjectURL(file);
      setFoto((f) => [...f, { chiave, anteprima, nome: file.name, stato: "carica" }]);
      try {
        const dataUrl = await preparaFoto(file);
        const r = await api.caricaFoto({ dataUrl, nome: file.name, scattataIl: file.lastModified });
        setFoto((f) =>
          f.map((x) =>
            x.chiave === chiave
              ? { ...x, stato: "pronta", caricata: { id: r.id, etichetta: "", ora: r.ora, nome: r.nome, url: anteprima } }
              : x,
          ),
        );
      } catch (e) {
        setErrore((e as Error).message);
        setFoto((f) => f.map((x) => (x.chiave === chiave ? { ...x, stato: "errore" } : x)));
      }
    }
  }

  const fotoPronte = foto.filter((f) => f.stato === "pronta");
  const caricamento = foto.some((f) => f.stato === "carica");
  const contenuto = (testo + provvisorio).trim();
  const puoInviare =
    !inCorso && !disabilitato && !caricamento && (contenuto.length > 0 || fotoPronte.length > 0 || riprese.length > 0);

  function invia() {
    if (!puoInviare) return;
    if (dettatura.attiva) dettatura.ferma();
    const anteprimeFoto = fotoPronte.map((f, i) => ({ ...f.caricata!, etichetta: `F${i + 1}` }));
    const anteprimeRiprese: FotoAllegata[] = riprese.map((r, i) => ({
      id: r.id,
      etichetta: `F${anteprimeFoto.length + i + 1}`,
      ora: "",
      nome: `Ripresa 360° · ${r.zona}`,
      url: r.url,
      ripresa: { zona: r.zona, data: r.data },
    }));
    onInvia({
      testo: contenuto,
      foto: anteprimeFoto.map((f) => f.id),
      ...(riprese.length ? { riprese: riprese.map((r) => r.id) } : {}),
      anteprime: [...anteprimeFoto, ...anteprimeRiprese],
      ...(secondiDettati > 0 ? { dettato: { secondi: secondiDettati } } : {}),
    });
    setTesto("");
    setProvvisorio("");
    setFoto([]);
    setRiprese([]);
    setSecondiDettati(0);
  }

  const microfono = (
    <button
      type="button"
      className={`btn-icona${dettatura.attiva ? " btn-icona--registra" : ""}`}
      aria-label={dettatura.attiva ? "Ferma la dettatura" : "Detta a voce"}
      aria-pressed={dettatura.attiva}
      title={dettatura.supportata ? undefined : "La dettatura non è supportata da questo browser"}
      disabled={!dettatura.supportata || disabilitato}
      onClick={() => (dettatura.attiva ? dettatura.ferma() : dettatura.avvia())}
    >
      <Icona nome="microfono" />
    </button>
  );

  // In home il pulsante resta in accento anche a campo vuoto, come nel design.
  const accento = puoInviare || (variante === "grande" && !disabilitato);
  const pulsanteInvio = inCorso ? (
    <button type="button" className="btn-icona btn-icona--accento" aria-label="Interrompi la risposta" onClick={onInterrompi}>
      <Icona nome="stop" tratto={2} />
    </button>
  ) : (
    <button
      type="submit"
      className={`btn-icona ${accento ? "btn-icona--accento" : "btn-icona--spento"}`}
      aria-label="Invia"
      disabled={!puoInviare}
    >
      <Icona nome="invia" tratto={2} />
    </button>
  );

  const selettoreFoto = (
    <input
      ref={selettore}
      type="file"
      accept="image/*"
      multiple
      hidden
      onChange={(e) => {
        void aggiungiFoto(e.target.files);
        e.target.value = "";
      }}
    />
  );

  const anteprime = (foto.length > 0 || riprese.length > 0) && (
    <div className="composer__foto">
      {riprese.map((r) => (
        <div key={r.id} className="composer__miniatura composer__miniatura--ripresa">
          <img src={r.url} alt={`Ripresa 360° ${r.zona}`} />
          <span className="composer__miniatura-stato">
            360° · {r.data.slice(8, 10)}/{r.data.slice(5, 7)}
          </span>
          <button
            type="button"
            className="composer__rimuovi"
            aria-label={`Rimuovi la ripresa ${r.zona} del ${r.data}`}
            onClick={() => setRiprese((x) => x.filter((y) => y.id !== r.id))}
          >
            <Icona nome="chiudi" dimensione={12} tratto={2} />
          </button>
        </div>
      ))}
      {foto.map((f) => (
        <div key={f.chiave} className={`composer__miniatura composer__miniatura--${f.stato}`}>
          <img src={f.anteprima} alt={f.nome} />
          {f.stato === "carica" && <span className="composer__miniatura-stato">Carico…</span>}
          {f.stato === "errore" && <span className="composer__miniatura-stato">Errore</span>}
          <button
            type="button"
            className="composer__rimuovi"
            aria-label={`Rimuovi ${f.nome}`}
            onClick={() => setFoto((x) => x.filter((y) => y.chiave !== f.chiave))}
          >
            <Icona nome="chiudi" dimensione={12} tratto={2} />
          </button>
        </div>
      ))}
    </div>
  );

  const stato = (dettatura.attiva || dettatura.errore || errore) && (
    <div className="composer__stato" role="status">
      {dettatura.attiva && (
        <span className="composer__registrazione">
          <span className="composer__punto" aria-hidden="true" /> Sto ascoltando · {durata(dettatura.secondi)}
        </span>
      )}
      {(dettatura.errore || errore) && <span className="testo-attenzione">{dettatura.errore ?? errore}</span>}
    </div>
  );

  const valore = provvisorio ? `${testo}${testo && !testo.endsWith(" ") ? " " : ""}${provvisorio}` : testo;
  const campoTesto = (
    <textarea
      ref={area}
      aria-label="Messaggio"
      rows={variante === "grande" ? 2 : 1}
      className="composer__testo"
      placeholder={segnaposto}
      value={valore}
      disabled={disabilitato}
      onChange={(e) => {
        setTesto(e.target.value);
        setProvvisorio("");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          invia();
        }
      }}
    />
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    invia();
  };

  if (variante === "grande") {
    const tipo = tipoDocumento(modalita);
    return (
      <form className="composer composer--grande" onSubmit={submit}>
        {selettoreFoto}
        {anteprime}
        {campoTesto}
        {stato}
        <div className="composer__barra">
          <div className="composer__gruppo">
            <button
              type="button"
              className="btn-icona btn-icona--bordo"
              aria-label="Allega foto"
              onClick={() => selettore.current?.click()}
            >
              <Icona nome="piu" />
            </button>
            <Menu
              className="composer__tipo"
              contenuto={
                <>
                  <Icona
                    nome={modalita === MODALITA_FOTO.id ? "foto" : tipo?.attenzione ? "attenzione" : "documento"}
                    dimensione={15}
                    tratto={1.6}
                    colore={tipo?.attenzione ? "var(--nv-orange)" : "var(--nv-mint-dark)"}
                  />
                  <span className="composer__tipo-nome">{nomeModalita(modalita)}</span>
                  <Icona nome="giu" dimensione={14} />
                </>
              }
              sopra={false}
            >
              {(chiudi) => (
                <>
                  {TIPI_DOCUMENTO.map((t) => (
                    <VoceMenu
                      key={t.id}
                      attiva={t.id === modalita}
                      onClick={() => {
                        onModalita?.(t.id);
                        chiudi();
                        area.current?.focus();
                      }}
                    >
                      <Icona nome={t.icona} dimensione={16} colore={t.attenzione ? "var(--nv-orange)" : "var(--nv-mint-dark)"} />
                      {t.nome}
                    </VoceMenu>
                  ))}
                  <VoceMenu
                    attiva={modalita === MODALITA_FOTO.id}
                    onClick={() => {
                      onModalita?.(MODALITA_FOTO.id);
                      chiudi();
                      selettore.current?.click();
                    }}
                  >
                    <Icona nome="foto" dimensione={16} colore="var(--nv-mint-dark)" />
                    {MODALITA_FOTO.nome}
                  </VoceMenu>
                </>
              )}
            </Menu>
            <button
              type="button"
              className={`composer__foto-bozze${modalita === MODALITA_FOTO.id ? " composer__foto-bozze--attivo" : ""}`}
              onClick={() => {
                onModalita?.(MODALITA_FOTO.id);
                if (onApriRiprese) onApriRiprese();
                else selettore.current?.click();
              }}
            >
              <Icona nome={onApriRiprese ? "giro360" : "fotocamera"} dimensione={16} tratto={1.6} />
              {onApriRiprese ? "Dalle riprese 360°" : "Bozze dalle foto"}
            </button>
          </div>
          <div className="composer__gruppo">
            {microfono}
            {pulsanteInvio}
          </div>
        </div>
      </form>
    );
  }

  const vuoto = !contenuto && fotoPronte.length === 0 && riprese.length === 0 && !inCorso;
  return (
    <form className={`composer composer--compatto${vuoto ? " composer--vuoto" : ""}`} onSubmit={submit}>
      {selettoreFoto}
      {anteprime}
      {stato}
      <div className="composer__riga">
        <button
          type="button"
          className="btn-icona btn-icona--bordo composer__allega"
          aria-label="Allega foto"
          onClick={() => selettore.current?.click()}
        >
          <Icona nome="piu" className="solo-desktop" />
          <Icona nome="fotocamera" dimensione={20} className="solo-mobile" />
        </button>
        {onApriRiprese && (
          <button
            type="button"
            className="btn-icona btn-icona--bordo"
            aria-label="Allega riprese 360° NowVision"
            title="Riprese 360° NowVision"
            onClick={onApriRiprese}
          >
            <Icona nome="giro360" />
          </button>
        )}
        {campoTesto}
        <span className="composer__microfono">{microfono}</span>
        <span className="composer__invio">{pulsanteInvio}</span>
      </div>
    </form>
  );
});

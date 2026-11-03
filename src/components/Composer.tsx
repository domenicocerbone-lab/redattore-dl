// Campo di scrittura: testo, foto, dettatura e (in home) scelta del documento.
// «grande» è quello della home, «compatto» quello in fondo alla chat.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { NOMI_DOCUMENTO_PROGETTO, TIPI_DOCUMENTO_PROGETTO, type TipoDocumentoProgetto } from "../../shared/cantieri";
import { MODALITA_FOTO, TIPI_DOCUMENTO, nomeModalita, tipoDocumento } from "../../shared/documenti";
import type { Ripresa } from "../../shared/nowvision";
import type { FotoAllegata } from "../../shared/schema";
import { api, caricaDocumentoProgetto } from "../lib/api";
import { impostaCantiere } from "../lib/cantieri";
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

interface DocumentoInCaricamento {
  chiave: string;
  file: File;
  tipo: TipoDocumentoProgetto;
  stato: "pronto" | "carica" | "errore";
  avanzamento: number;
}

/** Tipo di documento di progetto dal nome del file: si può cambiare prima dell'invio. */
function tipoDalNome(file: File): TipoDocumentoProgetto {
  const n = file.name.toLowerCase();
  if (/crono|programma|gantt/.test(n)) return "cronoprogramma";
  if (/computo|cme|boq|stima/.test(n)) return "computo";
  if (/pianta|piante|planimetr|tavol|layout/.test(n) || file.type.startsWith("image/")) return "planimetria";
  if (/psc|sicurezza|notifica/.test(n)) return "psc";
  if (/contratt|capitolato|appalto/.test(n)) return "contratto";
  if (/\.(xlsx|csv)$/.test(n)) return "computo";
  return "altro";
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
  /** Revisione della scheda: la graffetta allega documenti di progetto di questo cantiere invece delle foto. */
  cantiereDocumenti?: string;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { variante, modalita, onModalita, segnaposto, inCorso, disabilitato, onInvia, onInterrompi, onApriRiprese, cantiereDocumenti },
  ref,
) {
  const [testo, setTesto] = useState("");
  const [provvisorio, setProvvisorio] = useState("");
  const [foto, setFoto] = useState<FotoInCaricamento[]>([]);
  const [riprese, setRiprese] = useState<Ripresa[]>([]);
  const [documenti, setDocumenti] = useState<DocumentoInCaricamento[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [secondiDettati, setSecondiDettati] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const selettore = useRef<HTMLInputElement>(null);
  const selettoreDocumenti = useRef<HTMLInputElement>(null);

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
  const caricamento = foto.some((f) => f.stato === "carica") || documenti.some((d) => d.stato === "carica");
  const contenuto = (testo + provvisorio).trim();
  const puoInviare =
    !inCorso &&
    !disabilitato &&
    !caricamento &&
    (contenuto.length > 0 || fotoPronte.length > 0 || riprese.length > 0 || documenti.length > 0);

  function aggiungiDocumenti(files: FileList | null) {
    if (!files?.length) return;
    setErrore(null);
    const nuovi = [...files].map((file) => ({ chiave: crypto.randomUUID(), file, tipo: tipoDalNome(file), stato: "pronto" as const, avanzamento: 0 }));
    setDocumenti((d) => [...d, ...nuovi].slice(0, 6));
  }

  /** I documenti si caricano all'invio, con il tipo scelto: il messaggio parte quando sono sul server. */
  async function caricaDocumenti(): Promise<{ id: string; nome: string; tipo: string }[] | null> {
    if (!cantiereDocumenti || documenti.length === 0) return [];
    const caricati: { id: string; nome: string; tipo: string }[] = [];
    for (const d of documenti) {
      const aggiorna = (x: Partial<DocumentoInCaricamento>) => setDocumenti((ds) => ds.map((y) => (y.chiave === d.chiave ? { ...y, ...x } : y)));
      aggiorna({ stato: "carica", avanzamento: 0 });
      try {
        const s = await caricaDocumentoProgetto(cantiereDocumenti, d.tipo, d.file, d.file.name, (f) => aggiorna({ avanzamento: f }));
        impostaCantiere(s);
        // L'ultimo documento di quel tipo caricato è questo: i caricamenti vanno uno alla volta.
        const nuovo = s.documenti.filter((x) => x.tipo === d.tipo).sort((a, b) => b.caricatoIl.localeCompare(a.caricatoIl))[0];
        if (nuovo) caricati.push({ id: nuovo.id, nome: nuovo.nome, tipo: NOMI_DOCUMENTO_PROGETTO[nuovo.tipo] });
        setDocumenti((ds) => ds.filter((y) => y.chiave !== d.chiave));
      } catch (e) {
        aggiorna({ stato: "errore" });
        setErrore(`${d.file.name}: ${(e as Error).message}`);
        return null;
      }
    }
    return caricati;
  }

  async function invia() {
    if (!puoInviare) return;
    if (dettatura.attiva) dettatura.ferma();
    const allegati = await caricaDocumenti();
    if (allegati === null) return;
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
      ...(allegati.length ? { documenti: allegati.map((a) => a.id), allegati } : {}),
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
          void invia();
        }
      }}
    />
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void invia();
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

  const elencoDocumenti = documenti.length > 0 && (
    <ul className="composer__documenti" aria-label="Documenti da allegare">
      {documenti.map((d) => (
        <li key={d.chiave} className={`composer__documento composer__documento--${d.stato}`}>
          <Icona nome="documento" dimensione={16} />
          <span className="composer__documento-nome" title={d.file.name}>
            {d.file.name}
          </span>
          {d.stato === "carica" ? (
            <span className="etichetta-mono">Carico {Math.round(d.avanzamento * 100)}%</span>
          ) : (
            <select
              aria-label={`Tipo di ${d.file.name}`}
              className="composer__documento-tipo"
              value={d.tipo}
              onChange={(e) =>
                setDocumenti((ds) => ds.map((y) => (y.chiave === d.chiave ? { ...y, tipo: e.target.value as TipoDocumentoProgetto, stato: "pronto" } : y)))
              }
            >
              {TIPI_DOCUMENTO_PROGETTO.map((t) => (
                <option key={t} value={t}>
                  {NOMI_DOCUMENTO_PROGETTO[t]}
                </option>
              ))}
            </select>
          )}
          {d.stato !== "carica" && (
            <button
              type="button"
              className="composer__rimuovi composer__rimuovi--riga"
              aria-label={`Togli ${d.file.name}`}
              onClick={() => setDocumenti((ds) => ds.filter((y) => y.chiave !== d.chiave))}
            >
              <Icona nome="chiudi" dimensione={12} tratto={2} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );

  const vuoto = !contenuto && fotoPronte.length === 0 && riprese.length === 0 && documenti.length === 0 && !inCorso;
  return (
    <form className={`composer composer--compatto${vuoto ? " composer--vuoto" : ""}`} onSubmit={submit}>
      {selettoreFoto}
      {cantiereDocumenti && (
        <input
          ref={selettoreDocumenti}
          type="file"
          accept=".pdf,.xlsx,.csv,image/*"
          multiple
          hidden
          onChange={(e) => {
            aggiungiDocumenti(e.target.files);
            e.target.value = "";
          }}
        />
      )}
      {anteprime}
      {elencoDocumenti}
      {stato}
      <div className="composer__riga">
        {cantiereDocumenti ? (
          <button
            type="button"
            className="btn-icona btn-icona--bordo composer__allega"
            aria-label="Allega un documento di progetto"
            title="Allega un documento di progetto"
            onClick={() => selettoreDocumenti.current?.click()}
          >
            <Icona nome="graffetta" />
          </button>
        ) : (
          <button
            type="button"
            className="btn-icona btn-icona--bordo composer__allega"
            aria-label="Allega foto"
            onClick={() => selettore.current?.click()}
          >
            <Icona nome="piu" className="solo-desktop" />
            <Icona nome="fotocamera" dimensione={20} className="solo-mobile" />
          </button>
        )}
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

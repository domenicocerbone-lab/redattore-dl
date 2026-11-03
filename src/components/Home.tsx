// Home: «Cosa verbalizziamo oggi?», scelta del documento e primo messaggio.

import { useEffect, useRef, useState } from "react";
import { MODALITA_FOTO, TIPI_DOCUMENTO, tipoDocumento } from "../../shared/documenti";
import { linkDocumento, type VoceArchivio } from "../../shared/versioni";
import { api } from "../lib/api";
import { quando } from "../lib/date";
import { useNowVision } from "../lib/nowvision";
import { creaConversazione, inviaMessaggio, useElenco, type Invio } from "../lib/stato";
import { Composer, type ComposerHandle } from "./Composer";
import { Icona } from "./Icone";
import { Menu } from "./Menu";
import { SceltaCantiere } from "./SceltaCantiere";
import { SceltaRiprese } from "./SceltaRiprese";

interface Props {
  cantiereId: string;
  onCantiere: (id: string) => void;
  onApriMenu: () => void;
  onAperta: (id: string) => void;
}

export function Home({ cantiereId, onCantiere, onApriMenu, onAperta }: Props) {
  const [modalita, setModalita] = useState("giornale_lavori");
  const [altriAperti, setAltriAperti] = useState(false);
  const [creazione, setCreazione] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [ripreseAperte, setRipreseAperte] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const elenco = useElenco();
  const nowvision = useNowVision(cantiereId);
  const [bozze, setBozze] = useState<VoceArchivio[]>([]);

  // Le ultime bozze del cantiere, per riprenderle da dove si erano lasciate.
  useEffect(() => {
    let attuale = true;
    api.documenti({ stato: "bozze", cantiere: cantiereId }).then(
      (v) => attuale && setBozze(v.slice(0, 3)),
      () => undefined,
    );
    return () => {
      attuale = false;
    };
  }, [cantiereId, elenco]);

  const ultimoGiornale = elenco?.find((c) => c.modalita === "giornale_lavori" && c.cantiereId === cantiereId);
  const segnaposto =
    modalita === MODALITA_FOTO.id
      ? "Aggiungi le foto di oggi e, se vuoi, un po' di contesto…"
      : (tipoDocumento(modalita)?.segnaposto ?? "");

  async function invia(invio: Omit<Invio, "modalita">) {
    setCreazione(true);
    setErrore(null);
    try {
      const id = await creaConversazione(modalita, cantiereId);
      onAperta(id);
      void inviaMessaggio(id, { ...invio, modalita });
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setCreazione(false);
    }
  }

  function scegli(id: string) {
    setModalita(id);
    composer.current?.focus();
  }

  const chip = (t: (typeof TIPI_DOCUMENTO)[number]) => (
    <button
      key={t.id}
      type="button"
      className={`chip${modalita === t.id ? " chip--scelto" : ""}`}
      aria-pressed={modalita === t.id}
      onClick={() => scegli(t.id)}
    >
      <Icona nome={t.icona} dimensione={16} tratto={1.6} colore={t.attenzione ? "var(--nv-orange)" : "var(--nv-mint-dark)"} />
      {t.chip ?? t.nome}
    </button>
  );

  return (
    <main className="vista vista--home">
      <header className="testata">
        <div className="testata__sinistra">
          <button type="button" className="btn-icona testata__menu" aria-label="Apri menu" onClick={onApriMenu}>
            <Icona nome="menu" dimensione={22} />
          </button>
          <Menu
            className="testata__prodotto"
            larghezza={320}
            contenuto={
              <>
                Redattore DL
                <Icona nome="giu" dimensione={16} colore="var(--nv-ink-soft)" />
              </>
            }
          >
            {() => (
              <div className="menu__testo">
                <strong>Redattore DL</strong>
                <span>
                  Prepara le bozze di giornale dei lavori, libretto delle misure, SAL, verbali, ordini di servizio e
                  rapporti di non conformità partendo da ciò che racconti, detti o fotografi.
                </span>
                <span>Verifica e firma restano del Direttore dei Lavori.</span>
              </div>
            )}
          </Menu>
        </div>
        <SceltaCantiere cantiereId={cantiereId} onCambia={onCantiere} />
      </header>

      <div className="home">
        <div className="home__intro">
          <span className="pillola-vetro">Racconta. Verifica. Firma.</span>
          <h1>Cosa verbalizziamo oggi?</h1>
          <p>
            {ultimoGiornale
              ? `Ultimo giornale dei lavori: ${quando(ultimoGiornale.aggiornataIl)}`
              : "Nessun giornale dei lavori ancora per questo cantiere"}
          </p>
        </div>

        <Composer
          ref={composer}
          variante="grande"
          modalita={modalita}
          onModalita={setModalita}
          segnaposto={segnaposto}
          inCorso={false}
          disabilitato={creazione}
          onInvia={(i) => void invia(i)}
          onApriRiprese={nowvision.disponibile ? () => setRipreseAperte(true) : undefined}
        />
        {errore && (
          <p className="testo-attenzione" role="alert">
            {errore}
          </p>
        )}

        <div className="chips">
          {nowvision.disponibile && (
            <button
              type="button"
              className={`chip chip--menta${modalita === MODALITA_FOTO.id ? " chip--scelto" : ""}`}
              onClick={() => setRipreseAperte(true)}
            >
              <Icona nome="giro360" dimensione={16} tratto={1.6} colore="var(--nv-ink)" />
              Proponi dalle riprese NowVision
            </button>
          )}
          <button
            type="button"
            className={`chip${nowvision.disponibile ? "" : " chip--menta"}${modalita === MODALITA_FOTO.id && !nowvision.disponibile ? " chip--scelto" : ""}`}
            onClick={() => {
              setModalita(MODALITA_FOTO.id);
              composer.current?.apriFoto();
            }}
          >
            <Icona
              nome="immagine"
              dimensione={16}
              tratto={1.6}
              colore={nowvision.disponibile ? "var(--nv-mint-dark)" : "var(--nv-ink)"}
            />
            Proponi dalle foto
          </button>
          {TIPI_DOCUMENTO.filter((t) => !t.altro).map(chip)}
          {altriAperti && TIPI_DOCUMENTO.filter((t) => t.altro).map(chip)}
          <button
            type="button"
            className="chip chip--trasparente"
            aria-expanded={altriAperti}
            onClick={() => setAltriAperti((a) => !a)}
          >
            {altriAperti ? "Meno ↑" : "Altro ↓"}
          </button>
        </div>

        {bozze.length > 0 && (
          <section className="home__bozze" aria-labelledby="titolo-bozze">
            <div className="home__bozze-testa">
              <span id="titolo-bozze" className="etichetta-mono">
                Bozze da chiudere
              </span>
              <a href="#/documenti" className="home__bozze-tutte">
                Tutti i documenti →
              </a>
            </div>
            <ul>
              {bozze.map((v) => {
                const t = tipoDocumento(v.tipo);
                return (
                  <li key={`${v.conversazione}/${v.id}`}>
                    <a href={linkDocumento(v)}>
                      <Icona nome={t?.icona ?? "documento"} dimensione={16} colore={t?.attenzione ? "var(--nv-orange)" : "var(--nv-mint-dark)"} />
                      <span className="home__bozze-nome">{v.titolo}</span>
                      <span className="home__bozze-quando">{quando(v.aggiornatoIl)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <p className="avvertenza">Il Redattore DL prepara bozze · verifica e firma restano del Direttore dei Lavori</p>

      {ripreseAperte && nowvision.sintesi && (
        <SceltaRiprese
          cantiereId={cantiereId}
          sintesi={nowvision.sintesi}
          onAggiornata={nowvision.setSintesi}
          onChiudi={() => setRipreseAperte(false)}
          onUsa={(riprese) => {
            setRipreseAperte(false);
            setModalita(MODALITA_FOTO.id);
            composer.current?.allegaRiprese(riprese);
            composer.current?.scrivi("Confronta le riprese con cronoprogramma e computo e proponimi cosa scrivere.");
          }}
        />
      )}
    </main>
  );
}

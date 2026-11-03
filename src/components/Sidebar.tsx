// Barra laterale: nuovo report, ricerca, documenti, cantieri e cronologia.
// Completa (260 px), compatta (64 px) quando il documento è aperto, cassetto su telefono.

import { useEffect, useRef, useState } from "react";
import type { ConversazioneMeta } from "../../shared/schema";
import { api } from "../lib/api";
import { cantieriConsentiti, sessione } from "../lib/sessione";
import { raggruppaPerData } from "../lib/date";
import { useElenco } from "../lib/stato";
import { Icona, Logo, Marchio } from "./Icone";
import { Menu, VoceMenu } from "./Menu";
import "./sidebar.css";

interface Props {
  compatta: boolean;
  apertaSuMobile: boolean;
  idAttivo: string | null;
  /** Pagina aperta, per evidenziare la voce giusta. */
  sezione: "home" | "conversazione" | "documenti" | "profilo";
  cantiereId: string;
  onCompatta: (compatta: boolean) => void;
  onChiudiMobile: () => void;
  onNuovo: () => void;
  onApri: (id: string) => void;
  onCantiere: (id: string) => void;
}

function Avatar() {
  return (
    <span aria-hidden="true" className="avatar">
      {sessione()?.iniziali}
    </span>
  );
}

/** Nome in fondo alla barra: apre l'utilizzo (amministratore) e l'uscita. */
function MenuUtente({ compatto }: { compatto: boolean }) {
  const s = sessione();
  if (!s) return null;
  const voci: { testo: string; azione: () => void }[] = [];
  voci.push({ testo: "Profilo e firma", azione: () => (window.location.hash = "#/profilo") });
  if (s.persona.admin) voci.push({ testo: "Utilizzo e accessi", azione: () => (window.location.hash = "#/admin") });
  if (!s.accessoLibero) voci.push({ testo: "Esci", azione: () => void api.esci().then(() => window.location.replace("/")) });
  const limite =
    s.limiteGiornaliero !== null ? `${s.messaggiOggi} di ${s.limiteGiornaliero} messaggi oggi` : null;
  const contenuto = compatto ? (
    <Avatar />
  ) : (
    <>
      <Avatar />
      <span className="barra__utente-testo">
        <span className="barra__utente-nome">{s.persona.nome}</span>
        <span className="etichetta-mono" style={{ letterSpacing: "0.06em" }}>
          {s.persona.ruolo}
        </span>
      </span>
    </>
  );
  if (voci.length === 0 && !limite) return <div className="barra__utente">{contenuto}</div>;
  return (
    <Menu
      className={compatto ? "barra__avatar" : "barra__utente barra__utente--menu"}
      ariaLabel={compatto ? s.persona.nome : undefined}
      sopra
      larghezza={240}
      contenuto={contenuto}
    >
      {(chiudi) => (
        <>
          {limite && <div className="menu__testo"><span className="etichetta-mono">{limite}</span></div>}
          {voci.map((v) => (
            <VoceMenu
              key={v.testo}
              onClick={() => {
                chiudi();
                v.azione();
              }}
            >
              {v.testo}
            </VoceMenu>
          ))}
        </>
      )}
    </Menu>
  );
}

export function Sidebar(p: Props) {
  const elenco = useElenco();
  const [cercaAperta, setCercaAperta] = useState(false);
  const [cerca, setCerca] = useState("");
  const [risultati, setRisultati] = useState<ConversazioneMeta[] | null>(null);
  const campoCerca = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!cerca.trim()) {
      setRisultati(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api.elenco(cerca).then(setRisultati, () => setRisultati([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [cerca]);

  const apriRicerca = () => {
    if (p.compatta) p.onCompatta(false);
    setCercaAperta(true);
    requestAnimationFrame(() => campoCerca.current?.focus());
  };

  const menuCantieri = (compatto: boolean) => (
    <Menu
      className={compatto ? "btn-icona barra__icona" : "barra__voce"}
      ariaLabel={compatto ? "Cantieri" : undefined}
      larghezza={300}
      contenuto={
        compatto ? (
          <Icona nome="cantiere" dimensione={20} />
        ) : (
          <>
            <Icona nome="cantiere" />
            Cantieri
          </>
        )
      }
    >
      {(chiudi) =>
        cantieriConsentiti().map((c) => (
          <VoceMenu
            key={c.id}
            attiva={c.id === p.cantiereId}
            onClick={() => {
              p.onCantiere(c.id);
              chiudi();
            }}
          >
            <span className="voce-cantiere">
              <span>{c.nome}</span>
              <span className="etichetta-mono">{c.indirizzo}</span>
            </span>
          </VoceMenu>
        ))
      }
    </Menu>
  );

  if (p.compatta) {
    return (
      <nav aria-label="Navigazione" className="barra barra--compatta">
        <span className="barra__marchio">
          <Marchio lato={36} />
        </span>
        <button type="button" className="btn-icona barra__icona" aria-label="Apri barra laterale" onClick={() => p.onCompatta(false)}>
          <Icona nome="barraLaterale" dimensione={20} />
        </button>
        <button type="button" className="btn-icona barra__icona" aria-label="Nuovo report" onClick={p.onNuovo}>
          <Icona nome="matita" dimensione={20} />
        </button>
        <button type="button" className="btn-icona barra__icona" aria-label="Cerca nei report" onClick={apriRicerca}>
          <Icona nome="cerca" dimensione={20} />
        </button>
        <a
          href="#/documenti"
          className={`btn-icona barra__icona${p.sezione === "documenti" ? " barra__icona--attiva" : ""}`}
          aria-label="Documenti"
          aria-current={p.sezione === "documenti" ? "page" : undefined}
        >
          <Icona nome="archivio" dimensione={20} />
        </a>
        {menuCantieri(true)}
        <span className="barra__spazio" />
        <MenuUtente compatto />
      </nav>
    );
  }

  const voci = risultati ?? elenco ?? [];
  const gruppi = risultati ? [{ titolo: "Risultati", voci: risultati }] : raggruppaPerData(voci);

  return (
    <>
      {p.apertaSuMobile && <div className="barra__velo" onClick={p.onChiudiMobile} aria-hidden="true" />}
      <aside aria-label="Cronologia report" className={`barra${p.apertaSuMobile ? " barra--aperta" : ""}`}>
        <div className="barra__testa">
          <Logo />
          <button
            type="button"
            className="btn-icona barra__chiudi"
            aria-label="Chiudi barra laterale"
            onClick={() => (p.apertaSuMobile ? p.onChiudiMobile() : p.onCompatta(true))}
          >
            <Icona nome={p.apertaSuMobile ? "chiudi" : "barraLaterale"} dimensione={20} />
          </button>
        </div>
        <button
          type="button"
          className={`barra__voce barra__voce--forte${p.sezione === "home" ? " barra__voce--attiva" : ""}`}
          onClick={p.onNuovo}
        >
          <Icona nome="matita" />
          Nuovo report
        </button>
        <button type="button" className="barra__voce" aria-expanded={cercaAperta} onClick={() => (cercaAperta ? setCercaAperta(false) : apriRicerca())}>
          <Icona nome="cerca" />
          Cerca nei report
        </button>
        {cercaAperta && (
          <label className="barra__cerca">
            <span className="sr-only">Cerca nei report</span>
            <input
              ref={campoCerca}
              type="search"
              placeholder="Titolo, impresa, lavorazione…"
              value={cerca}
              onChange={(e) => setCerca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCerca("");
                  setCercaAperta(false);
                }
              }}
            />
          </label>
        )}
        <a
          href="#/documenti"
          className={`barra__voce${p.sezione === "documenti" ? " barra__voce--attiva" : ""}`}
          aria-current={p.sezione === "documenti" ? "page" : undefined}
          onClick={p.onChiudiMobile}
        >
          <Icona nome="archivio" />
          Documenti
        </a>
        {menuCantieri(false)}

        <div className="barra__cronologia">
          {gruppi.map((g) => (
            <div key={g.titolo} className="barra__gruppo">
              <div className="etichetta-mono barra__titolo-gruppo">{g.titolo}</div>
              {g.voci.map((c) => (
                <a
                  key={c.id}
                  href={`#/c/${c.id}`}
                  className={`barra__report${c.id === p.idAttivo ? " barra__report--attivo" : ""}`}
                  aria-current={c.id === p.idAttivo ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    p.onApri(c.id);
                  }}
                >
                  {c.titolo}
                </a>
              ))}
            </div>
          ))}
          {elenco && elenco.length === 0 && !risultati && (
            <p className="barra__vuoto">I report che prepari compaiono qui.</p>
          )}
          {risultati && risultati.length === 0 && <p className="barra__vuoto">Nessun report trovato.</p>}
        </div>

        <MenuUtente compatto={false} />
      </aside>
    </>
  );
}

// Scheda del cantiere: creazione e onboarding dai documenti di progetto (documenti, poi
// revisione e conferma in chat con il Redattore) e, a scheda confermata, consultazione e
// modifica a mano.

import { useEffect, useState, type FormEvent } from "react";
import { eScheda } from "../../../shared/cantieri";
import { api } from "../../lib/api";
import { impostaCantiere, ricaricaCantiere, useCantiere } from "../../lib/cantieri";
import { caricaSessione, useSessione } from "../../lib/sessione";
import { apriRevisione } from "../../lib/stato";
import { Icona } from "../Icone";
import { SezioneComputo } from "./SezioneComputo";
import { SezioneDati } from "./SezioneDati";
import { SezioneDocumenti } from "./SezioneDocumenti";
import { SezioneZone } from "./SezioneZone";
import "../documenti/documenti.css";
import "./cantiere.css";

interface Props {
  id: string;
  onApriMenu: () => void;
  /** Rende questo il cantiere scelto e torna alla home. */
  onUsa: (id: string) => void;
}

export default function PaginaCantiere({ id, onApriMenu, onUsa }: Props) {
  return id === "nuovo" ? <NuovoCantiere onApriMenu={onApriMenu} /> : <Scheda key={id} id={id} onApriMenu={onApriMenu} onUsa={onUsa} />;
}

function Testata({ titolo, onApriMenu, stato }: { titolo: string; onApriMenu: () => void; stato?: "bozza" | "attiva" }) {
  return (
    <header className="testata testata--bordo">
      <div className="testata__sinistra cantiere__testata">
        <button type="button" className="btn-icona testata__menu" aria-label="Apri menu" onClick={onApriMenu}>
          <Icona nome="menu" dimensione={22} />
        </button>
        <h1 className="testata__titolo cantiere__titolo">{titolo}</h1>
        {stato === "bozza" && <span className="pillola pillola--stato-bozza">Scheda in bozza</span>}
        {stato === "attiva" && <span className="pillola pillola--stato-firmato">Scheda confermata</span>}
      </div>
    </header>
  );
}

function NuovoCantiere({ onApriMenu }: { onApriMenu: () => void }) {
  const [nome, setNome] = useState("");
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function crea(e: FormEvent) {
    e.preventDefault();
    setOccupato(true);
    setErrore(null);
    try {
      const s = await api.creaCantiere(nome);
      impostaCantiere(s);
      await caricaSessione();
      window.location.hash = `#/cantieri/${s.id}`;
    } catch (err) {
      setErrore((err as Error).message);
      setOccupato(false);
    }
  }

  return (
    <main className="vista cantiere">
      <Testata titolo="Nuovo cantiere" onApriMenu={onApriMenu} />
      <div className="cantiere__corpo">
        <div className="cantiere__bolla">
          <span className="cantiere__marchio" aria-hidden="true">
            <Icona nome="cantiere" dimensione={18} />
          </span>
          <p>
            Come si chiama il cantiere? Poi ti chiedo i documenti di progetto: contratto, computo, cronoprogramma e
            planimetrie. Li leggo io e ti propongo soggetti, importi, programma e zone da controllare prima di scrivere
            qualsiasi documento.
          </p>
        </div>
        <form className="cantiere__nuovo" onSubmit={(e) => void crea(e)}>
          <label className="cantiere__campo">
            <span className="etichetta-mono">Nome del cantiere</span>
            <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Es. Residenza Via Roma 12" maxLength={100} />
          </label>
          {errore && (
            <p className="cantiere__errore" role="alert">
              {errore}
            </p>
          )}
          <button type="submit" className="btn btn--primario" disabled={occupato || !nome.trim()}>
            {occupato ? "Creo…" : "Crea e carica i documenti →"}
          </button>
        </form>
      </div>
    </main>
  );
}

/** Avvia o riprende la revisione della scheda in chat con il Redattore. */
function useApriRevisione(id: string) {
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  async function apri(primoMessaggio: string) {
    setOccupato(true);
    setErrore(null);
    try {
      await apriRevisione(id, primoMessaggio);
    } catch (e) {
      setErrore((e as Error).message);
      setOccupato(false);
    }
  }
  return { apri, occupato, errore };
}

function Scheda({ id, onApriMenu, onUsa }: Props) {
  const voce = useCantiere(id);
  const s = voce?.stato === "pronto" && eScheda(voce.cantiere) ? voce.cantiere : null;
  const [scheda, setScheda] = useState<"dati" | "zone" | "documenti">("dati");
  const revisione = useApriRevisione(id);
  const io = useSessione()?.persona.id ?? "";
  const inLavoro = Boolean(s && (s.zoneInPreparazione || s.documenti.some((d) => d.stato === "in_coda" || d.stato === "in_lettura")));

  // Mentre il server legge i documenti o prepara le zone, la scheda si aggiorna da sola.
  useEffect(() => {
    if (!inLavoro) return;
    const t = window.setInterval(() => void ricaricaCantiere(id), 2000);
    return () => window.clearInterval(t);
  }, [id, inLavoro]);

  if (!voce || voce.stato === "carico") {
    return (
      <main className="vista cantiere">
        <Testata titolo="Scheda del cantiere" onApriMenu={onApriMenu} />
        <p className="cantiere__corpo cantiere__aiuto">Carico la scheda…</p>
      </main>
    );
  }
  if (voce.stato === "errore" || !s) {
    return (
      <main className="vista cantiere">
        <Testata titolo="Scheda del cantiere" onApriMenu={onApriMenu} />
        <div className="cantiere__corpo">
          <p className="cantiere__aiuto">
            {voce.stato === "errore" ? voce.errore : "È un cantiere di esempio: non ha una scheda da compilare."}
          </p>
        </div>
      </main>
    );
  }

  if (s.stato === "attiva") {
    return (
      <main className="vista cantiere">
        <Testata titolo={s.nome} onApriMenu={onApriMenu} stato="attiva" />
        <div className="cantiere__corpo">
          <div className="cantiere__schede" role="tablist" aria-label="Parti della scheda">
            {(["dati", "zone", "documenti"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={scheda === t}
                className={`documenti__scheda${scheda === t ? " documenti__scheda--scelta" : ""}`}
                onClick={() => setScheda(t)}
              >
                {t === "dati" ? "Dati" : t === "zone" ? `Zone (${s.zone.length})` : `Documenti (${s.documenti.length})`}
              </button>
            ))}
            <span className="cantiere__usa">
              <button
                type="button"
                className="btn btn--piccolo"
                disabled={revisione.occupato}
                onClick={() => void revisione.apri("Voglio correggere la scheda del cantiere.")}
              >
                Correggi in chat
              </button>
              <button type="button" className="btn btn--piccolo" onClick={() => onUsa(s.id)}>
                Nuovo report su questo cantiere →
              </button>
            </span>
          </div>
          {revisione.errore && (
            <p className="cantiere__errore" role="alert">
              {revisione.errore}
            </p>
          )}
          {scheda === "dati" && (
            <>
              <SezioneDati s={s} />
              <SezioneComputo s={s} />
            </>
          )}
          {scheda === "zone" && <SezioneZone s={s} />}
          {scheda === "documenti" && <SezioneDocumenti s={s} />}
        </div>
      </main>
    );
  }

  // In bozza: si caricano i documenti, poi revisione e conferma si fanno in chat con il Redattore.
  const giaIniziata = Boolean(s.revisioni?.[io]);
  const letti = s.documenti.filter((d) => d.stato === "letto").length;
  const primo = letti
    ? "Ho caricato i documenti di progetto: rivediamo insieme la scheda del cantiere."
    : "Non ho documenti di progetto da caricare: compiliamo insieme la scheda del cantiere.";
  return (
    <main className="vista cantiere">
      <Testata titolo={s.nome} onApriMenu={onApriMenu} stato="bozza" />
      <div className="cantiere__corpo">
        <ol className="cantiere__passi">
          <li>
            <span className="cantiere__passo cantiere__passo--attuale" aria-current="step">
              <span className="cantiere__passo-numero">1</span>
              Documenti
            </span>
          </li>
          <li>
            <button
              type="button"
              className="cantiere__passo"
              disabled={inLavoro || revisione.occupato}
              onClick={() => void revisione.apri(primo)}
            >
              <span className="cantiere__passo-numero">2</span>
              Revisione in chat
            </button>
          </li>
        </ol>

        <SezioneDocumenti s={s} />
        <div className="cantiere__avanti">
          <span className="cantiere__aiuto">
            {inLavoro
              ? "Sto leggendo: quando ho finito rivediamo insieme quello che ho trovato. Puoi anche chiudere e tornare più tardi."
              : s.documenti.length
                ? "Lettura finita: ti faccio vedere cosa ho trovato e ti chiedo conferma di quello che ho dedotto."
                : "Non hai documenti? Compiliamo la scheda parlando: ti chiedo io quello che serve."}
          </span>
          <button type="button" className="btn btn--primario" disabled={inLavoro || revisione.occupato} onClick={() => void revisione.apri(primo)}>
            {revisione.occupato
              ? "Apro la chat…"
              : giaIniziata
                ? "Riprendi la revisione in chat →"
                : s.documenti.length
                  ? "Rivediamo insieme in chat →"
                  : "Compiliamo insieme in chat →"}
          </button>
        </div>
        {revisione.errore && (
          <p className="cantiere__errore" role="alert">
            {revisione.errore}
          </p>
        )}
      </div>
    </main>
  );
}

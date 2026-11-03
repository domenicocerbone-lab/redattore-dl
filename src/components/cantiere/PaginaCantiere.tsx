// Scheda del cantiere: creazione, onboarding dai documenti di progetto (documenti →
// revisione → conferma) e, a scheda confermata, consultazione e modifica.

import { useEffect, useState, type FormEvent } from "react";
import { eScheda, type SchedaCantiere, type TabelleCantiere } from "../../../shared/cantieri";
import { formatEuro } from "../../../shared/numeri";
import { api } from "../../lib/api";
import { impostaCantiere, ricaricaCantiere, useCantiere } from "../../lib/cantieri";
import { caricaSessione } from "../../lib/sessione";
import { Icona } from "../Icone";
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

type Passo = "documenti" | "revisione" | "conferma";
const PASSI: { id: Passo; nome: string }[] = [
  { id: "documenti", nome: "Documenti" },
  { id: "revisione", nome: "Revisione" },
  { id: "conferma", nome: "Conferma" },
];

function Scheda({ id, onApriMenu, onUsa }: Props) {
  const voce = useCantiere(id);
  const s = voce?.stato === "pronto" && eScheda(voce.cantiere) ? voce.cantiere : null;
  const [passo, setPasso] = useState<Passo | null>(null);
  const [scheda, setScheda] = useState<"dati" | "zone" | "documenti">("dati");
  const [appenaConfermata, setAppenaConfermata] = useState(false);
  const inLavoro = Boolean(s && (s.zoneInPreparazione || s.documenti.some((d) => d.stato === "in_coda" || d.stato === "in_lettura")));

  // Mentre il server legge i documenti o prepara le zone, la scheda si aggiorna da sola.
  useEffect(() => {
    if (!inLavoro) return;
    const t = window.setInterval(() => void ricaricaCantiere(id), 2000);
    return () => window.clearInterval(t);
  }, [id, inLavoro]);

  // Si riparte dal punto giusto: documenti se non ce ne sono di letti, altrimenti revisione.
  useEffect(() => {
    if (s && passo === null) setPasso(s.documenti.some((d) => d.stato === "letto") && !inLavoro ? "revisione" : "documenti");
  }, [s, passo, inLavoro]);

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

  if (appenaConfermata) {
    return (
      <main className="vista cantiere">
        <Testata titolo={s.nome} onApriMenu={onApriMenu} stato="attiva" />
        <div className="cantiere__corpo">
          <section className="cantiere__sezione cantiere__pronto">
            <h2 className="cantiere__sottotitolo">Cantiere pronto</h2>
            <p className="cantiere__nota">
              Da ora il Redattore usa questa scheda in ogni nuovo report: soggetti e importi nelle intestazioni, computo e
              programma consultati quando servono. Puoi correggerla quando vuoi da «Scheda del cantiere».
            </p>
            <button type="button" className="btn btn--primario" onClick={() => onUsa(s.id)}>
              Inizia un report →
            </button>
          </section>
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
            <button type="button" className="btn btn--piccolo cantiere__usa" onClick={() => onUsa(s.id)}>
              Nuovo report su questo cantiere →
            </button>
          </div>
          {scheda === "dati" && <SezioneDati s={s} />}
          {scheda === "zone" && <SezioneZone s={s} />}
          {scheda === "documenti" && <SezioneDocumenti s={s} />}
        </div>
      </main>
    );
  }

  const attuale = passo ?? "documenti";
  return (
    <main className="vista cantiere">
      <Testata titolo={s.nome} onApriMenu={onApriMenu} stato="bozza" />
      <div className="cantiere__corpo">
        <ol className="cantiere__passi">
          {PASSI.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                className={`cantiere__passo${attuale === p.id ? " cantiere__passo--attuale" : ""}`}
                aria-current={attuale === p.id ? "step" : undefined}
                onClick={() => setPasso(p.id)}
              >
                <span className="cantiere__passo-numero">{i + 1}</span>
                {p.nome}
              </button>
            </li>
          ))}
        </ol>

        {attuale === "documenti" && (
          <>
            <SezioneDocumenti s={s} />
            <div className="cantiere__avanti">
              <span className="cantiere__aiuto">
                {inLavoro
                  ? "Sto leggendo: puoi andare avanti quando ho finito, o tornare più tardi."
                  : s.documenti.length
                    ? "Lettura finita: rivedi quello che ho trovato."
                    : "Non hai documenti? Puoi anche compilare la scheda a mano."}
              </span>
              <button type="button" className="btn btn--primario" disabled={inLavoro} onClick={() => setPasso("revisione")}>
                {s.documenti.length ? "Avanti: rivedi i dati →" : "Compila a mano →"}
              </button>
            </div>
          </>
        )}
        {attuale === "revisione" && (
          <>
            <SezioneDati s={s} />
            <SezioneZone s={s} />
            <div className="cantiere__avanti">
              <button type="button" className="btn btn--piccolo" onClick={() => setPasso("documenti")}>
                ← Documenti
              </button>
              <button type="button" className="btn btn--primario" onClick={() => setPasso("conferma")}>
                Avanti: conferma →
              </button>
            </div>
          </>
        )}
        {attuale === "conferma" && <Conferma s={s} onConfermata={() => setAppenaConfermata(true)} onIndietro={() => setPasso("revisione")} />}
      </div>
    </main>
  );
}

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function Conferma({ s, onConfermata, onIndietro }: { s: SchedaCantiere; onConfermata: () => void; onIndietro: () => void }) {
  const [tabelle, setTabelle] = useState<TabelleCantiere | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    api.tabelleCantiere(s.id).then(setTabelle, () => undefined);
  }, [s.id]);

  const ruolo = (...parole: string[]) => s.soggetti.some((x) => parole.some((p) => norm(x.ruolo).includes(p)) && x.nome.trim());
  const daVerificare =
    Object.values(s.fonti).filter((f) => f.certezza === "dedotto").length +
    s.soggetti.filter((x) => x.fonte?.certezza === "dedotto").length +
    s.zone.filter((z) => z.certezza === "dedotto").length;
  const totale = (tabelle?.voci ?? []).reduce((t, v) => t + (v.importo ?? 0), 0);
  const controlli: { ok: boolean; testo: string }[] = [
    { ok: ruolo("committente", "stazione appaltante"), testo: "Committente o stazione appaltante" },
    { ok: ruolo("impresa", "appaltator", "esecutore"), testo: "Impresa esecutrice" },
    { ok: ruolo("direttore dei lavori", "direzione lavori"), testo: "Direttore dei Lavori" },
    { ok: s.contratto.importo !== null, testo: s.contratto.importo !== null ? `Importo contrattuale ${formatEuro(s.contratto.importo)}` : "Importo contrattuale" },
    { ok: Boolean(s.date.consegnaLavori || s.date.ultimazionePrevista), testo: "Date contrattuali" },
    { ok: (tabelle?.voci.length ?? 0) > 0, testo: tabelle?.voci.length ? `Computo: ${tabelle.voci.length} voci${totale ? `, ${formatEuro(totale)}` : ""}` : "Computo metrico" },
    { ok: (tabelle?.attivita.length ?? 0) > 0, testo: tabelle?.attivita.length ? `Programma: ${tabelle.attivita.length} attività` : "Cronoprogramma" },
    {
      ok: s.zone.length > 0,
      testo: s.zone.length
        ? `${s.zone.length === 1 ? "1 zona" : `${s.zone.length} zone`}${s.vociSenzaZona.length ? `, ${s.vociSenzaZona.length} ${s.vociSenzaZona.length === 1 ? "voce" : "voci"} senza zona` : ""}`
        : "Zone",
    },
  ];
  const errori = s.documenti.filter((d) => d.stato === "errore");

  async function conferma() {
    setOccupato(true);
    setErrore(null);
    try {
      const confermata = await api.confermaCantiere(s.id);
      onConfermata();
      impostaCantiere(confermata);
      await caricaSessione();
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  return (
    <section className="cantiere__sezione" aria-labelledby="titolo-conferma">
      <h2 id="titolo-conferma" className="cantiere__sottotitolo">
        Prima di confermare
      </h2>
      <ul className="cantiere__controlli">
        {controlli.map((c) => (
          <li key={c.testo} className={c.ok ? "" : "cantiere__controllo--manca"}>
            <Icona nome={c.ok ? "spunta" : "trattino"} dimensione={16} />
            {c.testo}
            {!c.ok && <span className="etichetta-mono"> · manca</span>}
          </li>
        ))}
      </ul>
      {daVerificare > 0 && (
        <p className="cantiere__nota">
          {daVerificare === 1 ? "1 valore è segnato" : `${daVerificare} valori sono segnati`} «da verificare»: il Redattore li
          userà, ma te li ricorderà quando finiscono in un documento.
        </p>
      )}
      {errori.length > 0 && (
        <p className="cantiere__errore">
          {errori.length === 1 ? "Un documento non è stato letto" : `${errori.length} documenti non sono stati letti`}:{" "}
          {errori.map((d) => d.nome).join(", ")}.
        </p>
      )}
      <p className="cantiere__nota">Quello che manca lo puoi aggiungere anche dopo: il Redattore te lo chiederà quando serve.</p>
      {errore && (
        <p className="cantiere__errore" role="alert">
          {errore}
        </p>
      )}
      <div className="cantiere__avanti">
        <button type="button" className="btn btn--piccolo" onClick={onIndietro}>
          ← Revisione
        </button>
        <button type="button" className="btn btn--primario" disabled={occupato} onClick={() => void conferma()}>
          {occupato ? "Confermo…" : "Conferma la scheda"}
        </button>
      </div>
    </section>
  );
}

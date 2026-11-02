// Pagina dell'amministratore: chi usa il Redattore, quanto e con che costo,
// e i link personali (crea, rinnova, revoca).

import { useCallback, useEffect, useState } from "react";
import type { DatiPersona, Persona, RiepilogoUtilizzo, UtilizzoPersona } from "../../../shared/accessi";
import { CANTIERI } from "../../../shared/cantieri";
import { formatNumero } from "../../../shared/numeri";
import { api } from "../../lib/api";
import { quando } from "../../lib/date";
import { sessione } from "../../lib/sessione";
import { Icona } from "../Icone";
import { Menu, VoceMenu } from "../Menu";
import "./admin.css";

const PERIODI = [7, 30, 90] as const;
const dollari = (n: number) => `$ ${formatNumero(n, n > 0 && n < 1 ? 3 : 2)}`;
const giornoBreve = (giorno: string) => `${giorno.slice(8, 10)}/${giorno.slice(5, 7)}`;

interface Props {
  onEsci: () => void;
  onApri: (conversazione: string) => void;
}

export default function Admin({ onEsci, onApri }: Props) {
  const [giorni, setGiorni] = useState<(typeof PERIODI)[number]>(30);
  const [dati, setDati] = useState<RiepilogoUtilizzo | null>(null);
  const [errore, setErrore] = useState("");
  const [modulo, setModulo] = useState<Persona | "nuova" | null>(null);
  const [link, setLink] = useState<{ nome: string; link: string } | null>(null);

  const carica = useCallback(() => {
    api.utilizzo(giorni).then(
      (d) => {
        setDati(d);
        setErrore("");
      },
      (e: Error) => setErrore(e.message),
    );
  }, [giorni]);
  useEffect(carica, [carica]);

  async function azione(fare: () => Promise<unknown>) {
    try {
      await fare();
      carica();
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  const t = dati?.totali;
  const libero = sessione()?.accessoLibero;

  return (
    <div className="admin">
      <header className="admin__testata">
        <button type="button" className="btn btn--piccolo" onClick={onEsci}>
          ← Redattore
        </button>
        <h1 className="admin__titolo">Utilizzo e accessi</h1>
        <div className="admin__comandi">
          <div className="admin__periodo" role="radiogroup" aria-label="Periodo">
            {PERIODI.map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={g === giorni}
                className={`admin__periodo-voce${g === giorni ? " admin__periodo-voce--scelta" : ""}`}
                onClick={() => setGiorni(g)}
              >
                {g} giorni
              </button>
            ))}
          </div>
          <a className="btn btn--piccolo" href="/api/admin/eventi.csv" download>
            <Icona nome="scarica" dimensione={16} />
            CSV
          </a>
        </div>
      </header>

      {libero && (
        <div className="avviso" role="status">
          Accesso libero: sei in sviluppo o in demo e nessuno deve entrare. Online, con{" "}
          <code>REDATTORE_PASSWORD_ADMIN</code> impostata, i link personali funzionano.
        </div>
      )}
      {errore && (
        <div className="avviso" role="alert">
          {errore}
        </div>
      )}

      <main className="admin__corpo">
        {t && (
          <section aria-label="Totali del periodo" className="admin__kpi">
            <Indicatore etichetta="Persone attive" valore={t.personeAttive} />
            <Indicatore etichetta="Report iniziati" valore={t.conversazioni} />
            <Indicatore etichetta="Messaggi" valore={t.messaggi} />
            <Indicatore etichetta="Riprese 360° inviate" valore={t.riprese} />
            <Indicatore etichetta="Bozze generate" valore={t.bozze} />
            <Indicatore etichetta="Esportazioni" valore={t.esportazioni} />
            <Indicatore etichetta="Costo API stimato" valore={dollari(t.costo)} />
          </section>
        )}

        {dati && (
          <section className="admin__sezione">
            <h2 className="admin__sottotitolo">Messaggi al giorno</h2>
            <Grafico giorni={dati.perGiorno} />
          </section>
        )}

        <section className="admin__sezione">
          <div className="admin__intestazione-sezione">
            <h2 className="admin__sottotitolo">Persone</h2>
            <button type="button" className="btn btn--piccolo btn--primario" onClick={() => setModulo("nuova")}>
              Aggiungi persona
            </button>
          </div>
          {dati && dati.persone.length === 0 && (
            <p className="admin__vuoto">
              Nessuna persona ancora. Aggiungine una: riceverai il link personale da mandarle.
            </p>
          )}
          {dati && dati.persone.length > 0 && (
            <TabellaPersone
              righe={dati.persone}
              onModifica={setModulo}
              onNuovoLink={(p) =>
                void azione(async () => {
                  if (!window.confirm(`Il link attuale di ${p.nome} smetterà di funzionare. Continuare?`)) return;
                  const { link: nuovo } = await api.nuovoLink(p.id);
                  setLink({ nome: p.nome, link: nuovo });
                })
              }
              onRevoca={(p) =>
                void azione(() =>
                  p.revocataIl
                    ? api.revoca(p.id, false)
                    : window.confirm(`${p.nome} non potrà più entrare. Revocare l'accesso?`)
                      ? api.revoca(p.id, true)
                      : Promise.resolve(),
                )
              }
            />
          )}
        </section>

        {dati && (
          <section className="admin__sezione">
            <h2 className="admin__sottotitolo">Attività recente</h2>
            {dati.attivita.length === 0 ? (
              <p className="admin__vuoto">Nessuna attività in questo periodo.</p>
            ) : (
              <ol className="admin__attivita">
                {dati.attivita.map((a, i) => (
                  <li key={`${a.il}-${i}`} className="admin__evento">
                    <span className="etichetta-mono admin__evento-quando">{quando(a.il)}</span>
                    <span className="admin__evento-testo">
                      <strong>{a.persona}</strong> {a.descrizione}
                    </span>
                    <span className="admin__evento-coda">
                      {a.costo !== undefined && a.costo > 0 && <span className="etichetta-mono">{dollari(a.costo)}</span>}
                      {a.conversazione && (
                        <button type="button" className="admin__apri" onClick={() => onApri(a.conversazione!)}>
                          Apri
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        <p className="avvertenza">
          Costi stimati dai token di ogni risposta ai prezzi di listino dell'API; la fattura effettiva è nella console
          Anthropic.
        </p>
      </main>

      {modulo && (
        <ModuloPersona
          persona={modulo === "nuova" ? null : modulo}
          onChiudi={() => setModulo(null)}
          onSalva={async (d) => {
            if (modulo === "nuova") {
              const creata = await api.creaPersona(d);
              setLink({ nome: creata.persona.nome, link: creata.link });
            } else {
              await api.aggiornaPersona(modulo.id, d);
            }
            setModulo(null);
            carica();
          }}
        />
      )}
      {link && <LinkCreato {...link} onChiudi={() => setLink(null)} />}
    </div>
  );
}

function Indicatore({ etichetta, valore }: { etichetta: string; valore: number | string }) {
  return (
    <div className="admin__indicatore">
      <span className="etichetta-mono">{etichetta}</span>
      <span className="admin__valore">{typeof valore === "number" ? formatNumero(valore, 0) : valore}</span>
    </div>
  );
}

/** Colonne dei messaggi per giorno: una sola serie, quindi niente legenda; il dettaglio al passaggio. */
function Grafico({ giorni }: { giorni: RiepilogoUtilizzo["perGiorno"] }) {
  const [attivo, setAttivo] = useState<number | null>(null);
  const massimo = Math.max(1, ...giorni.map((g) => g.messaggi));
  const tacche = [0, Math.floor(giorni.length / 2), giorni.length - 1];
  const scelto = attivo !== null ? giorni[attivo] : null;
  return (
    <figure className="grafico">
      <div className="grafico__asse etichetta-mono" aria-hidden="true">
        <span>{massimo}</span>
        <span>0</span>
      </div>
      <div className="grafico__area" onMouseLeave={() => setAttivo(null)}>
        <div className="grafico__colonne" style={{ gap: giorni.length > 45 ? 1 : 2 }}>
          {giorni.map((g, i) => (
            <div
              key={g.giorno}
              className="grafico__colonna"
              tabIndex={0}
              aria-label={`${giornoBreve(g.giorno)}: ${g.messaggi} messaggi, ${dollari(g.costo)}`}
              onMouseEnter={() => setAttivo(i)}
              onFocus={() => setAttivo(i)}
              onBlur={() => setAttivo(null)}
            >
              {g.messaggi > 0 && (
                <span
                  className={`grafico__barra${attivo === i ? " grafico__barra--attiva" : ""}`}
                  style={{ height: `${(g.messaggi / massimo) * 100}%` }}
                />
              )}
            </div>
          ))}
        </div>
        {scelto && attivo !== null && (
          <div
            className="grafico__suggerimento"
            // Di fianco alla colonna, verso il centro: non copre la barra e non esce dal grafico.
            style={
              attivo >= giorni.length / 2
                ? { left: `${(attivo / giorni.length) * 100}%`, transform: "translateX(calc(-100% - 6px))" }
                : { left: `${((attivo + 1) / giorni.length) * 100}%`, transform: "translateX(6px)" }
            }
            role="status"
          >
            <strong>{giornoBreve(scelto.giorno)}</strong>
            <span>
              {scelto.messaggi} {scelto.messaggi === 1 ? "messaggio" : "messaggi"} · {dollari(scelto.costo)}
            </span>
          </div>
        )}
        <div className="grafico__date etichetta-mono" aria-hidden="true">
          {tacche.map((i) => (
            <span key={i} style={{ left: `${((i + 0.5) / giorni.length) * 100}%` }}>
              {giornoBreve(giorni[i].giorno)}
            </span>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>Messaggi e costo per giorno</caption>
        <tbody>
          {giorni.map((g) => (
            <tr key={g.giorno}>
              <th scope="row">{giornoBreve(g.giorno)}</th>
              <td>{g.messaggi}</td>
              <td>{dollari(g.costo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function TabellaPersone({
  righe,
  onModifica,
  onNuovoLink,
  onRevoca,
}: {
  righe: UtilizzoPersona[];
  onModifica: (p: Persona) => void;
  onNuovoLink: (p: Persona) => void;
  onRevoca: (p: Persona) => void;
}) {
  return (
    <div className="scheda admin__tabella-contenitore">
      <table className="admin__tabella">
        <thead>
          <tr>
            <th>Persona</th>
            <th>Ultima attività</th>
            <th className="num">Giorni attivi</th>
            <th className="num">Report</th>
            <th className="num">Messaggi</th>
            <th className="num">Riprese</th>
            <th className="num">Bozze</th>
            <th className="num">Esportazioni</th>
            <th className="num">Costo</th>
            <th>
              <span className="sr-only">Azioni</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {righe.map((r) => {
            const p = r.persona;
            return (
              <tr key={p.id} className={p.revocataIl ? "admin__riga--revocata" : undefined}>
                <td data-etichetta="Persona">
                  <span className="admin__persona">
                    <strong>{p.nome}</strong>
                    {p.admin && <span className="pillola pillola--neutra">Admin</span>}
                    {p.revocataIl && <span className="pillola pillola--attenzione">Revocato</span>}
                  </span>
                  <span className="admin__dettaglio">
                    {[p.organizzazione, p.ruolo].filter(Boolean).join(" · ")}
                    {!p.admin && ` · ${p.cantieri.length === 1 ? "1 cantiere" : `${p.cantieri.length} cantieri`}`}
                  </span>
                </td>
                <td data-etichetta="Ultima attività">{r.ultimaAttivita ? quando(r.ultimaAttivita) : "mai entrato"}</td>
                <td className="num" data-etichetta="Giorni attivi">{r.giorniAttivi}</td>
                <td className="num" data-etichetta="Report">{r.conversazioni}</td>
                <td className="num" data-etichetta="Messaggi">
                  {r.messaggi}
                  <span className="admin__dettaglio">
                    oggi {r.messaggiOggi}
                    {p.limiteGiornaliero !== null && ` di ${p.limiteGiornaliero}`}
                  </span>
                </td>
                <td className="num" data-etichetta="Riprese">{r.riprese}</td>
                <td className="num" data-etichetta="Bozze">{r.bozze}</td>
                <td className="num" data-etichetta="Esportazioni">{r.esportazioni}</td>
                <td className="num" data-etichetta="Costo">{dollari(r.costo)}</td>
                <td className="admin__azioni">
                  <Menu className="btn-icona" ariaLabel={`Azioni per ${p.nome}`} allinea="destra" larghezza={220} contenuto="⋯">
                    {(chiudi) => (
                      <>
                        <VoceMenu onClick={() => { chiudi(); onModifica(p); }}>Modifica</VoceMenu>
                        {!p.admin && (
                          <VoceMenu onClick={() => { chiudi(); onNuovoLink(p); }}>Nuovo link</VoceMenu>
                        )}
                        {!p.admin && (
                          <VoceMenu onClick={() => { chiudi(); onRevoca(p); }}>
                            {p.revocataIl ? "Riattiva l'accesso" : "Revoca l'accesso"}
                          </VoceMenu>
                        )}
                      </>
                    )}
                  </Menu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Dialogo({ titolo, onChiudi, children }: { titolo: string; onChiudi: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onChiudi();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onChiudi]);
  return (
    <div className="admin__velo" onMouseDown={(e) => e.target === e.currentTarget && onChiudi()}>
      <div role="dialog" aria-modal="true" aria-label={titolo} className="admin__dialogo">
        <div className="admin__dialogo-testa">
          <h2 className="admin__sottotitolo">{titolo}</h2>
          <button type="button" className="btn-icona" aria-label="Chiudi" onClick={onChiudi}>
            <Icona nome="chiudi" dimensione={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModuloPersona({
  persona,
  onChiudi,
  onSalva,
}: {
  persona: Persona | null;
  onChiudi: () => void;
  onSalva: (d: DatiPersona) => Promise<void>;
}) {
  const [d, setD] = useState<DatiPersona>({
    nome: persona?.nome ?? "",
    organizzazione: persona?.organizzazione ?? "",
    ruolo: persona?.ruolo ?? "Direttore dei Lavori",
    cantieri: persona?.cantieri ?? [CANTIERI[0].id],
    limiteGiornaliero: persona ? persona.limiteGiornaliero : 40,
  });
  const [errore, setErrore] = useState("");
  const [invio, setInvio] = useState(false);
  const admin = persona?.admin;
  const aggiorna = (parte: Partial<DatiPersona>) => setD((x) => ({ ...x, ...parte }));

  async function invia(e: React.FormEvent) {
    e.preventDefault();
    setInvio(true);
    try {
      await onSalva(d);
    } catch (err) {
      setErrore((err as Error).message);
      setInvio(false);
    }
  }

  return (
    <Dialogo titolo={persona ? `Modifica ${persona.nome}` : "Aggiungi persona"} onChiudi={onChiudi}>
      <form className="admin__modulo" onSubmit={invia}>
        <label className="admin__campo">
          <span className="etichetta-mono">Nome e titolo</span>
          <input required autoFocus value={d.nome} placeholder="Arch. Mario Rossi" onChange={(e) => aggiorna({ nome: e.target.value })} />
        </label>
        <label className="admin__campo">
          <span className="etichetta-mono">Studio o impresa</span>
          <input value={d.organizzazione} placeholder="Studio Rossi" onChange={(e) => aggiorna({ organizzazione: e.target.value })} />
        </label>
        <label className="admin__campo">
          <span className="etichetta-mono">Ruolo nei documenti</span>
          <input value={d.ruolo} onChange={(e) => aggiorna({ ruolo: e.target.value })} />
        </label>
        {!admin && (
          <fieldset className="admin__campo admin__gruppo">
            <legend className="etichetta-mono">Cantieri che può vedere</legend>
            {CANTIERI.map((c) => (
              <label key={c.id} className="admin__scelta">
                <input
                  type="checkbox"
                  checked={d.cantieri.includes(c.id)}
                  onChange={(e) =>
                    aggiorna({ cantieri: e.target.checked ? [...d.cantieri, c.id] : d.cantieri.filter((x) => x !== c.id) })
                  }
                />
                {c.nome}
              </label>
            ))}
          </fieldset>
        )}
        {!admin && (
          <div className="admin__campo">
            <span className="etichetta-mono">Messaggi al giorno</span>
            <div className="admin__limite">
              <input
                type="number"
                min={1}
                max={1000}
                aria-label="Messaggi al giorno"
                disabled={d.limiteGiornaliero === null}
                value={d.limiteGiornaliero ?? ""}
                onChange={(e) => aggiorna({ limiteGiornaliero: Number(e.target.value) || 1 })}
              />
              <label className="admin__scelta">
                <input
                  type="checkbox"
                  checked={d.limiteGiornaliero === null}
                  onChange={(e) => aggiorna({ limiteGiornaliero: e.target.checked ? null : 40 })}
                />
                Nessun limite
              </label>
            </div>
          </div>
        )}
        {errore && <p className="admin__errore" role="alert">{errore}</p>}
        <div className="admin__pulsanti">
          <button type="button" className="btn btn--piccolo" onClick={onChiudi}>
            Annulla
          </button>
          <button type="submit" className="btn btn--piccolo btn--primario" disabled={invio || !d.nome.trim() || (!admin && d.cantieri.length === 0)}>
            {persona ? "Salva" : "Crea il link"}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

function LinkCreato({ nome, link, onChiudi }: { nome: string; link: string; onChiudi: () => void }) {
  const [copiato, setCopiato] = useState(false);
  return (
    <Dialogo titolo={`Link per ${nome}`} onChiudi={onChiudi}>
      <div className="admin__modulo">
        <div className="admin__link">
          <input readOnly value={link} aria-label="Link personale" onFocus={(e) => e.currentTarget.select()} />
          <button
            type="button"
            className="btn btn--piccolo btn--primario"
            onClick={() =>
              void navigator.clipboard.writeText(link).then(() => {
                setCopiato(true);
                window.setTimeout(() => setCopiato(false), 1500);
              })
            }
          >
            {copiato ? "Copiato" : "Copia"}
          </button>
        </div>
        <p className="admin__nota">
          Mandalo solo a {nome}: chi lo apre entra con il suo nome e tutto quello che fa viene registrato a suo nome.
          Il link non viene conservato: copialo adesso. Se si perde, crea un nuovo link e quello vecchio smette di
          funzionare.
        </p>
        <div className="admin__pulsanti">
          <button type="button" className="btn btn--piccolo" onClick={onChiudi}>
            Fatto
          </button>
        </div>
      </div>
    </Dialogo>
  );
}

// Revisione dei dati del cantiere: generali, soggetti, contratto e date, lavorazioni.
// Bozza locale: si salva con «Salva»; finché non ci sono modifiche segue la scheda dal server.

import { useEffect, useState } from "react";
import type { Fonte, SchedaCantiere } from "../../../shared/cantieri";
import { api } from "../../lib/api";
import { impostaCantiere } from "../../lib/cantieri";
import { Icona } from "../Icone";
import { ChipFonte, verificata } from "./Fonte";

type Bozza = Pick<
  SchedaCantiere,
  "nome" | "breve" | "indirizzo" | "appalto" | "lavori" | "anagrafica" | "soggetti" | "contratto" | "date" | "lavorazioni" | "fonti"
>;

const daScheda = (s: SchedaCantiere): Bozza => ({
  nome: s.nome,
  breve: s.breve,
  indirizzo: s.indirizzo,
  appalto: s.appalto,
  lavori: s.lavori,
  anagrafica: { ...s.anagrafica },
  soggetti: s.soggetti.map((x) => ({ ...x })),
  contratto: { ...s.contratto },
  date: { ...s.date },
  lavorazioni: s.lavorazioni.map((x) => ({ ...x })),
  fonti: { ...s.fonti },
});

const numero = (t: string): number | null => {
  const n = Number(t.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return t.trim() === "" || !Number.isFinite(n) ? null : n;
};
const mostra = (n: number | null) => (n === null ? "" : n.toLocaleString("it-IT", { maximumFractionDigits: 3 }));

export function SezioneDati({ s }: { s: SchedaCantiere }) {
  const [b, setB] = useState<Bozza>(() => daScheda(s));
  const [sporca, setSporca] = useState(false);
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [salvata, setSalvata] = useState(false);

  // Finché l'utente non tocca nulla, la bozza segue la scheda (per esempio a lettura finita).
  useEffect(() => {
    if (!sporca) setB(daScheda(s));
  }, [s, sporca]);

  function cambia(f: (x: Bozza) => Bozza) {
    setB((x) => f(x));
    setSporca(true);
    setSalvata(false);
  }
  /** Modifica un campo semplice: se era dedotto, ora è verificato dall'utente. */
  function campo<K extends keyof Bozza>(chiave: K, valore: Bozza[K], fonte?: string) {
    cambia((x) => ({
      ...x,
      [chiave]: valore,
      fonti: fonte && x.fonti[fonte] ? { ...x.fonti, [fonte]: verificata(x.fonti[fonte])! } : x.fonti,
    }));
  }

  async function salva() {
    setOccupato(true);
    setErrore(null);
    try {
      const anagrafica = Object.fromEntries(Object.entries(b.anagrafica).filter(([k, v]) => k.trim() && v.trim()));
      const nuova = await api.aggiornaCantiere(s.id, {
        ...b,
        anagrafica,
        soggetti: b.soggetti.filter((x) => x.nome.trim() || x.ruolo.trim()),
        lavorazioni: b.lavorazioni.filter((x) => x.descrizione.trim()),
      });
      impostaCantiere(nuova);
      setSporca(false);
      setSalvata(true);
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  const fonte = (chiave: string): Fonte | undefined => b.fonti[chiave];
  const etichetta = (testo: string, chiave?: string) => (
    <span className="cantiere__etichetta">
      <span className="etichetta-mono">{testo}</span>
      {chiave && <ChipFonte fonte={fonte(chiave)} documenti={s.documenti} />}
    </span>
  );
  const dedotto = (chiave: string) => (fonte(chiave)?.certezza === "dedotto" ? " cantiere__campo--dedotto" : "");
  const anagrafica = Object.entries(b.anagrafica);

  return (
    <section className="cantiere__sezione" aria-labelledby="titolo-dati">
      <div className="cantiere__sezione-testa">
        <h2 id="titolo-dati" className="cantiere__sottotitolo">
          Dati del cantiere
        </h2>
        {salvata && !sporca && (
          <span className="pillola pillola--stato-firmato" role="status">
            Salvati
          </span>
        )}
      </div>
      <p className="cantiere__nota">
        Controlla quello che ho letto. Accanto a ogni valore c'è il documento da cui viene; quelli <em>da verificare</em> li ho
        dedotti e non sono scritti alla lettera.
      </p>

      <div className="cantiere__griglia">
        <label className="cantiere__campo">
          {etichetta("Nome del cantiere")}
          <input value={b.nome} onChange={(e) => campo("nome", e.target.value)} />
        </label>
        <label className="cantiere__campo">
          {etichetta("Nome breve")}
          <input value={b.breve} maxLength={30} onChange={(e) => campo("breve", e.target.value)} />
        </label>
        <label className={`cantiere__campo cantiere__campo--largo${dedotto("indirizzo")}`}>
          {etichetta("Indirizzo", "indirizzo")}
          <input value={b.indirizzo} onChange={(e) => campo("indirizzo", e.target.value, "indirizzo")} />
        </label>
        <label className={`cantiere__campo cantiere__campo--largo${dedotto("lavori")}`}>
          {etichetta("Oggetto dei lavori", "lavori")}
          <textarea rows={2} value={b.lavori} onChange={(e) => campo("lavori", e.target.value, "lavori")} />
        </label>
        <label className={`cantiere__campo${dedotto("appalto")}`}>
          {etichetta("Appalto", "appalto")}
          <select value={b.appalto} onChange={(e) => campo("appalto", e.target.value as "pubblico" | "privato", "appalto")}>
            <option value="privato">Privato</option>
            <option value="pubblico">Pubblico</option>
          </select>
        </label>
      </div>

      {anagrafica.length > 0 && (
        <div className="cantiere__griglia">
          {anagrafica.map(([k, v]) => (
            <label key={k} className={`cantiere__campo${dedotto(`anagrafica.${k}`)}`}>
              {etichetta(k, `anagrafica.${k}`)}
              <input value={v} onChange={(e) => campo("anagrafica", { ...b.anagrafica, [k]: e.target.value }, `anagrafica.${k}`)} />
            </label>
          ))}
        </div>
      )}

      <h3 className="cantiere__titoletto">Soggetti</h3>
      {b.soggetti.length === 0 && <p className="cantiere__aiuto">Nessun soggetto ancora: aggiungili o carica il contratto.</p>}
      <ul className="cantiere__righe">
        {b.soggetti.map((x, i) => (
          <li key={i} className={`cantiere__riga${x.fonte?.certezza === "dedotto" ? " cantiere__campo--dedotto" : ""}`}>
            <input
              aria-label="Ruolo"
              placeholder="Ruolo"
              className="cantiere__riga-ruolo"
              value={x.ruolo}
              onChange={(e) => cambia((y) => ({ ...y, soggetti: y.soggetti.map((z, j) => (j === i ? { ...z, ruolo: e.target.value, fonte: verificata(z.fonte) } : z)) }))}
            />
            <input
              aria-label="Nome"
              placeholder="Nome o ragione sociale"
              value={x.nome}
              onChange={(e) => cambia((y) => ({ ...y, soggetti: y.soggetti.map((z, j) => (j === i ? { ...z, nome: e.target.value, fonte: verificata(z.fonte) } : z)) }))}
            />
            <input
              aria-label="Dettagli"
              placeholder="Sede, P.IVA, albo…"
              value={x.dettagli}
              onChange={(e) => cambia((y) => ({ ...y, soggetti: y.soggetti.map((z, j) => (j === i ? { ...z, dettagli: e.target.value } : z)) }))}
            />
            <ChipFonte fonte={x.fonte} documenti={s.documenti} />
            <button
              type="button"
              className="btn-icona"
              aria-label={`Togli ${x.nome || "soggetto"}`}
              onClick={() => cambia((y) => ({ ...y, soggetti: y.soggetti.filter((_, j) => j !== i) }))}
            >
              <Icona nome="chiudi" dimensione={15} />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn--piccolo cantiere__aggiungi"
        onClick={() => cambia((y) => ({ ...y, soggetti: [...y.soggetti, { ruolo: "", nome: "", dettagli: "" }] }))}
      >
        <Icona nome="piu" dimensione={15} />
        Aggiungi soggetto
      </button>

      <h3 className="cantiere__titoletto">Contratto e date</h3>
      <div className="cantiere__griglia">
        {(
          [
            ["importo", "Importo contrattuale (€)"],
            ["oneriSicurezza", "Oneri della sicurezza (€)"],
            ["ribassoPercentuale", "Ribasso (%)"],
            ["ritenutaPercentuale", "Ritenuta a garanzia (%)"],
          ] as const
        ).map(([k, nome]) => (
          <label key={k} className={`cantiere__campo${dedotto(`contratto.${k}`)}`}>
            {etichetta(nome, `contratto.${k}`)}
            <input
              inputMode="decimal"
              defaultValue={mostra(b.contratto[k])}
              key={`${k}-${b.contratto[k]}-${sporca ? "m" : "s"}`}
              onBlur={(e) => {
                const v = numero(e.target.value);
                if (v !== b.contratto[k]) campo("contratto", { ...b.contratto, [k]: v }, `contratto.${k}`);
              }}
            />
          </label>
        ))}
        <label className={`cantiere__campo${dedotto("date.consegnaLavori")}`}>
          {etichetta("Consegna lavori", "date.consegnaLavori")}
          <input type="date" value={b.date.consegnaLavori} onChange={(e) => campo("date", { ...b.date, consegnaLavori: e.target.value }, "date.consegnaLavori")} />
        </label>
        <label className={`cantiere__campo${dedotto("date.durataGiorni")}`}>
          {etichetta("Durata (giorni)", "date.durataGiorni")}
          <input
            inputMode="numeric"
            value={b.date.durataGiorni ?? ""}
            onChange={(e) => {
              const n = numero(e.target.value);
              campo("date", { ...b.date, durataGiorni: n === null ? null : Math.max(0, Math.round(n)) }, "date.durataGiorni");
            }}
          />
        </label>
        <label className={`cantiere__campo${dedotto("date.ultimazionePrevista")}`}>
          {etichetta("Ultimazione prevista", "date.ultimazionePrevista")}
          <input type="date" value={b.date.ultimazionePrevista} onChange={(e) => campo("date", { ...b.date, ultimazionePrevista: e.target.value }, "date.ultimazionePrevista")} />
        </label>
      </div>

      <h3 className="cantiere__titoletto">Lavorazioni previste</h3>
      {b.lavorazioni.length === 0 && <p className="cantiere__aiuto">Nessuna lavorazione ancora: le leggo dal contratto o dal capitolato.</p>}
      <ul className="cantiere__righe">
        {b.lavorazioni.map((x, i) => (
          <li key={i} className="cantiere__riga">
            <input
              aria-label="Categoria"
              placeholder="Categoria"
              className="cantiere__riga-ruolo"
              value={x.categoria}
              onChange={(e) => cambia((y) => ({ ...y, lavorazioni: y.lavorazioni.map((z, j) => (j === i ? { ...z, categoria: e.target.value } : z)) }))}
            />
            <input
              aria-label="Descrizione"
              placeholder="Descrizione"
              className="cantiere__riga-largo"
              value={x.descrizione}
              onChange={(e) => cambia((y) => ({ ...y, lavorazioni: y.lavorazioni.map((z, j) => (j === i ? { ...z, descrizione: e.target.value } : z)) }))}
            />
            <ChipFonte fonte={x.fonte} documenti={s.documenti} />
            <button
              type="button"
              className="btn-icona"
              aria-label="Togli la lavorazione"
              onClick={() => cambia((y) => ({ ...y, lavorazioni: y.lavorazioni.filter((_, j) => j !== i) }))}
            >
              <Icona nome="chiudi" dimensione={15} />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn--piccolo cantiere__aggiungi"
        onClick={() => cambia((y) => ({ ...y, lavorazioni: [...y.lavorazioni, { categoria: "", descrizione: "" }] }))}
      >
        <Icona nome="piu" dimensione={15} />
        Aggiungi lavorazione
      </button>

      {(sporca || errore) && (
        <div className="cantiere__salva" role="region" aria-label="Modifiche da salvare">
          {errore ? <span className="cantiere__errore">{errore}</span> : <span>Hai modifiche non salvate.</span>}
          <button
            type="button"
            className="btn btn--piccolo"
            disabled={occupato}
            onClick={() => {
              setB(daScheda(s));
              setSporca(false);
              setErrore(null);
            }}
          >
            Annulla
          </button>
          <button type="button" className="btn btn--piccolo btn--primario" disabled={occupato} onClick={() => void salva()}>
            {occupato ? "Salvo…" : "Salva"}
          </button>
        </div>
      )}
    </section>
  );
}

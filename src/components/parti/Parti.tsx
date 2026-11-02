// Le schede che il Redattore inserisce nella chat: dati raccolti, foto, proposte,
// controlli, decisioni, righe di misura, documenti e pulsanti di risposta.

import type { Parte, ParteDi, Parziale, RifDocumento, TipoParte } from "../../../shared/schema";
import { tipoDocumento } from "../../../shared/documenti";
import { calcolaMisure, formatNumero } from "../../../shared/numeri";
import { Icona } from "../Icone";
import { TestoRicco } from "../TestoRicco";
import "./parti.css";

export interface Azione {
  messaggio: string;
  modo: "invia" | "scrivi";
}

export interface ContestoParti {
  /** Le azioni sono attive solo nell'ultima risposta, a turno concluso. */
  attiva: boolean;
  inScrittura: boolean;
  documentoAperto: RifDocumento | "in_scrittura" | null;
  onAzione: (a: Azione) => void;
  onApriDocumento: (rif: RifDocumento | "in_scrittura") => void;
}

type P<T extends TipoParte> = { parte: Parziale<ParteDi<T>>; ctx: ContestoParti };

function DatiRaccolti({ parte }: P<"dati_raccolti">) {
  const campi = parte.campi ?? [];
  const obbligatori = campi.filter((c) => c.stato !== "facoltativo");
  const completi = obbligatori.filter((c) => c.stato === "ok").length;
  const percentuale = obbligatori.length ? Math.round((completi / obbligatori.length) * 100) : 0;
  return (
    <div className="scheda">
      <div className="scheda__testa">
        <span className="scheda__titolo">Dati raccolti</span>
        <span className="scheda__conto">
          {completi} / {obbligatori.length} obbligatori
        </span>
      </div>
      <div className="barra-progresso" role="progressbar" aria-valuenow={percentuale} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${percentuale}%` }} />
      </div>
      <div className="dati-raccolti">
        {campi.map((c, i) => {
          const problema = c.stato === "manca" || c.stato === "da_chiarire";
          return (
            <div key={i} className={`dati-raccolti__campo${problema ? " dati-raccolti__campo--problema" : ""}${c.stato === "facoltativo" ? " dati-raccolti__campo--facoltativo" : ""}`}>
              <span className="dati-raccolti__icona">
                {c.stato === "ok" && <Icona nome="spunta" dimensione={16} tratto={2} colore="var(--nv-mint-dark)" />}
                {c.stato === "manca" && <Icona nome="cerchio" dimensione={16} tratto={2} colore="var(--nv-orange-ink)" />}
                {c.stato === "da_chiarire" && <Icona nome="domanda" dimensione={16} tratto={2} colore="var(--nv-orange-ink)" />}
                {c.stato === "facoltativo" && <Icona nome="trattino" dimensione={16} tratto={2} />}
              </span>
              <span>
                <b>{c.nome}</b>
                {" · "}
                {c.stato === "manca" ? (
                  <span className="testo-attenzione">manca</span>
                ) : c.stato === "da_chiarire" ? (
                  <span className="testo-attenzione">{c.valore ? `${c.valore} — da chiarire` : "da chiarire"}</span>
                ) : (
                  c.valore || (c.stato === "facoltativo" ? "facoltativo" : "")
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FotoOsservate({ parte }: P<"foto_osservate">) {
  return (
    <div className="scheda">
      <div className="scheda__testa scheda__testa--bordo">
        <span className="scheda__titolo">Cosa vedo nelle foto</span>
      </div>
      {(parte.osservazioni ?? []).map((o, i) => (
        <div key={i} className={`riga-foto${o.attenzione ? " riga-foto--attenzione" : ""}`}>
          <span className="riga-foto__etichette">{(o.foto ?? []).join(" ")}</span>
          <span>{o.descrizione}</span>
        </div>
      ))}
    </div>
  );
}

const BADGE: Record<string, { testo: string; classe: string } | null> = {
  consigliata: { testo: "Consigliata", classe: "" },
  da_confermare: { testo: "Da confermare", classe: "pillola--attenzione" },
  sicurezza: { testo: "Sicurezza", classe: "pillola--attenzione" },
  nessuno: null,
};

function ProposteBozze({ parte, ctx }: P<"proposte_bozze">) {
  return (
    <div className="proposte">
      {(parte.proposte ?? []).map((p, i) => {
        const badge = BADGE[p.badge ?? "nessuno"];
        const consigliata = p.badge === "consigliata";
        const totale = p.campi_obbligatori ?? 0;
        const fatti = Math.min(p.campi_compilati ?? 0, totale);
        return (
          <div key={i} className={`proposta${consigliata ? " proposta--consigliata" : ""}`}>
            <div className="proposta__testa">
              {badge ? <span className={`pillola pillola--piccola ${badge.classe}`}>{badge.testo}</span> : <span />}
              <span className="proposta__foto">{p.foto}</span>
            </div>
            <span className="proposta__titolo">{p.titolo ?? tipoDocumento(p.tipo_documento)?.nome}</span>
            <span className="proposta__sintesi">{p.sintesi}</span>
            {totale > 0 && (
              <>
                <div className="barra-progresso">
                  <span style={{ width: `${Math.round((fatti / totale) * 100)}%` }} />
                </div>
                <span className="proposta__conto">
                  {fatti} DI {totale} OBBLIGATORI
                </span>
              </>
            )}
            <button
              type="button"
              className={`btn proposta__azione${consigliata ? " btn--primario" : ""}`}
              disabled={!ctx.attiva || !p.messaggio}
              onClick={() => p.messaggio && ctx.onAzione({ messaggio: p.messaggio, modo: "invia" })}
            >
              {consigliata ? "Apri bozza →" : "Prepara →"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

const ESITI: Record<string, { testo: string; classe: string }> = {
  in_linea: { testo: "In linea", classe: "esito--ok" },
  concluso: { testo: "Concluso", classe: "esito--ok" },
  in_anticipo: { testo: "In anticipo", classe: "esito--anticipo" },
  in_ritardo: { testo: "In ritardo", classe: "esito--ritardo" },
  non_visibile: { testo: "Non visibile", classe: "esito--neutro" },
  da_verificare: { testo: "Da verificare", classe: "esito--verifica" },
};

function ConfrontoProgramma({ parte }: P<"confronto_programma">) {
  return (
    <div className="scheda scheda--bianca">
      <div className="scheda__testa scheda__testa--bordo">
        <span className="scheda__titolo">Confronto con il programma lavori</span>
        {parte.data_riferimento && <span className="scheda__conto">al {parte.data_riferimento}</span>}
      </div>
      {(parte.righe ?? []).map((r, i) => {
        const esito = ESITI[r.esito ?? ""];
        return (
          <div key={i} className={`confronto${r.esito === "in_ritardo" ? " confronto--ritardo" : ""}`}>
            <div className="confronto__testa">
              <span className="confronto__wbs">{r.wbs}</span>
              <span className="confronto__attivita">{r.attivita}</span>
              {esito && <span className={`pillola pillola--piccola esito ${esito.classe}`}>{esito.testo}</span>}
            </div>
            <dl className="confronto__colonne">
              <div>
                <dt>Previsto</dt>
                <dd>{r.previsto}</dd>
              </div>
              <div>
                <dt>Misurato NowVision</dt>
                <dd>{r.registrato}</dd>
              </div>
              <div>
                <dt>Dalle riprese</dt>
                <dd>{r.osservato}</dd>
              </div>
            </dl>
            {(r.voci_computo ?? []).length > 0 && (
              <div className="confronto__voci">
                <span className="etichetta-mono">Voci di computo</span>
                {r.voci_computo!.map((v) => (
                  <code key={v}>{v}</code>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Controlli({ parte }: P<"controlli">) {
  return (
    <div className="scheda scheda--bianca">
      <div className="scheda__testa scheda__testa--bordo scheda__testa--compatta">
        <span className="scheda__titolo scheda__titolo--piccolo">{parte.titolo || "Controlli"}</span>
      </div>
      {(parte.voci ?? []).map((v, i) => (
        <div key={i} className={`riga-controllo${v.esito === "attenzione" ? " riga-controllo--attenzione" : ""}`}>
          {v.esito === "attenzione" ? (
            <Icona nome="domanda" dimensione={16} tratto={2} colore="var(--nv-orange-ink)" />
          ) : (
            <Icona nome="spunta" dimensione={16} tratto={2} colore="var(--nv-mint-dark)" />
          )}
          <span>{v.testo}</span>
        </div>
      ))}
    </div>
  );
}

function DaDecidere({ parte }: P<"da_decidere">) {
  return (
    <div className="da-decidere">
      <span className="da-decidere__titolo">{parte.titolo || "Da decidere"}</span>
      {(parte.punti ?? []).map((p, i) => (
        <span key={i}>{p}</span>
      ))}
    </div>
  );
}

function RigheMisura({ parte }: P<"righe_misura">) {
  const valide = (parte.righe ?? []).filter((r) => Array.isArray(r.fattori) && r.fattori.length > 0);
  const { righe, totale } = calcolaMisure(
    valide.map((r) => ({
      descrizione: r.descrizione ?? "",
      fattori: (r.fattori ?? []).map(Number),
      deduzione: Boolean(r.deduzione),
    })),
  );
  return (
    <div className="misure">
      {righe.map((r, i) => (
        <div key={i} className={`misure__riga${r.deduzione ? " misure__riga--deduzione" : ""}`}>
          <span>
            {r.descrizione} · {r.fattori.map((f) => formatNumero(f)).join(" × ")}
          </span>
          <span>
            {r.deduzione ? "−" : ""}
            {formatNumero(r.quantita)}
          </span>
        </div>
      ))}
      <div className="misure__riga misure__riga--totale">
        <span>TOTALE</span>
        <span>
          {formatNumero(totale)} {parte.unita}
        </span>
      </div>
    </div>
  );
}

function SchedaDocumento({ parte, ctx, rif }: P<"documento"> & { rif?: RifDocumento }) {
  const d = parte.documento ?? {};
  const tipo = tipoDocumento(d.tipo_documento);
  const apre = rif ?? "in_scrittura";
  const aperto =
    ctx.documentoAperto !== null &&
    (ctx.documentoAperto === "in_scrittura"
      ? !rif
      : rif && ctx.documentoAperto.id === rif.id && ctx.documentoAperto.versione === rif.versione);
  const stato = rif ? `Documento · Bozza v${rif.versione}${aperto ? " · aperto" : ""}` : "Documento · in scrittura…";
  return (
    <button type="button" className="scheda-documento" onClick={() => ctx.onApriDocumento(apre)}>
      <span className={`scheda-documento__icona${tipo?.attenzione ? " scheda-documento__icona--attenzione" : ""}`}>
        <Icona
          nome={tipo?.attenzione ? "attenzione" : (tipo?.icona === "barre" ? "barre" : "documento")}
          dimensione={20}
          tratto={tipo?.attenzione ? 1.6 : 1.5}
          colore={tipo?.attenzione ? "var(--nv-orange-ink)" : "var(--nv-ink)"}
        />
      </span>
      <span className="scheda-documento__testo">
        <span className="scheda-documento__titolo">{d.titolo || tipo?.nome || "Bozza"}</span>
        <span className="etichetta-mono scheda-documento__stato">{stato}</span>
      </span>
    </button>
  );
}

function Azioni({ parte, ctx }: P<"azioni">) {
  return (
    <div className="azioni">
      {(parte.azioni ?? []).map((a, i) => (
        <button
          key={i}
          type="button"
          className={`btn${a.stile === "primario" ? " btn--primario" : a.stile === "suggerimento" ? " btn--suggerimento" : ""}`}
          disabled={!ctx.attiva || !a.testo}
          onClick={() => ctx.onAzione({ messaggio: a.messaggio || a.testo || "", modo: a.modo === "scrivi" ? "scrivi" : "invia" })}
        >
          {a.testo}
        </button>
      ))}
    </div>
  );
}

export function ParteView({
  parte,
  ctx,
  rif,
}: {
  parte: Parziale<Parte>;
  ctx: ContestoParti;
  rif?: RifDocumento;
}) {
  switch (parte.tipo) {
    case "testo":
      return parte.testo ? <TestoRicco testo={parte.testo} className="testo-redattore" /> : null;
    case "dati_raccolti":
      return <DatiRaccolti parte={parte} ctx={ctx} />;
    case "foto_osservate":
      return <FotoOsservate parte={parte} ctx={ctx} />;
    case "proposte_bozze":
      return <ProposteBozze parte={parte} ctx={ctx} />;
    case "confronto_programma":
      return <ConfrontoProgramma parte={parte} ctx={ctx} />;
    case "controlli":
      return <Controlli parte={parte} ctx={ctx} />;
    case "da_decidere":
      return <DaDecidere parte={parte} ctx={ctx} />;
    case "righe_misura":
      return <RigheMisura parte={parte} ctx={ctx} />;
    case "documento":
      return <SchedaDocumento parte={parte} ctx={ctx} rif={rif} />;
    case "azioni":
      return <Azioni parte={parte} ctx={ctx} />;
    default:
      return null;
  }
}

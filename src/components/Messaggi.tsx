// Messaggi della conversazione: quelli del DL a destra, quelli del Redattore con il marchio.

import { useState } from "react";
import type {
  Conversazione,
  FotoAllegata,
  Messaggio,
  MessaggioAssistente,
  MessaggioUtente,
  Parte,
  Parziale,
  RifDocumento,
} from "../../shared/schema";
import { api } from "../lib/api";
import { durata } from "../lib/dettatura";
import type { FaseTurno, TurnoInCorso } from "../lib/stato";
import { Icona, Marchio } from "./Icone";
import { ParteView, type Azione, type ContestoParti } from "./parti/Parti";
import "./messaggi.css";

type Segnalazioni = Map<string, string>;

/** Le foto segnalate dal Redattore (ristagni, parapetto…) prendono il bordo arancio. */
function segnalazioniFoto(parti: Parziale<Parte>[][]): Segnalazioni {
  const mappa: Segnalazioni = new Map();
  for (const elenco of parti) {
    for (const p of elenco) {
      if (p.tipo !== "foto_osservate") continue;
      for (const o of p.osservazioni ?? []) {
        if (!o.attenzione || !o.etichetta) continue;
        for (const f of o.foto ?? []) mappa.set(f, o.etichetta);
      }
    }
  }
  return mappa;
}

function Foto({ foto, segnalazioni }: { foto: FotoAllegata[]; segnalazioni: Segnalazioni }) {
  const griglia = foto.length >= 3;
  return (
    <div className={griglia ? "foto-griglia" : "foto-fila"}>
      {foto.map((f) => {
        const segnalazione = segnalazioni.get(f.etichetta);
        return (
          <a
            key={f.id}
            href={f.url}
            target="_blank"
            rel="noreferrer"
            className={`foto${segnalazione ? " foto--segnalata" : ""}`}
            aria-label={`${f.etichetta || "Foto"}${f.ripresa ? ` del ${f.ripresa.data}` : ""}${f.ora ? ` delle ${f.ora}` : ""}: ${f.nome}`}
          >
            <img src={f.url} alt="" loading="lazy" />
            {segnalazione && (
              <span className="foto__segnalazione">
                <span className="foto__punto" aria-hidden="true" />
                {segnalazione}
              </span>
            )}
            <span className="foto__etichetta">
              {f.etichetta || f.nome}
              {f.ripresa && ` · 360° · ${f.ripresa.data.slice(8, 10)}/${f.ripresa.data.slice(5, 7)}`}
              {f.ora && ` · ${f.ora}`}
            </span>
          </a>
        );
      })}
    </div>
  );
}

function MessaggioDelDL({ m, segnalazioni }: { m: MessaggioUtente; segnalazioni: Segnalazioni }) {
  return (
    <div className="msg-dl">
      {m.dettato && (
        <span className="msg-dl__dettato">
          <Icona nome="microfono" dimensione={12} tratto={2} />
          Dettato · {durata(m.dettato.secondi)}
        </span>
      )}
      {m.foto.length > 0 && <Foto foto={m.foto} segnalazioni={segnalazioni} />}
      {m.testo && <div className="bolla">{m.testo}</div>}
    </div>
  );
}

const FASI: Record<FaseTurno, string> = {
  attesa: "Sto leggendo",
  ragiona: "Sto ragionando",
  calcola: "Sto facendo i calcoli",
  scrive: "Sto scrivendo",
};

function Fase({ fase }: { fase: FaseTurno }) {
  return (
    <span className="fase" role="status">
      {FASI[fase]}
      <span className="fase__puntini" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}

function testoCopiabile(m: MessaggioAssistente): string {
  return m.parti
    .map((p) => {
      if (p.tipo === "testo") return p.testo;
      if (p.tipo === "documento") return `[${p.documento.titolo}]`;
      if (p.tipo === "da_decidere") return [p.titolo, ...p.punti.map((x) => `- ${x}`)].join("\n");
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function Strumenti({
  m,
  ultimo,
  onRigenera,
  onFeedback,
  onCopiato,
}: {
  onCopiato: () => void;
  m: MessaggioAssistente;
  ultimo: boolean;
  onRigenera: () => void;
  onFeedback: (valore: "utile" | "da_migliorare" | null) => void;
}) {
  const [copiato, setCopiato] = useState(false);
  return (
    <div className="strumenti">
      <button
        type="button"
        className="btn-icona strumenti__pulsante"
        aria-label={copiato ? "Copiato" : "Copia"}
        title={copiato ? "Copiato" : "Copia"}
        onClick={() => {
          void navigator.clipboard.writeText(testoCopiabile(m)).then(() => {
            onCopiato();
            setCopiato(true);
            window.setTimeout(() => setCopiato(false), 1500);
          });
        }}
      >
        <Icona nome={copiato ? "spunta" : "copia"} dimensione={16} />
      </button>
      {ultimo && (
        <button type="button" className="btn-icona strumenti__pulsante" aria-label="Rigenera" title="Rigenera" onClick={onRigenera}>
          <Icona nome="rigenera" dimensione={16} />
        </button>
      )}
      <button
        type="button"
        className="btn-icona strumenti__pulsante"
        aria-label="Risposta utile"
        aria-pressed={m.feedback === "utile"}
        onClick={() => onFeedback(m.feedback === "utile" ? null : "utile")}
      >
        <Icona nome="utile" dimensione={16} />
      </button>
      <button
        type="button"
        className="btn-icona strumenti__pulsante"
        aria-label="Risposta da migliorare"
        aria-pressed={m.feedback === "da_migliorare"}
        onClick={() => onFeedback(m.feedback === "da_migliorare" ? null : "da_migliorare")}
      >
        <Icona nome="daMigliorare" dimensione={16} />
      </button>
    </div>
  );
}

function RispostaDelRedattore({
  parti,
  ctx,
  children,
}: {
  parti: Parziale<Parte>[];
  ctx: ContestoParti;
  children?: React.ReactNode;
}) {
  return (
    <div className="msg-redattore">
      <Marchio lato={28} />
      <div className="msg-redattore__corpo">
        {parti.map((p, i) => (
          <ParteView key={i} parte={p} ctx={ctx} rif={(p as { rif?: RifDocumento }).rif} />
        ))}
        {children}
      </div>
    </div>
  );
}

interface Props {
  conversazione: Conversazione;
  inAttesa: MessaggioUtente | null;
  turno: TurnoInCorso | null;
  errore: string | null;
  documentoAperto: ContestoParti["documentoAperto"];
  onAzione: (a: Azione) => void;
  onApriDocumento: ContestoParti["onApriDocumento"];
  onRigenera: () => void;
  onFeedback: (messaggio: string, valore: "utile" | "da_migliorare" | null) => void;
}

export function Messaggi(p: Props) {
  const messaggi: Messaggio[] = p.conversazione.messaggi;
  const segnalazioni = segnalazioniFoto([
    ...messaggi.filter((m): m is MessaggioAssistente => m.ruolo === "assistente").map((m) => m.parti),
    p.turno?.parti ?? [],
  ]);
  const indiceUltimo = messaggi.length - 1;
  const ctxBase = {
    inScrittura: false,
    documentoAperto: p.documentoAperto,
    onAzione: p.onAzione,
    onApriDocumento: p.onApriDocumento,
  };

  return (
    <>
      {messaggi.map((m, i) =>
        m.ruolo === "utente" ? (
          <MessaggioDelDL key={m.id} m={m} segnalazioni={segnalazioni} />
        ) : (
          <RispostaDelRedattore
            key={m.id}
            parti={m.parti}
            ctx={{ ...ctxBase, attiva: i === indiceUltimo && !p.turno }}
          >
            {m.errore && (
              <div className="msg-errore" role="alert">
                <span>{m.errore}</span>
                {i === indiceUltimo && !p.turno && (
                  <button type="button" className="btn btn--piccolo" onClick={p.onRigenera}>
                    Riprova
                  </button>
                )}
              </div>
            )}
            {m.parti.length > 0 && (
              <Strumenti
                m={m}
                ultimo={i === indiceUltimo && !p.turno}
                onRigenera={p.onRigenera}
                onFeedback={(v) => p.onFeedback(m.id, v)}
                onCopiato={() => api.evento({ tipo: "copia", cosa: "risposta", conversazione: p.conversazione.id })}
              />
            )}
          </RispostaDelRedattore>
        ),
      )}
      {p.inAttesa && <MessaggioDelDL m={p.inAttesa} segnalazioni={segnalazioni} />}
      {p.turno && (
        <RispostaDelRedattore parti={p.turno.parti} ctx={{ ...ctxBase, attiva: false, inScrittura: true }}>
          {(p.turno.parti.length === 0 || p.turno.fase === "calcola") && <Fase fase={p.turno.fase} />}
        </RispostaDelRedattore>
      )}
      {p.errore && !p.turno && (
        <div className="msg-errore" role="alert">
          <span>{p.errore}</span>
        </div>
      )}
    </>
  );
}

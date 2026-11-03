// Conversazione con il Redattore e, a destra, la bozza aperta.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MODALITA_FOTO, nomeModalita, tipoDocumento } from "../../shared/documenti";
import type { Documento, FirmaApposta, Parziale, RifDocumento } from "../../shared/schema";
import type { StatoDocumento } from "../../shared/versioni";
import { dataCompleta } from "../lib/date";
import { useNowVision } from "../lib/nowvision";
import { infoCantiere } from "../lib/sessione";
import { documentiDi, type DocumentoConversazione } from "../lib/documenti";
import {
  impostaFeedback,
  interrompi,
  inviaMessaggio,
  rigenera,
  useConversazione,
} from "../lib/stato";
import { Composer, type ComposerHandle } from "./Composer";
import { PannelloDocumento } from "./documento/PannelloDocumento";
import { Icona } from "./Icone";
import { Messaggi } from "./Messaggi";
import type { Azione } from "./parti/Parti";
import { SceltaCantiere } from "./SceltaCantiere";
import { SceltaRiprese } from "./SceltaRiprese";

type Pannello = RifDocumento | "in_scrittura" | null;

interface Props {
  id: string;
  /** Versione da aprire subito nel pannello, da un link della pagina Documenti. */
  documentoIniziale?: RifDocumento | null;
  onApriMenu: () => void;
  onNuovo: () => void;
  onPannello: (aperto: boolean) => void;
}

export function VistaConversazione({ id, documentoIniziale, onApriMenu, onNuovo, onPannello }: Props) {
  const stato = useConversazione(id);
  const [pannello, setPannello] = useState<Pannello>(null);
  const [chiusoNelTurno, setChiusoNelTurno] = useState(false);
  const [condiviso, setCondiviso] = useState(false);
  const [ripreseAperte, setRipreseAperte] = useState(false);
  const scorrimento = useRef<HTMLDivElement>(null);
  const inFondo = useRef(true);
  const composer = useRef<ComposerHandle>(null);

  const conv = stato?.conversazione ?? null;
  const turno = stato?.turno ?? null;
  const nowvision = useNowVision(conv?.cantiereId ?? "");
  const documenti = useMemo(
    () => (conv ? documentiDi(conv) : new Map<string, DocumentoConversazione>()),
    [conv],
  );
  const partiTurno = turno?.parti ?? [];
  const documentoInScrittura = [...partiTurno].reverse().find((p) => p.tipo === "documento") as
    | { documento?: Parziale<Documento> }
    | undefined;

  // Cambiando conversazione si riparte dal pannello chiuso, o dalla versione richiesta nel link.
  useEffect(() => {
    setPannello(documentoIniziale ?? null);
    setChiusoNelTurno(false);
    inFondo.current = true;
  }, [id, documentoIniziale?.id, documentoIniziale?.versione]);

  // Il pannello si apre da solo quando il Redattore inizia a scrivere una bozza…
  useEffect(() => {
    if (documentoInScrittura && pannello !== "in_scrittura" && !chiusoNelTurno) setPannello("in_scrittura");
  }, [documentoInScrittura, pannello, chiusoNelTurno]);

  // …e a turno concluso mostra la versione appena salvata.
  const ultimo = conv?.messaggi.at(-1);
  useEffect(() => {
    if (turno) return;
    setChiusoNelTurno(false);
    if (pannello !== "in_scrittura") return;
    const rif =
      ultimo?.ruolo === "assistente"
        ? [...ultimo.parti].reverse().find((p) => p.tipo === "documento")?.rif
        : undefined;
    setPannello(rif ?? null);
  }, [turno, ultimo, pannello]);

  useEffect(() => onPannello(pannello !== null), [pannello, onPannello]);
  useEffect(() => () => onPannello(false), [onPannello]);

  // Segue lo streaming se il DL è già in fondo alla conversazione.
  useLayoutEffect(() => {
    const el = scorrimento.current;
    if (el && inFondo.current) el.scrollTop = el.scrollHeight;
  }, [conv?.messaggi.length, partiTurno, stato?.inAttesa, pannello]);

  if (!stato || (!conv && !stato.errore)) {
    return (
      <main className="vista">
        <div className="vista__vuota">
          <span className="fase">Carico il report…</span>
        </div>
      </main>
    );
  }
  if (!conv) {
    return (
      <main className="vista">
        <div className="vista__vuota">
          <p>{stato.errore}</p>
          <button type="button" className="btn" onClick={onNuovo}>
            Nuovo report
          </button>
        </div>
      </main>
    );
  }

  const c = infoCantiere(conv.cantiereId);
  const tipo = tipoDocumento(conv.modalita);
  const foto = conv.modalita === MODALITA_FOTO.id;
  const haDocumenti = documenti.size > 0;
  const segnaposto = haDocumenti
    ? "Chiedi una modifica: «aggiungi che il CSE era presente»"
    : foto
      ? MODALITA_FOTO.segnaposto
      : "Rispondi o aggiungi dettagli…";

  let documentoAperto: { documento: Parziale<Documento>; rif: RifDocumento | null } | null = null;
  let versioni: RifDocumento[] = [];
  let modifica;
  let firme: FirmaApposta[] = [];
  let statoVersione: StatoDocumento = "bozza";
  if (pannello === "in_scrittura") {
    if (documentoInScrittura?.documento) documentoAperto = { documento: documentoInScrittura.documento, rif: null };
  } else if (pannello) {
    const voce = documenti.get(pannello.id);
    const versione = voce?.versioni.find((v) => v.rif.versione === pannello.versione);
    if (voce && versione) {
      documentoAperto = { documento: versione.documento, rif: versione.rif };
      versioni = voce.versioni.map((v) => v.rif);
      modifica = versione.modifica;
      firme = versione.firme;
      statoVersione = versione.stato;
    }
  }

  function azione(a: Azione) {
    if (a.modo === "scrivi") composer.current?.scrivi(a.messaggio);
    else void inviaMessaggio(id, { testo: a.messaggio, foto: [], anteprime: [] });
  }

  async function condividi() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: conv!.titolo, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url);
    setCondiviso(true);
    window.setTimeout(() => setCondiviso(false), 1800);
  }

  const pillola = (
    <span className={`pillola${tipo?.attenzione ? " pillola--attenzione" : ""}`}>
      {tipo?.chip ?? nomeModalita(conv.modalita)}
    </span>
  );

  return (
    <div className="vista-conv">
      <main className={`vista conversazione${documentoAperto ? " conversazione--affiancata" : ""}`}>
        <header className="testata testata--bordo">
          <button type="button" className="btn-icona testata__menu" aria-label="Apri menu" onClick={onApriMenu}>
            <Icona nome="menu" dimensione={22} />
          </button>
          <div className="testata__contesto">
            {pillola}
            <span className="testata__titolo">
              {dataCompleta(conv.creataIl)} · {c.breve}
            </span>
          </div>
          {!documentoAperto && (
            <div className="testata__destra">
              <SceltaCantiere cantiereId={conv.cantiereId} breve />
              <button type="button" className="btn btn--condividi" onClick={() => void condividi()}>
                {condiviso ? "Link copiato" : "Condividi ↗"}
              </button>
            </div>
          )}
          <button type="button" className="btn-icona testata__nuovo" aria-label="Nuovo report" onClick={onNuovo}>
            <Icona nome="matita" dimensione={22} />
          </button>
        </header>

        <div
          className="conversazione__scorrimento"
          ref={scorrimento}
          onScroll={(e) => {
            const el = e.currentTarget;
            inFondo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          <div className={`conversazione__messaggi${foto ? " conversazione__messaggi--larga" : ""}`}>
            <Messaggi
              conversazione={conv}
              inAttesa={stato.inAttesa}
              turno={turno}
              errore={stato.errore}
              documentoAperto={pannello}
              onAzione={azione}
              onApriDocumento={(rif) => {
                setPannello(rif);
                setChiusoNelTurno(false);
              }}
              onRigenera={() => void rigenera(id)}
              onFeedback={(m, v) => void impostaFeedback(id, m, v)}
            />
          </div>
        </div>

        <div className={`conversazione__fondo${foto ? " conversazione__fondo--larga" : ""}`}>
          <Composer
            ref={composer}
            variante="compatto"
            modalita={conv.modalita}
            segnaposto={segnaposto}
            inCorso={Boolean(turno)}
            onInterrompi={() => interrompi(id)}
            onApriRiprese={nowvision.disponibile ? () => setRipreseAperte(true) : undefined}
            onInvia={(invio) => {
              inFondo.current = true;
              void inviaMessaggio(id, invio);
            }}
          />
          <p className="avvertenza avvertenza--fondo">
            Il Redattore DL prepara bozze · verifica e firma restano del Direttore dei Lavori
          </p>
        </div>
      </main>

      {documentoAperto && (
        <PannelloDocumento
          conversazioneId={id}
          documento={documentoAperto.documento}
          rif={documentoAperto.rif}
          versioni={versioni}
          modifica={modifica}
          firme={firme}
          stato={statoVersione}
          onVersione={setPannello}
          onChiudi={() => {
            if (turno) setChiusoNelTurno(true);
            setPannello(null);
          }}
        />
      )}
      {ripreseAperte && nowvision.sintesi && (
        <SceltaRiprese
          cantiereId={conv.cantiereId}
          sintesi={nowvision.sintesi}
          onAggiornata={nowvision.setSintesi}
          onChiudi={() => setRipreseAperte(false)}
          onUsa={(riprese) => {
            setRipreseAperte(false);
            composer.current?.allegaRiprese(riprese);
            composer.current?.focus();
          }}
        />
      )}
    </div>
  );
}

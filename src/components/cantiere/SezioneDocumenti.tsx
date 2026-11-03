// Documenti di progetto: una casella per tipo, caricamento con avanzamento, stato della
// lettura («cosa ho trovato»), nuova versione, rilettura ed eliminazione.

import { useRef, useState } from "react";
import {
  NOMI_DOCUMENTO_PROGETTO,
  type DocumentoProgetto,
  type SchedaCantiere,
  type TipoDocumentoProgetto,
} from "../../../shared/cantieri";
import { api, caricaDocumentoProgetto } from "../../lib/api";
import { impostaCantiere } from "../../lib/cantieri";
import { Icona } from "../Icone";
import { Menu, VoceMenu } from "../Menu";

const TIPI: { tipo: TipoDocumentoProgetto; aiuto: string; accetta: string; facoltativo?: boolean; multipli?: boolean }[] = [
  {
    tipo: "contratto",
    aiuto: "Contratto d'appalto, capitolato o lettera d'incarico in PDF: soggetti, importi, date, lavorazioni.",
    accetta: ".pdf,image/png,image/jpeg",
  },
  {
    tipo: "computo",
    aiuto: "Computo metrico estimativo: xlsx (anche l'export NowVision), csv o PDF.",
    accetta: ".xlsx,.csv,.pdf",
  },
  {
    tipo: "cronoprogramma",
    aiuto: "Programma dei lavori: xlsx (anche l'export NowVision), csv o PDF del Gantt.",
    accetta: ".xlsx,.csv,.pdf",
  },
  {
    tipo: "planimetria",
    aiuto: "Tavole di progetto in PDF o foto: servono a riconoscere unità, piani e parti comuni.",
    accetta: ".pdf,image/png,image/jpeg",
    multipli: true,
  },
  {
    tipo: "psc",
    aiuto: "PSC o notifica preliminare: imprese e coordinatori per la sicurezza.",
    accetta: ".pdf",
    facoltativo: true,
  },
  {
    tipo: "altro",
    aiuto: "Verbale di consegna, relazione tecnica o altro documento utile.",
    accetta: ".pdf,.xlsx,.csv,image/png,image/jpeg",
    facoltativo: true,
    multipli: true,
  },
];

/** Le immagini grandi si riducono prima dell'invio: l'API accetta immagini fino a circa 5 MB. */
async function riduciImmagine(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  const immagine = await createImageBitmap(file, { imageOrientation: "from-image" });
  const lato = Math.max(immagine.width, immagine.height);
  if (file.size < 4_500_000 && lato <= 6000) {
    immagine.close();
    return file;
  }
  const scala = Math.min(1, 3200 / lato);
  const tela = document.createElement("canvas");
  tela.width = Math.round(immagine.width * scala);
  tela.height = Math.round(immagine.height * scala);
  tela.getContext("2d")!.drawImage(immagine, 0, 0, tela.width, tela.height);
  immagine.close();
  return new Promise((risolvi, rifiuta) =>
    tela.toBlob((b) => (b ? risolvi(b) : rifiuta(new Error("Immagine non leggibile"))), "image/jpeg", 0.88),
  );
}

const peso = (byte: number) => (byte > 1_000_000 ? `${(byte / 1_000_000).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(byte / 1000))} kB`);

function testoStato(d: DocumentoProgetto): string {
  switch (d.stato) {
    case "in_coda":
      return "In coda per la lettura";
    case "in_lettura":
      return "Sto leggendo…";
    case "letto":
      return d.trovato || "Letto";
    case "errore":
      return d.errore || "Lettura non riuscita";
  }
}

function RigaDocumento({ s, d, onSostituisci }: { s: SchedaCantiere; d: DocumentoProgetto; onSostituisci: (f: FileList) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const occupato = d.stato === "in_coda" || d.stato === "in_lettura";
  const azione = (lavoro: () => Promise<SchedaCantiere>) =>
    lavoro().then(impostaCantiere, (e: Error) => setErrore(e.message));
  return (
    <li className={`documento-progetto documento-progetto--${d.stato}`}>
      <span className="documento-progetto__icona" aria-hidden="true">
        <Icona nome={d.mediaType.startsWith("image/") ? "immagine" : d.file.endsWith(".pdf") ? "documento" : "righe"} dimensione={18} />
      </span>
      <span className="documento-progetto__testo">
        <a href={`/api/cantieri/${s.id}/documenti/${d.id}/file`} target="_blank" rel="noreferrer" className="documento-progetto__nome">
          {d.nome}
        </a>
        <span className="documento-progetto__dettagli">
          {[d.pagine ? `${d.pagine} pagine` : "", peso(d.byte), d.costo ? `lettura ${d.costo.toFixed(2).replace(".", ",")} $` : ""]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="documento-progetto__stato" role={d.stato === "errore" ? "alert" : undefined}>
          {occupato && <span className="documento-progetto__punto" aria-hidden="true" />}
          {testoStato(d)}
        </span>
        {d.differenze && d.differenze.length > 0 && (
          <span className="documento-progetto__differenze">
            Rispetto alla versione precedente: {d.differenze.join("; ")}. Ricontrolla questi dati nella revisione.
          </span>
        )}
        {errore && <span className="documento-progetto__stato">{errore}</span>}
      </span>
      <Menu className="btn-icona" ariaLabel={`Azioni su ${d.nome}`} allinea="destra" larghezza={260} disabled={occupato} contenuto={<Icona nome="altro" dimensione={18} />}>
        {(chiudi) => (
          <>
            <VoceMenu
              onClick={() => {
                chiudi();
                file.current?.click();
              }}
            >
              <Icona nome="rigenera" dimensione={16} />
              Carica una nuova versione
            </VoceMenu>
            {d.stato === "errore" && (
              <VoceMenu
                onClick={() => {
                  chiudi();
                  void azione(() => api.rileggiDocumento(s.id, d.id));
                }}
              >
                <Icona nome="rigenera" dimensione={16} />
                Riprova la lettura
              </VoceMenu>
            )}
            <VoceMenu
              onClick={() => {
                chiudi();
                if (window.confirm(`Togliere «${d.nome}»? I dati che ne venivano restano nella scheda finché non li correggi.`)) {
                  void azione(() => api.eliminaDocumentoProgetto(s.id, d.id));
                }
              }}
            >
              <Icona nome="chiudi" dimensione={16} />
              Togli il documento
            </VoceMenu>
          </>
        )}
      </Menu>
      <input
        ref={file}
        type="file"
        hidden
        accept={TIPI.find((t) => t.tipo === d.tipo)?.accetta}
        onChange={(e) => {
          if (e.target.files?.length) onSostituisci(e.target.files);
          e.target.value = "";
        }}
      />
    </li>
  );
}

export function SezioneDocumenti({ s }: { s: SchedaCantiere }) {
  const [caricamenti, setCaricamenti] = useState<Record<string, { tipo: string; nome: string; frazione: number; errore?: string }>>({});

  async function carica(tipo: TipoDocumentoProgetto, files: FileList, sostituisce?: string) {
    for (const f of Array.from(files)) {
      const chiave = `${tipo}:${f.name}:${Math.random().toString(36).slice(2)}`;
      const aggiorna = (v: { frazione: number; errore?: string } | null) =>
        setCaricamenti((c) => {
          const copia = { ...c };
          if (v) copia[chiave] = { tipo, nome: f.name, ...v };
          else delete copia[chiave];
          return copia;
        });
      aggiorna({ frazione: 0 });
      try {
        const blob = await riduciImmagine(f);
        const nuova = await caricaDocumentoProgetto(s.id, tipo, blob, f.name, (x) => aggiorna({ frazione: x }), sostituisce);
        impostaCantiere(nuova);
        aggiorna(null);
      } catch (e) {
        aggiorna({ frazione: 1, errore: (e as Error).message });
      }
    }
  }

  const inLettura = s.documenti.filter((d) => d.stato === "in_coda" || d.stato === "in_lettura").length;

  return (
    <section className="cantiere__sezione" aria-labelledby="titolo-documenti">
      <div className="cantiere__sezione-testa">
        <h2 id="titolo-documenti" className="cantiere__sottotitolo">
          Documenti di progetto
        </h2>
        {inLettura > 0 && (
          <span className="pillola pillola--neutra" role="status">
            {inLettura === 1 ? "1 documento in lettura" : `${inLettura} documenti in lettura`}
          </span>
        )}
      </div>
      <p className="cantiere__nota">
        Carica quello che hai: li leggo io e ti propongo soggetti, importi, programma e zone da controllare. La lettura continua
        sul server, puoi anche chiudere la pagina.
      </p>
      {TIPI.map((t) => {
        const documenti = s.documenti.filter((d) => d.tipo === t.tipo);
        const inCaricamento = Object.entries(caricamenti).filter(([, c]) => c.tipo === t.tipo);
        return (
          <div key={t.tipo} className="cantiere__tipo">
            <div className="cantiere__tipo-testa">
              <span className="cantiere__tipo-nome">
                <strong>{NOMI_DOCUMENTO_PROGETTO[t.tipo]}</strong>
                {t.facoltativo && <span className="etichetta-mono"> · facoltativo</span>}
              </span>
              <label className="btn btn--piccolo">
                <Icona nome="piu" dimensione={15} />
                {documenti.length && !t.multipli ? "Aggiungi" : "Carica"}
                <input
                  type="file"
                  hidden
                  multiple={t.multipli}
                  accept={t.accetta}
                  onChange={(e) => {
                    if (e.target.files?.length) void carica(t.tipo, e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {documenti.length === 0 && inCaricamento.length === 0 && <p className="cantiere__aiuto">{t.aiuto}</p>}
            {(documenti.length > 0 || inCaricamento.length > 0) && (
              <ul className="cantiere__documenti">
                {documenti.map((d) => (
                  <RigaDocumento key={d.id} s={s} d={d} onSostituisci={(f) => void carica(d.tipo, f, d.id)} />
                ))}
                {inCaricamento.map(([chiave, c]) => (
                  <li key={chiave} className={`documento-progetto${c.errore ? " documento-progetto--errore" : ""}`}>
                    <span className="documento-progetto__icona" aria-hidden="true">
                      <Icona nome="scarica" dimensione={18} />
                    </span>
                    <span className="documento-progetto__testo">
                      <span className="documento-progetto__nome">{c.nome}</span>
                      {c.errore ? (
                        <span className="documento-progetto__stato" role="alert">
                          {c.errore}
                        </span>
                      ) : (
                        <span className="documento-progetto__barra" role="progressbar" aria-valuenow={Math.round(c.frazione * 100)} aria-valuemin={0} aria-valuemax={100}>
                          <span style={{ width: `${Math.round(c.frazione * 100)}%` }} />
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

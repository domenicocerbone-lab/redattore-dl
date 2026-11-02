// Il documento come foglio: intestazione, dati generali, sezioni e firme.
// Accetta anche un documento parziale, mentre il Redattore lo sta scrivendo.

import type { Blocco, Documento, Parziale } from "../../../shared/schema";
import { Inline } from "../TestoRicco";
import "./documento.css";

type Doc = Parziale<Documento>;

/** Distribuisce i campi su righe: l'ultimo campo di una riga incompleta si allarga. */
function campiInRighe<T extends { intera_riga?: boolean }>(campi: T[], colonne: number) {
  const celle: { campo: T; span: number }[] = [];
  let occupate = 0;
  const chiudiRiga = () => {
    if (occupate > 0 && celle.length) celle[celle.length - 1].span += colonne - occupate;
    occupate = 0;
  };
  for (const campo of campi) {
    const span = campo.intera_riga ? colonne : 1;
    if (occupate + span > colonne) chiudiRiga();
    celle.push({ campo, span });
    occupate += span;
    if (occupate === colonne) occupate = 0;
  }
  chiudiRiga();
  return celle;
}

function GrigliaCampi({
  campi,
  colonne,
  tratteggiata,
}: {
  campi: { etichetta?: string; valore?: string; intera_riga?: boolean }[];
  colonne: number;
  tratteggiata?: boolean;
}) {
  const n = colonne === 3 ? 3 : 2;
  return (
    <div className={`doc-griglia${tratteggiata ? " doc-griglia--tratteggiata" : ""}`}>
      <div className="doc-griglia__interno" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {campiInRighe(campi, n).map(({ campo, span }, i) => (
          <div key={i} className="doc-griglia__cella" style={{ gridColumn: `span ${span}` }}>
            <div className="doc-etichetta">{campo.etichetta}</div>
            {campo.valore ? <Inline testo={campo.valore} /> : "—"}
          </div>
        ))}
      </div>
    </div>
  );
}

function Cella({ testo, destra, codice }: { testo: string; destra: boolean; codice: boolean }) {
  const evidenziata = testo.startsWith("!");
  return (
    <td className={`${destra ? "a-destra" : ""}${codice ? " codice" : ""}${evidenziata ? " doc-fuori-norma" : ""}`}>
      <Inline testo={evidenziata ? testo.slice(1) : testo} />
    </td>
  );
}

function Tabella({ b }: { b: Parziale<Extract<Blocco, { tipo: "tabella" }>> }) {
  const intestazione = b.intestazione ?? [];
  const righe = (b.righe ?? []).filter(Array.isArray);
  const colonne = Math.max(intestazione.length, ...righe.map((r) => r.length), 1);
  const destra = (i: number) => b.allineamento?.[i] === "destra";
  const totale = b.totale ?? [];
  // Le celle vuote dopo la prima si uniscono all'etichetta del totale.
  const ultimaPiena = totale.reduce((u, c, i) => (c && i > 0 ? i : u), 0);
  const larga = colonne >= 5;
  // Tariffe e codici di voce in monospazio, come nel SAL del design.
  const codice = (i: number) => /^(tariffa|codice|art\.?)$/i.test(intestazione[i] ?? "");
  return (
    <div className={`doc-tabella${larga ? " doc-tabella--fitta" : ""}`}>
      <table style={{ minWidth: larga ? 640 : undefined }}>
        {intestazione.length > 0 && (
          <thead>
            <tr>
              {intestazione.map((t, i) => (
                <th key={i} className={destra(i) ? "a-destra" : ""}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {righe.map((r, i) => (
            <tr key={i}>
              {Array.from({ length: colonne }, (_, j) => (
                <Cella key={j} testo={r[j] ?? ""} destra={destra(j)} codice={codice(j)} />
              ))}
            </tr>
          ))}
          {totale.length > 0 && (
            <tr className="doc-tabella__totale">
              <td colSpan={Math.max(1, ultimaPiena === 0 ? colonne : ultimaPiena)}>
                <Inline testo={totale[0] ?? ""} />
              </td>
              {ultimaPiena > 0 &&
                totale.slice(ultimaPiena).map((c, j) => (
                  <td key={j} className={destra(ultimaPiena + j) ? "a-destra" : ""}>
                    {c}
                  </td>
                ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function BloccoView({ b }: { b: Parziale<Blocco> }) {
  switch (b.tipo) {
    case "paragrafo":
      return (
        <p className="doc-paragrafo">
          <Inline testo={b.testo ?? ""} />
        </p>
      );
    case "elenco": {
      const Lista = b.numerato ? "ol" : "ul";
      return (
        <Lista className="doc-elenco">
          {(b.voci ?? []).map((v, i) => (
            <li key={i}>
              <Inline testo={v} />
            </li>
          ))}
        </Lista>
      );
    }
    case "tabella":
      return <Tabella b={b} />;
    case "riepilogo":
      return (
        <div className="doc-riepilogo-blocco">
          <div className="doc-riepilogo">
            {(b.righe ?? []).map((r, i) => (
              <div key={i} className={`doc-riepilogo__riga doc-riepilogo__riga--${r.stile ?? "normale"}`}>
                <span>
                  <Inline testo={r.etichetta ?? ""} />
                </span>
                <span>
                  <Inline testo={r.valore ?? ""} />
                </span>
              </div>
            ))}
          </div>
          {b.nota && <span className="doc-nota">{b.nota}</span>}
        </div>
      );
    case "campi":
      return <GrigliaCampi campi={b.campi ?? []} colonne={b.colonne ?? 2} tratteggiata={b.da_compilare} />;
    default:
      return null;
  }
}

export function DocumentoView({ documento, html }: { documento: Doc; html?: string }) {
  if (html !== undefined) {
    // Versione modificata a mano dal DL.
    return <article className="doc" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  const d = documento;
  const firme = d.firme ?? [];
  const larghezza = d.tipo_documento === "sal" ? 780 : d.tipo_documento === "giornale_lavori" ? 680 : 720;
  return (
    <article className="doc" style={{ maxWidth: larghezza }}>
      {(d.intestazione?.sinistra || d.intestazione?.destra) && (
        <div className="doc-intestazione">
          <span>{d.intestazione?.sinistra}</span>
          <span>{d.intestazione?.destra}</span>
        </div>
      )}
      <div className="doc-titolo">
        <div className="doc-titolo__testo">
          <h2>{d.titolo}</h2>
          {d.sottotitolo && <span className="doc-sottotitolo">{d.sottotitolo}</span>}
        </div>
        {(d.stati ?? []).length > 0 && (
          <div className="doc-stati">
            {d.stati!.map((s, i) => (
              <span key={i} className={`pillola ${s.stile === "bordo" ? "pillola--bordo" : "pillola--attenzione"}`}>
                {s.testo}
              </span>
            ))}
          </div>
        )}
      </div>

      {(d.dati_generali?.campi ?? []).length > 0 && (
        <GrigliaCampi campi={d.dati_generali!.campi!} colonne={d.dati_generali!.colonne ?? 2} />
      )}

      {(d.sezioni ?? []).map((s, i) => (
        <section key={i} className="doc-sezione">
          {s.titolo && <h3>{s.titolo}</h3>}
          {(s.blocchi ?? []).map((b, j) => (
            <BloccoView key={j} b={b} />
          ))}
        </section>
      ))}

      {d.formula_chiusura && <p className="doc-chiusura">{d.formula_chiusura}</p>}

      {firme.length > 0 && (
        <div
          className="doc-firme"
          style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(firme.length, 2), 3)}, minmax(0, 1fr))` }}
        >
          {firme.map((f, i) => (
            <div key={i} className="doc-firma">
              <span className="doc-etichetta">{f.ruolo}</span>
              <span className="doc-firma__nome">{f.nome}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

// Testo del Redattore con la poca formattazione che usa: paragrafi, elenchi,
// **grassetto** e i segnaposto «[da completare]» evidenziati.

import { Fragment, type ReactNode } from "react";

const SEGNAPOSTO = /(\[da completare\])/gi;

export function Inline({ testo }: { testo: string }) {
  const pezzi = testo.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {pezzi.map((pezzo, i) => {
        if (pezzo.startsWith("**") && pezzo.endsWith("**") && pezzo.length > 4) {
          return (
            <b key={i} style={{ fontWeight: 500 }}>
              <Segnaposto testo={pezzo.slice(2, -2)} />
            </b>
          );
        }
        return <Segnaposto key={i} testo={pezzo} />;
      })}
    </>
  );
}

function Segnaposto({ testo }: { testo: string }) {
  return (
    <>
      {testo.split(SEGNAPOSTO).map((pezzo, i) =>
        i % 2 === 1 ? (
          <span key={i} className="segnaposto">
            {pezzo}
          </span>
        ) : (
          <Fragment key={i}>{pezzo}</Fragment>
        ),
      )}
    </>
  );
}

type Blocco = { tipo: "p"; righe: string[] } | { tipo: "ol" | "ul"; voci: string[] };

function blocchi(testo: string): Blocco[] {
  const risultato: Blocco[] = [];
  for (const riga of testo.split("\n")) {
    const numerata = /^\s*\d+[.)]\s+(.*)$/.exec(riga);
    const puntata = /^\s*[-•*]\s+(.*)$/.exec(riga);
    const ultimo = risultato.at(-1);
    if (numerata || puntata) {
      const tipo = numerata ? "ol" : "ul";
      const voce = (numerata ?? puntata)![1];
      if (ultimo && ultimo.tipo === tipo) ultimo.voci.push(voce);
      else risultato.push({ tipo, voci: [voce] });
    } else if (riga.trim() === "") {
      if (ultimo?.tipo === "p") risultato.push({ tipo: "p", righe: [] });
    } else if (ultimo?.tipo === "p") {
      ultimo.righe.push(riga);
    } else {
      risultato.push({ tipo: "p", righe: [riga] });
    }
  }
  return risultato.filter((b) => (b.tipo === "p" ? b.righe.length > 0 : b.voci.length > 0));
}

export function TestoRicco({ testo, className }: { testo: string; className?: string }) {
  const contenuto: ReactNode[] = blocchi(testo).map((b, i) => {
    if (b.tipo === "p") {
      return (
        <p key={i} style={{ margin: 0 }}>
          {b.righe.map((r, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              <Inline testo={r} />
            </Fragment>
          ))}
        </p>
      );
    }
    const Lista = b.tipo;
    return (
      <Lista key={i} style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 4 }}>
        {b.voci.map((v, j) => (
          <li key={j}>
            <Inline testo={v} />
          </li>
        ))}
      </Lista>
    );
  });
  return <div className={className}>{contenuto}</div>;
}

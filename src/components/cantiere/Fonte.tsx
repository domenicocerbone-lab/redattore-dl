// Da dove viene un valore estratto: documento e pagina, e «da verificare» se dedotto.

import type { DocumentoProgetto, Fonte } from "../../../shared/cantieri";

const BREVI: Record<string, string> = {
  contratto: "Contratto",
  computo: "Computo",
  cronoprogramma: "Programma",
  planimetria: "Pianta",
  psc: "PSC",
};

export function ChipFonte({ fonte, documenti }: { fonte?: Fonte; documenti: DocumentoProgetto[] }) {
  if (!fonte) return null;
  const d = documenti.find((x) => x.id === fonte.documento);
  const nome = d ? (BREVI[d.tipo] ?? (d.nome.length > 18 ? `${d.nome.slice(0, 17)}…` : d.nome)) : "documento";
  const dedotto = fonte.certezza === "dedotto";
  return (
    <span
      className={`chip-fonte${dedotto ? " chip-fonte--dedotto" : ""}`}
      title={`${dedotto ? "Dedotto, non scritto alla lettera: " : "Letto in "}${d?.nome ?? "un documento"}${fonte.pagina ? `, pagina ${fonte.pagina}` : ""}`}
    >
      {dedotto && "da verificare · "}
      {nome}
      {fonte.pagina ? ` p. ${fonte.pagina}` : ""}
    </span>
  );
}

/** Un valore corretto a mano non è più «dedotto»: la fonte resta, ma conta come verificata. */
export const verificata = (f?: Fonte): Fonte | undefined => (f ? { ...f, certezza: "letto" } : undefined);

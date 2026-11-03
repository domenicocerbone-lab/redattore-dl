// Documenti e versioni di una conversazione, con il loro stato: bozza, definitivo o firmato.
// Usato dall'interfaccia (pannello, pagina Documenti) e dal server (PDF, archivio).

import {
  chiaveVersione,
  type Conversazione,
  type Documento,
  type FirmaApposta,
  type ModificaManuale,
  type RifDocumento,
} from "./schema";

export type StatoDocumento = "bozza" | "definitivo" | "firmato";

export interface VersioneDocumento {
  rif: RifDocumento;
  documento: Documento;
  modifica?: ModificaManuale;
  firme: FirmaApposta[];
  stato: StatoDocumento;
  /** Quando la versione è nata o è cambiata l'ultima volta (modifica, firma, stato). */
  aggiornataIl: string;
}

export interface DocumentoConversazione {
  id: string;
  titolo: string;
  versioni: VersioneDocumento[];
}

export function statoVersione(c: Conversazione, rif: RifDocumento): StatoDocumento {
  const chiave = chiaveVersione(rif);
  if (c.firme?.[chiave]?.length) return "firmato";
  if (c.statiDocumento?.[chiave]) return "definitivo";
  return "bozza";
}

const piuRecente = (...date: (string | undefined)[]) =>
  date.filter((d): d is string => Boolean(d)).sort().at(-1) ?? "";

export function documentiDi(c: Conversazione): Map<string, DocumentoConversazione> {
  const documenti = new Map<string, DocumentoConversazione>();
  for (const m of c.messaggi) {
    if (m.ruolo !== "assistente") continue;
    for (const p of m.parti) {
      if (p.tipo !== "documento" || !p.rif) continue;
      const chiave = chiaveVersione(p.rif);
      const voce = documenti.get(p.rif.id) ?? { id: p.rif.id, titolo: p.documento.titolo, versioni: [] };
      const firme = c.firme?.[chiave] ?? [];
      const modifica = c.modificheManuali[chiave];
      voce.titolo = p.documento.titolo;
      voce.versioni.push({
        rif: p.rif,
        documento: p.documento,
        modifica,
        firme,
        stato: statoVersione(c, p.rif),
        aggiornataIl: piuRecente(m.creatoIl, modifica?.il, ...firme.map((f) => f.il), c.statiDocumento?.[chiave]?.il),
      });
      documenti.set(p.rif.id, voce);
    }
  }
  return documenti;
}

export function trovaVersione(c: Conversazione, id: string, versione: number): VersioneDocumento | undefined {
  return documentiDi(c)
    .get(id)
    ?.versioni.find((v) => v.rif.versione === versione);
}

/** Una riga della pagina Documenti: il documento con la sua ultima versione. */
export interface VoceArchivio {
  conversazione: string;
  id: string;
  titolo: string;
  tipo: string;
  cantiereId: string;
  versione: number;
  versioni: number;
  aggiornatoIl: string;
  stato: StatoDocumento;
  /** Se l'ultima versione è una bozza ma una precedente è già ultimata. */
  precedenteUltimata?: { versione: number; stato: Exclude<StatoDocumento, "bozza"> };
  firmatoDa: string[];
  modificata: boolean;
  /** Nome di chi l'ha scritto: solo nella vista dell'amministratore. */
  persona?: string;
}

export function vociArchivio(c: Conversazione): VoceArchivio[] {
  return [...documentiDi(c).values()].map((d) => {
    const ultima = d.versioni.at(-1)!;
    const precedente = ultima.stato === "bozza" ? d.versioni.slice(0, -1).reverse().find((v) => v.stato !== "bozza") : undefined;
    return {
      conversazione: c.id,
      id: d.id,
      titolo: d.titolo,
      tipo: ultima.documento.tipo_documento,
      cantiereId: c.cantiereId,
      versione: ultima.rif.versione,
      versioni: d.versioni.length,
      aggiornatoIl: ultima.aggiornataIl,
      stato: ultima.stato,
      ...(precedente
        ? { precedenteUltimata: { versione: precedente.rif.versione, stato: precedente.stato as Exclude<StatoDocumento, "bozza"> } }
        : {}),
      firmatoDa: ultima.firme.map((f) => f.nome),
      modificata: Boolean(ultima.modifica),
    };
  });
}

/** Link che apre la conversazione con il pannello già su quella versione. */
export const linkDocumento = (v: { conversazione: string; id: string; versione: number }) =>
  `#/c/${v.conversazione}/d/${v.id}/${v.versione}`;

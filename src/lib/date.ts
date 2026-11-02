// Date in italiano per intestazioni e cronologia.

import type { ConversazioneMeta } from "../../shared/schema";

const giorno = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const UN_GIORNO = 86_400_000;

export function dataCompleta(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function quando(iso: string): string {
  const d = new Date(iso);
  const differenza = (giorno(new Date()) - giorno(d)) / UN_GIORNO;
  const ora = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  if (differenza === 0) return `oggi alle ${ora}`;
  if (differenza === 1) return `ieri alle ${ora}`;
  return `il ${d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })} alle ${ora}`;
}

export function raggruppaPerData(elenco: ConversazioneMeta[]) {
  const oggi = giorno(new Date());
  const gruppi: { titolo: string; voci: ConversazioneMeta[] }[] = [
    { titolo: "Oggi", voci: [] },
    { titolo: "Ieri", voci: [] },
    { titolo: "Ultimi 7 giorni", voci: [] },
    { titolo: "Precedenti", voci: [] },
  ];
  for (const c of elenco) {
    const giorni = (oggi - giorno(new Date(c.aggiornataIl))) / UN_GIORNO;
    gruppi[giorni <= 0 ? 0 : giorni === 1 ? 1 : giorni <= 7 ? 2 : 3].voci.push(c);
  }
  return gruppi.filter((g) => g.voci.length > 0);
}

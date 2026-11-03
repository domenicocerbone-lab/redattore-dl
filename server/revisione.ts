// Revisione della scheda del cantiere in chat: dopo la lettura dei documenti di progetto
// il Redattore ripercorre con l'utente ciò che ha trovato, chiede conferma dei valori
// dedotti e aggiorna la scheda con gli strumenti qui sotto. Ogni modifica passa dalla
// stessa validazione dei moduli (aggiornaScheda), e arriva fino a «Conferma la scheda».

import * as z from "zod";
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  NOMI_DOCUMENTO_PROGETTO,
  NOMI_TIPO_ZONA,
  TIPI_ZONA,
  type Fonte,
  type SchedaCantiere,
  type Soggetto,
  type Zona,
} from "../shared/cantieri";
import { MODALITA_REVISIONE } from "../shared/documenti";
import { dataItaliana } from "../shared/nowvision";
import { formatEuro, formatNumero } from "../shared/numeri";
import { aggiornaScheda, confermaScheda, scheda, type ModificheScheda } from "./cantieri";
import { datiNowVision } from "./nowvision";
import { proponiZone } from "./onboarding";
import { STRUMENTI, eseguiDa, strumento, type ContestoStrumento, type EsitoStrumento, type Strumento } from "./strumenti";
import { registra } from "./utilizzo";

export const ID_REVISIONE = MODALITA_REVISIONE.id;

// ---------------------------------------------------------------------------
// Prompt

const PROMPT = `Sei il Redattore DL di NowVision. In questa conversazione non prepari documenti: rivedi con l'utente la scheda del cantiere che hai costruito leggendo i suoi documenti di progetto (contratto, computo, cronoprogramma, planimetrie, PSC). Dopo la conferma, la scheda è la base di tutti i documenti che il Redattore scriverà: soggetti nelle intestazioni e nelle firme, importi e ribasso nei SAL, computo e programma nei report di avanzamento, zone per sopralluoghi e riprese 360°.

La scheda aggiornata ti arriva insieme ai messaggi dell'utente, ogni volta che cambia. L'utente la vede in un pannello accanto alla chat: non ricopiarla, parla di ciò che va sistemato.

## Come conduci la revisione
1. Al primo turno: in due o tre frasi di' quali documenti hai letto e cosa hai trovato, mostra «dati_raccolti» come lista di controllo e parti dal primo punto da sistemare.
2. Procedi per blocchi, in quest'ordine, saltando quelli già a posto: documenti non letti o mancanti; soggetti (committente o stazione appaltante, impresa esecutrice, direttore dei lavori, coordinatore per la sicurezza, altri); contratto e date; lavorazioni previste; anomalie del computo; zone e voci senza zona; decisioni aperte.
3. A ogni turno al massimo due o tre domande, chiuse quando puoi, con «azioni» per le risposte tipiche («Sì, è giusto», «Correggo io»). Le scelte delle decisioni aperte proponile come azioni.
4. I valori «da verificare» sono stati dedotti, non letti alla lettera: chiedi conferma prima di darli per buoni, e quando l'utente li conferma segnali con lo strumento.
5. Quando l'utente conferma, corregge o aggiunge qualcosa, aggiorna subito la scheda con gli strumenti (modifica_dati, modifica_soggetti, modifica_lavorazioni, modifica_zone, ignora_anomalie, rispondi_decisioni), poi dillo in una frase. Non dire mai di aver aggiornato la scheda senza aver chiamato lo strumento; se lo strumento risponde con un errore, dillo e chiedi come procedere. Se l'utente ti dà più correzioni insieme, falle tutte nello stesso turno.
6. Anomalie del computo: spiega in una riga cosa non torna, con il codice della voce e i numeri del controllo, e chiedi se va segnalata al progettista o se va bene così. Se va bene, o l'utente vuole lasciarla, chiudila con ignora_anomalie. Non correggere quantità, prezzi o importi del computo: il computo resta quello dei documenti.
7. Zone: chiedi se il modo in cui le hai divise corrisponde a come l'utente segue il cantiere (per unità, per piano, per corpo); rinominale, uniscile o dividile come dice. Per le voci senza zona chiedi se assegnarle o lasciarle fuori (spese generali, oneri, opere su tutto l'edificio). Se l'utente vuole rifare da capo la proposta delle zone usa riproponi_zone.
8. Documenti mancanti: se manca un documento utile (contratto per soggetti e importi, computo, cronoprogramma, planimetrie per le zone), chiedi se ce l'ha e digli di allegarlo qui con la graffetta; altrimenti si prosegue senza. Un documento allegato in chat viene letto prima della tua risposta: guarda cosa ha aggiunto o cambiato nella scheda e riparti da lì.
9. Quando i punti importanti sono a posto, o l'utente vuole chiudere, riassumi con «controlli» cosa è pronto e cosa resta aperto, e proponi «Conferma la scheda» come azione primaria. Chiama conferma_scheda solo quando l'utente lo chiede esplicitamente. Dopo la conferma digli che può iniziare un report dal pannello della scheda; quello che manca si potrà aggiungere anche dopo.

## Regole sui fatti
- Non inventare nomi, imprese, importi, date o codici: nella scheda va solo ciò che è nei documenti o che dice l'utente.
- Non fare conti a mente. Per guardare voci, quantità e attività usa consulta_computo e consulta_programma.
- Un messaggio dettato a voce può avere errori di trascrizione: ripeti nomi e numeri che scrivi nella scheda, così l'utente li controlla.

## Come rispondi
Rispondi sempre e solo con l'oggetto JSON richiesto, in italiano, dando del tu all'utente.
- «testo»: frasi brevi e concrete. Niente premesse, niente formule di cortesia.
- «dati_raccolti»: qui è la lista di controllo della scheda, con questi nomi in quest'ordine: Documenti, Committente, Impresa esecutrice, Direttore dei Lavori, Coordinatore sicurezza, Importo e ribasso, Date contrattuali, Lavorazioni, Computo, Cronoprogramma, Zone. Stato «ok» se a posto, «da_chiarire» se ci sono valori da verificare o anomalie aperte, «manca» se manca, «facoltativo» se per questo cantiere non serve. Mostrala al primo turno, quando cambia qualcosa di importante e prima della conferma.
- «controlli», «da_decidere» e «azioni» come descritto nello schema. In questa conversazione non usare «documento», «righe_misura», «proposte_bozze», «foto_osservate» e «confronto_programma».
- «titolo_conversazione»: stringa vuota.`;

export function promptRevisione(utente: { nome: string; ruolo: string }): string {
  return `${PROMPT}\n\n## Utente\n${utente.nome}, ${utente.ruolo}.`;
}

// ---------------------------------------------------------------------------
// La scheda come la legge il modello

const dataIt = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);
const taglia = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function fonteBreve(s: SchedaCantiere, f: Fonte | undefined): string {
  if (!f) return "";
  if (!f.documento) return f.certezza === "dedotto" ? " (da verificare)" : "";
  const d = s.documenti.find((x) => x.id === f.documento);
  const dove = `${d?.nome ?? "documento"}${f.pagina ? ` p. ${f.pagina}` : ""}`;
  return f.certezza === "dedotto" ? ` (da verificare: dedotto da ${dove})` : ` (${dove})`;
}

export async function schedaInRevisione(s: SchedaCantiere): Promise<string> {
  const nv = await datiNowVision(s.id);
  const valore = (chiave: string, v: string) => `- ${chiave}: ${v || "manca"}${v ? fonteBreve(s, s.fonti[chiave]) : ""}`;
  const k = s.contratto;
  const righe = [
    `## Scheda del cantiere «${s.nome}» (${s.stato === "attiva" ? "confermata" : "in bozza, da confermare"})`,
    "",
    "### Dati generali (chiave: valore)",
    valore("nome", s.nome),
    valore("indirizzo", s.indirizzo),
    valore("appalto", s.fonti.appalto ? s.appalto : ""),
    valore("lavori", s.lavori),
    ...Object.entries(s.anagrafica).map(([voce, v]) => valore(`anagrafica.${voce}`, v)),
    "",
    "### Contratto e date",
    valore("contratto.importo", k.importo === null ? "" : formatEuro(k.importo)),
    valore("contratto.oneriSicurezza", k.oneriSicurezza === null ? "" : formatEuro(k.oneriSicurezza)),
    valore("contratto.ribassoPercentuale", k.ribassoPercentuale === null ? "" : `${formatNumero(k.ribassoPercentuale, 3)}%`),
    valore("contratto.ritenutaPercentuale", k.ritenutaPercentuale === null ? "" : `${formatNumero(k.ritenutaPercentuale)}%`),
    valore("date.consegnaLavori", dataIt(s.date.consegnaLavori)),
    valore("date.durataGiorni", s.date.durataGiorni === null ? "" : `${s.date.durataGiorni} giorni`),
    valore("date.ultimazionePrevista", dataIt(s.date.ultimazionePrevista)),
    "",
    "### Soggetti (codice · ruolo · nome · dettagli)",
    ...(s.soggetti.length
      ? s.soggetti.map((x, i) => `- S${i + 1} · ${x.ruolo} · ${x.nome}${x.dettagli ? ` · ${taglia(x.dettagli, 160)}` : ""}${fonteBreve(s, x.fonte)}`)
      : ["- nessuno"]),
    "",
    "### Lavorazioni previste (codice · categoria: descrizione)",
    ...(s.lavorazioni.length
      ? s.lavorazioni.slice(0, 60).map((l, i) => `- L${i + 1} · ${l.categoria ? `${l.categoria}: ` : ""}${taglia(l.descrizione, 180)}`)
      : ["- nessuna"]),
    ...(s.lavorazioni.length > 60 ? [`- … altre ${s.lavorazioni.length - 60}`] : []),
    "",
    "### Documenti di progetto",
    ...(s.documenti.length
      ? s.documenti.map((d) => {
          const stato =
            d.stato === "letto"
              ? `letto: ${d.trovato}`
              : d.stato === "errore"
                ? `non letto: ${d.errore ?? "errore"}`
                : "lettura in corso";
          return `- «${d.nome}» · ${NOMI_DOCUMENTO_PROGETTO[d.tipo]} · ${stato}${d.differenze?.length ? ` · cambiato rispetto alla versione precedente: ${d.differenze.join("; ")}` : ""}`;
        })
      : ["- nessuno caricato"]),
  ];
  const presenti = new Set(s.documenti.filter((d) => d.stato !== "errore").map((d) => d.tipo));
  const mancanti = (["contratto", "computo", "cronoprogramma", "planimetria"] as const).filter((t) => !presenti.has(t));
  if (mancanti.length) righe.push(`Non caricati: ${mancanti.map((t) => NOMI_DOCUMENTO_PROGETTO[t]).join(", ")}.`);

  righe.push("", "### Computo");
  const voci = nv.computo?.voci ?? [];
  if (voci.length) {
    const categorie = new Map<string, { n: number; importo: number }>();
    for (const v of voci) {
      const c = categorie.get(v.categoria || "Senza categoria") ?? { n: 0, importo: 0 };
      c.n += 1;
      c.importo += v.importo ?? 0;
      categorie.set(v.categoria || "Senza categoria", c);
    }
    const totale = voci.reduce((t, v) => t + (v.importo ?? 0), 0);
    const dedotte = voci.filter((v) => v.zonaDedotta).length;
    righe.push(
      `${voci.length} voci, totale ${formatEuro(totale)}. Categorie: ${[...categorie.entries()]
        .sort((a, b) => b[1].importo - a[1].importo)
        .slice(0, 15)
        .map(([c, x]) => `${c} (${x.n} voci, ${formatEuro(x.importo)})`)
        .join("; ")}.${dedotte ? ` Zona dedotta dalla descrizione per ${dedotte} voci.` : ""}`,
    );
    const perCodice = new Map(voci.map((v) => [v.wbs, v]));
    if (s.anomalie.length) {
      righe.push("Anomalie aperte (codice · tipo · controllo · voce):");
      righe.push(
        ...s.anomalie
          .slice(0, 40)
          .map((a) => `- ${a.wbs} · ${a.tipo} · ${a.descrizione} · ${taglia(perCodice.get(a.wbs)?.descrizione ?? "", 100)}`),
      );
      if (s.anomalie.length > 40) righe.push(`- … altre ${s.anomalie.length - 40}`);
    } else {
      righe.push("Nessuna anomalia aperta.");
    }
    if (s.anomalieIgnorate.length) righe.push(`Anomalie già chiuse dall'utente: ${s.anomalieIgnorate.length}.`);
  } else {
    righe.push("Non caricato.");
  }

  righe.push("", "### Cronoprogramma");
  const attivita = nv.programma?.attivita ?? [];
  if (attivita.length) {
    const inizi = attivita.map((a) => a.inizioPrevisto).filter((x): x is string => Boolean(x)).sort();
    const fini = attivita.map((a) => a.finePrevista).filter((x): x is string => Boolean(x)).sort();
    righe.push(`${attivita.length} attività${inizi.length && fini.length ? `, dal ${dataItaliana(inizi[0])} al ${dataItaliana(fini.at(-1)!)}` : ""}.`);
  } else {
    righe.push("Non caricato.");
  }

  righe.push("", "### Zone (id · nome · piano · tipo · voci di computo · attività · note)");
  if (s.zoneInPreparazione) righe.push("La proposta delle zone è in preparazione.");
  if (s.zone.length) {
    const importi = new Map(voci.map((v) => [v.wbs, v.importo ?? 0]));
    righe.push(
      ...s.zone.slice(0, 80).map((zona) => {
        const importo = zona.vociComputo.reduce((t, w) => t + (importi.get(w) ?? 0), 0);
        return `- ${zona.id} · ${zona.nome} · ${zona.piano || "—"} · ${NOMI_TIPO_ZONA[zona.tipo]} · ${zona.vociComputo.length} voci${importo ? ` (${formatEuro(importo)})` : ""} · ${zona.attivita.length} attività${zona.note ? ` · ${taglia(zona.note, 120)}` : ""}${zona.certezza === "dedotto" ? " (da verificare)" : ""}`;
      }),
    );
    if (s.zone.length > 80) righe.push(`- … altre ${s.zone.length - 80}`);
  } else if (!s.zoneInPreparazione) {
    righe.push("- nessuna zona");
  }
  if (s.vociSenzaZona.length) {
    righe.push(
      `Voci di computo senza zona: ${s.vociSenzaZona.length} (${s.vociSenzaZona.slice(0, 40).join(", ")}${s.vociSenzaZona.length > 40 ? ", …" : ""}).`,
    );
  }

  const aperte = s.decisioni.filter((d) => !d.risposta);
  const prese = s.decisioni.filter((d) => d.risposta);
  if (s.decisioni.length) {
    righe.push("", "### Decisioni (id · domanda · opzioni · risposta)");
    righe.push(...aperte.map((d) => `- ${d.id} · ${d.domanda} · ${d.opzioni.join(" / ")} · da decidere`));
    righe.push(...prese.map((d) => `- ${d.id} · ${d.domanda} · ${d.opzioni.join(" / ")} · risposta: ${d.risposta}`));
  }
  return righe.join("\n");
}

// ---------------------------------------------------------------------------
// Strumenti

const numero = z.number().nullable().optional();
const DATA = /^(\d{4}-\d{2}-\d{2})?$/;

/** Come chiamare nei messaggi i valori della scheda. */
const ETICHETTE: Record<string, string> = {
  nome: "nome del cantiere",
  indirizzo: "indirizzo",
  appalto: "tipo di appalto",
  lavori: "oggetto dei lavori",
  "contratto.importo": "importo contrattuale",
  "contratto.oneriSicurezza": "oneri della sicurezza",
  "contratto.ribassoPercentuale": "ribasso",
  "contratto.ritenutaPercentuale": "ritenuta a garanzia",
  "date.consegnaLavori": "consegna lavori",
  "date.durataGiorni": "durata",
  "date.ultimazionePrevista": "ultimazione prevista",
};

const ModificaDatiInput = z.object({
  nome: z.string().optional().describe("Nome del cantiere."),
  indirizzo: z.string().optional(),
  appalto: z.enum(["pubblico", "privato"]).optional(),
  lavori: z.string().optional().describe("Oggetto dei lavori."),
  anagrafica: z
    .array(z.object({ voce: z.string().describe("Es. «CIG», «CUP», «Permesso di costruire»."), valore: z.string().describe("Vuoto per togliere la voce.") }))
    .optional(),
  contratto: z
    .object({
      importo: numero.describe("Importo contrattuale in euro; null per toglierlo."),
      oneri_sicurezza: numero.describe("Oneri della sicurezza in euro."),
      ribasso_percentuale: numero.describe("Es. 12.35 per 12,350%."),
      ritenuta_percentuale: numero.describe("Es. 0.5."),
    })
    .optional(),
  date: z
    .object({
      consegna_lavori: z.string().optional().describe("AAAA-MM-GG; vuota per toglierla."),
      durata_giorni: z.number().int().nullable().optional(),
      ultimazione_prevista: z.string().optional().describe("AAAA-MM-GG; vuota per toglierla."),
    })
    .optional(),
  conferma: z
    .array(z.string())
    .optional()
    .describe("Chiavi dei valori «da verificare» che l'utente conferma così come sono, scritte come nella scheda: «indirizzo», «contratto.importo», «date.consegnaLavori», «anagrafica.CIG»…"),
});

const ModificaSoggettiInput = z.object({
  operazioni: z
    .array(
      z.object({
        azione: z.enum(["aggiungi", "modifica", "togli", "conferma"]),
        soggetto: z.string().optional().describe("Codice del soggetto nella scheda, es. «S3». Serve per modifica, togli e conferma."),
        ruolo: z.string().optional().describe("Es. «Coordinatore per la sicurezza in esecuzione (CSE)»."),
        nome: z.string().optional().describe("Persona o impresa, con il titolo se c'è: «Geom. Marco Bianchi»."),
        dettagli: z.string().optional().describe("Sede, partita IVA, recapiti, iscrizione all'albo."),
      }),
    )
    .min(1),
});

const ModificaLavorazioniInput = z.object({
  operazioni: z
    .array(
      z.object({
        azione: z.enum(["aggiungi", "modifica", "togli"]),
        lavorazione: z.string().optional().describe("Codice nella scheda, es. «L2». Serve per modifica e togli."),
        categoria: z.string().optional(),
        descrizione: z.string().optional(),
      }),
    )
    .min(1),
});

const ModificaZoneInput = z.object({
  operazioni: z
    .array(
      z.object({
        azione: z
          .enum(["aggiungi", "modifica", "unisci", "togli", "conferma", "sposta_voci"])
          .describe("unisci: le altre_zone confluiscono nella zona indicata; togli: le sue voci finiscono tra quelle senza zona; sposta_voci: mette voci e attività nella zona indicata, togliendole da dove sono (senza zona: le lascia fuori da tutte)."),
        zona: z.string().optional().describe("Id della zona, es. «z-piano-terra». Per unisci è la zona che resta."),
        altre_zone: z.array(z.string()).optional().describe("Solo per unisci: id delle zone che confluiscono nella prima e spariscono."),
        nome: z.string().optional(),
        piano: z.string().optional(),
        tipo: z.enum(TIPI_ZONA).optional(),
        note: z.string().optional(),
        voci_computo: z.array(z.string()).optional().describe("aggiungi e sposta_voci: codici WBS delle voci di computo."),
        attivita: z.array(z.string()).optional().describe("aggiungi e sposta_voci: codici WBS delle attività del cronoprogramma."),
      }),
    )
    .min(1),
});

const IgnoraAnomalieInput = z.object({
  anomalie: z.array(z.object({ codice: z.string().describe("Codice WBS della voce."), tipo: z.string().describe("Tipo dell'anomalia come nella scheda.") })).min(1),
  motivo: z.string().describe("In poche parole, perché l'utente la chiude: «importo corretto, errore di arrotondamento»."),
});

const RispondiDecisioniInput = z.object({
  risposte: z.array(z.object({ decisione: z.string().describe("Id della decisione, es. «d-1»."), risposta: z.string() })).min(1),
});

const Vuoto = z.object({});

const pulito = (t: string | undefined) => (t ?? "").replace(/\s+/g, " ").trim();

function schedaDi(c: ContestoStrumento): SchedaCantiere {
  const s = scheda(c.cantiereId);
  if (!s) throw new Error("Questo cantiere non ha una scheda da rivedere.");
  return s;
}

/** Salva le modifiche con la stessa validazione dei moduli e le annota per il messaggio. */
async function applica(c: ContestoStrumento, modifiche: ModificheScheda, fatto: string[]) {
  const s = await aggiornaScheda(c.cantiereId, modifiche);
  c.modifiche?.push(...fatto);
  return s;
}

function confermata(f: Fonte | undefined): Fonte | undefined {
  return f ? { ...f, certezza: "letto" } : undefined;
}

const daCodice = (codice: string | undefined, prefisso: string, lunghezza: number): number => {
  const m = new RegExp(`^${prefisso}(\\d+)$`, "i").exec(pulito(codice));
  const i = m ? Number(m[1]) - 1 : -1;
  if (i < 0 || i >= lunghezza) throw new Error(`Codice «${codice ?? ""}» non trovato: usa i codici ${prefisso}1, ${prefisso}2… della scheda.`);
  return i;
};

function idZona(nome: string, usati: Set<string>): string {
  const base = `z-${
    nome
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "zona"
  }`;
  let id = base;
  for (let i = 2; usati.has(id); i++) id = `${base}-${i}`;
  usati.add(id);
  return id;
}

const STRUMENTI_SCHEDA = {
  modifica_dati: strumento(
    "modifica_dati",
    "Aggiorna i dati generali della scheda del cantiere (nome, indirizzo, appalto, oggetto dei lavori, anagrafica), il contratto e le date, oppure conferma valori «da verificare» così come sono. Passa solo i campi da cambiare.",
    ModificaDatiInput,
    async (input, c) => {
      const s = schedaDi(c);
      const fatto: string[] = [];
      const fonti = { ...s.fonti };
      const tocca = (chiave: string) => {
        if (fonti[chiave]) fonti[chiave] = confermata(fonti[chiave])!;
      };
      const m: ModificheScheda = {};
      const testo = (chiave: "nome" | "indirizzo" | "lavori", etichetta: string) => {
        const nuovo = input[chiave];
        if (nuovo === undefined) return;
        if (chiave === "nome" && !pulito(nuovo)) throw new Error("Il nome del cantiere non può essere vuoto.");
        m[chiave] = nuovo;
        tocca(chiave);
        fatto.push(pulito(nuovo) ? `${etichetta}: «${pulito(nuovo)}»` : `${etichetta} tolto`);
      };
      testo("nome", "Nome del cantiere");
      testo("indirizzo", "Indirizzo");
      testo("lavori", "Oggetto dei lavori");
      if (input.appalto) {
        m.appalto = input.appalto;
        fonti.appalto = fonti.appalto ? confermata(fonti.appalto)! : { documento: "", certezza: "letto" };
        fatto.push(`Appalto ${input.appalto}`);
      }
      if (input.anagrafica?.length) {
        const anagrafica = { ...s.anagrafica };
        for (const { voce, valore } of input.anagrafica) {
          const v = pulito(voce);
          if (!v) continue;
          if (pulito(valore)) {
            anagrafica[v] = pulito(valore);
            fatto.push(`${v}: «${pulito(valore)}»`);
          } else {
            delete anagrafica[v];
            delete fonti[`anagrafica.${v}`];
            fatto.push(`${v} tolto`);
          }
          tocca(`anagrafica.${v}`);
        }
        m.anagrafica = anagrafica;
      }
      if (input.contratto) {
        const contratto = { ...s.contratto };
        const campi = [
          ["importo", "importo", "Importo contrattuale", (n: number) => formatEuro(n)],
          ["oneri_sicurezza", "oneriSicurezza", "Oneri della sicurezza", (n: number) => formatEuro(n)],
          ["ribasso_percentuale", "ribassoPercentuale", "Ribasso", (n: number) => `${formatNumero(n, 3)}%`],
          ["ritenuta_percentuale", "ritenutaPercentuale", "Ritenuta a garanzia", (n: number) => `${formatNumero(n)}%`],
        ] as const;
        for (const [da, a, etichetta, formato] of campi) {
          const v = input.contratto[da];
          if (v === undefined) continue;
          contratto[a] = v;
          tocca(`contratto.${a}`);
          fatto.push(v === null ? `${etichetta} tolto` : `${etichetta}: ${formato(v)}`);
        }
        m.contratto = contratto;
      }
      if (input.date) {
        const date = { ...s.date };
        for (const [da, a, etichetta] of [
          ["consegna_lavori", "consegnaLavori", "Consegna lavori"],
          ["ultimazione_prevista", "ultimazionePrevista", "Ultimazione prevista"],
        ] as const) {
          const v = input.date[da];
          if (v === undefined) continue;
          if (!DATA.test(pulito(v))) throw new Error(`${etichetta}: scrivi la data come AAAA-MM-GG.`);
          date[a] = pulito(v);
          tocca(`date.${a}`);
          fatto.push(pulito(v) ? `${etichetta}: ${dataIt(pulito(v))}` : `${etichetta} tolta`);
        }
        if (input.date.durata_giorni !== undefined) {
          date.durataGiorni = input.date.durata_giorni;
          tocca("date.durataGiorni");
          fatto.push(input.date.durata_giorni === null ? "Durata tolta" : `Durata: ${input.date.durata_giorni} giorni`);
        }
        m.date = date;
      }
      for (const chiave of input.conferma ?? []) {
        if (fonti[chiave]?.certezza !== "dedotto") continue;
        tocca(chiave);
        fatto.push(`Confermato: ${ETICHETTE[chiave] ?? chiave.replace(/^anagrafica\./, "")}`);
      }
      if (!fatto.length) return { esito: "Nessuna modifica: non hai indicato campi da cambiare o valori da verificare." };
      m.fonti = fonti;
      await applica(c, m, fatto);
      return { esito: "Scheda aggiornata.", fatto };
    },
  ),

  modifica_soggetti: strumento(
    "modifica_soggetti",
    "Aggiunge, corregge, toglie o conferma i soggetti della scheda (committente, impresa, DL, CSE, progettisti…). I codici S1, S2… sono quelli della scheda attuale e restano validi per tutte le operazioni della stessa chiamata.",
    ModificaSoggettiInput,
    async (input, c) => {
      const s = schedaDi(c);
      const soggetti: (Soggetto | null)[] = s.soggetti.map((x) => ({ ...x }));
      const nuovi: Soggetto[] = [];
      const fatto: string[] = [];
      for (const op of input.operazioni) {
        if (op.azione === "aggiungi") {
          if (!pulito(op.ruolo) || !pulito(op.nome)) throw new Error("Per aggiungere un soggetto servono ruolo e nome.");
          nuovi.push({ ruolo: pulito(op.ruolo), nome: pulito(op.nome), dettagli: pulito(op.dettagli) });
          fatto.push(`Aggiunto: ${pulito(op.ruolo)} «${pulito(op.nome)}»`);
          continue;
        }
        const i = daCodice(op.soggetto, "S", soggetti.length);
        const x = soggetti[i];
        if (!x) throw new Error(`Il soggetto ${op.soggetto} è già stato tolto in questa chiamata.`);
        if (op.azione === "togli") {
          soggetti[i] = null;
          fatto.push(`Tolto: ${x.ruolo} «${x.nome}»`);
        } else if (op.azione === "conferma") {
          x.fonte = confermata(x.fonte);
          fatto.push(`Confermato: ${x.ruolo} «${x.nome}»`);
        } else {
          const prima = { ...x };
          if (op.ruolo !== undefined && pulito(op.ruolo)) x.ruolo = pulito(op.ruolo);
          if (op.nome !== undefined && pulito(op.nome)) x.nome = pulito(op.nome);
          if (op.dettagli !== undefined) x.dettagli = pulito(op.dettagli);
          x.fonte = confermata(x.fonte);
          const cambiato = prima.ruolo !== x.ruolo || prima.nome !== x.nome;
          fatto.push(
            cambiato
              ? `${prima.ruolo} «${prima.nome}» → ${x.ruolo} «${x.nome}»`
              : prima.dettagli !== x.dettagli
                ? `${x.ruolo} «${x.nome}»: dettagli aggiornati`
                : `Confermato: ${x.ruolo} «${x.nome}»`,
          );
        }
      }
      await applica(c, { soggetti: [...soggetti.filter((x): x is Soggetto => x !== null), ...nuovi] }, fatto);
      return { esito: "Soggetti aggiornati: i codici S1, S2… ora seguono il nuovo elenco.", fatto };
    },
  ),

  modifica_lavorazioni: strumento(
    "modifica_lavorazioni",
    "Aggiunge, corregge o toglie lavorazioni previste della scheda. I codici L1, L2… sono quelli della scheda attuale.",
    ModificaLavorazioniInput,
    async (input, c) => {
      const s = schedaDi(c);
      const lavorazioni = s.lavorazioni.map((x) => ({ ...x }) as (typeof s.lavorazioni)[number] | null);
      const nuove: typeof s.lavorazioni = [];
      const fatto: string[] = [];
      for (const op of input.operazioni) {
        if (op.azione === "aggiungi") {
          if (!pulito(op.descrizione)) throw new Error("Per aggiungere una lavorazione serve la descrizione.");
          nuove.push({ categoria: pulito(op.categoria), descrizione: pulito(op.descrizione) });
          fatto.push(`Lavorazione aggiunta: ${taglia(pulito(op.descrizione), 80)}`);
          continue;
        }
        const i = daCodice(op.lavorazione, "L", lavorazioni.length);
        const x = lavorazioni[i];
        if (!x) throw new Error(`La lavorazione ${op.lavorazione} è già stata tolta in questa chiamata.`);
        if (op.azione === "togli") {
          lavorazioni[i] = null;
          fatto.push(`Lavorazione tolta: ${taglia(x.descrizione, 80)}`);
        } else {
          if (op.categoria !== undefined) x.categoria = pulito(op.categoria);
          if (op.descrizione !== undefined && pulito(op.descrizione)) x.descrizione = pulito(op.descrizione);
          x.fonte = confermata(x.fonte);
          fatto.push(`Lavorazione corretta: ${taglia(x.descrizione, 80)}`);
        }
      }
      await applica(c, { lavorazioni: [...lavorazioni.filter((x) => x !== null), ...nuove] }, fatto);
      return { esito: "Lavorazioni aggiornate: i codici L1, L2… ora seguono il nuovo elenco.", fatto };
    },
  ),

  modifica_zone: strumento(
    "modifica_zone",
    "Modifica le zone del cantiere: aggiungi, modifica (nome, piano, tipo, note), unisci, togli, conferma una zona da verificare, sposta voci di computo e attività tra le zone. Le operazioni si applicano in ordine.",
    ModificaZoneInput,
    async (input, c) => {
      const nv = await datiNowVision(c.cantiereId);
      const wbsVoci = new Set((nv.computo?.voci ?? []).map((v) => v.wbs));
      const wbsAttivita = new Set((nv.programma?.attivita ?? []).map((a) => a.wbs));
      // Da qui in poi niente attese: la scheda letta è quella che si salva.
      const s = schedaDi(c);
      let zone: Zona[] = s.zone.map((x) => ({ ...x, vociComputo: [...x.vociComputo], attivita: [...x.attivita] }));
      let senzaZona = [...s.vociSenzaZona];
      const usati = new Set(zone.map((x) => x.id));
      const fatto: string[] = [];
      const trova = (id: string | undefined) => {
        const zona = zone.find((x) => x.id === pulito(id) || x.nome.toLowerCase() === pulito(id).toLowerCase());
        if (!zona) throw new Error(`Zona «${id ?? ""}» non trovata: usa gli id della scheda, es. «${zone[0]?.id ?? "z-piano-terra"}».`);
        return zona;
      };
      const controlla = (codici: string[] | undefined, validi: Set<string>, cosa: string) => {
        const dati = (codici ?? []).map(pulito).filter(Boolean);
        const ignoti = validi.size ? dati.filter((w) => !validi.has(w)) : [];
        if (ignoti.length) throw new Error(`${cosa} non trovate: ${ignoti.slice(0, 8).join(", ")}. Controlla i codici con gli strumenti di consultazione.`);
        return dati;
      };
      /** Toglie voci e attività da tutte le zone e dalle voci senza zona, prima di rimetterle. */
      const libera = (voci: string[], attivita: string[]) => {
        for (const x of zone) {
          x.vociComputo = x.vociComputo.filter((w) => !voci.includes(w));
          x.attivita = x.attivita.filter((w) => !attivita.includes(w));
        }
        senzaZona = senzaZona.filter((w) => !voci.includes(w));
      };

      for (const op of input.operazioni) {
        const voci = controlla(op.voci_computo, wbsVoci, "Voci di computo");
        const attivita = controlla(op.attivita, wbsAttivita, "Attività");
        switch (op.azione) {
          case "aggiungi": {
            const nome = pulito(op.nome);
            if (!nome) throw new Error("Per aggiungere una zona serve il nome.");
            libera(voci, attivita);
            zone.push({
              id: idZona(nome, usati),
              nome,
              piano: pulito(op.piano),
              tipo: op.tipo ?? "unita",
              vociComputo: voci,
              attivita,
              note: pulito(op.note),
              certezza: "letto",
            });
            fatto.push(`Zona aggiunta: «${nome}»${voci.length ? ` con ${voci.length} voci` : ""}`);
            break;
          }
          case "modifica": {
            const zona = trova(op.zona);
            const prima = zona.nome;
            if (pulito(op.nome)) zona.nome = pulito(op.nome);
            if (op.piano !== undefined) zona.piano = pulito(op.piano);
            if (op.tipo) zona.tipo = op.tipo;
            if (op.note !== undefined) zona.note = pulito(op.note);
            zona.certezza = "letto";
            fatto.push(prima === zona.nome ? `Zona «${zona.nome}» aggiornata` : `Zona «${prima}» → «${zona.nome}»`);
            break;
          }
          case "unisci": {
            const zona = trova(op.zona);
            const altre = (op.altre_zone ?? []).map(trova).filter((x) => x.id !== zona.id);
            if (!altre.length) throw new Error("Per unire servono altre_zone diverse dalla zona che resta.");
            zona.vociComputo = [...new Set([zona, ...altre].flatMap((x) => x.vociComputo))];
            zona.attivita = [...new Set([zona, ...altre].flatMap((x) => x.attivita))];
            zona.note = [zona, ...altre].map((x) => x.note).filter(Boolean).join(" · ");
            if (pulito(op.nome)) zona.nome = pulito(op.nome);
            if (op.piano !== undefined) zona.piano = pulito(op.piano);
            if (op.tipo) zona.tipo = op.tipo;
            zona.certezza = "letto";
            zone = zone.filter((x) => !altre.includes(x));
            fatto.push(`Unite in «${zona.nome}»: ${altre.map((x) => `«${x.nome}»`).join(", ")}`);
            break;
          }
          case "togli": {
            const zona = trova(op.zona);
            zone = zone.filter((x) => x !== zona);
            senzaZona = [...new Set([...senzaZona, ...zona.vociComputo])];
            fatto.push(`Zona tolta: «${zona.nome}»${zona.vociComputo.length ? ` (${zona.vociComputo.length} voci tornano senza zona)` : ""}`);
            break;
          }
          case "conferma": {
            const zona = trova(op.zona);
            zona.certezza = "letto";
            fatto.push(`Zona confermata: «${zona.nome}»`);
            break;
          }
          case "sposta_voci": {
            if (!voci.length && !attivita.length) throw new Error("Indica le voci_computo o le attivita da spostare.");
            libera(voci, attivita);
            if (pulito(op.zona)) {
              const zona = trova(op.zona);
              zona.vociComputo = [...new Set([...zona.vociComputo, ...voci])];
              zona.attivita = [...new Set([...zona.attivita, ...attivita])];
              fatto.push(`In «${zona.nome}»: ${[...voci, ...attivita].slice(0, 12).join(", ")}${voci.length + attivita.length > 12 ? "…" : ""}`);
            } else {
              senzaZona = [...new Set([...senzaZona, ...voci])];
              fatto.push(`Senza zona: ${voci.slice(0, 12).join(", ")}${voci.length > 12 ? "…" : ""}`);
            }
            break;
          }
        }
      }
      await applica(c, { zone, vociSenzaZona: senzaZona }, fatto);
      return { esito: "Zone aggiornate.", fatto, zone: zone.map((x) => `${x.id} · ${x.nome} · ${x.vociComputo.length} voci · ${x.attivita.length} attività`) };
    },
  ),

  ignora_anomalie: strumento(
    "ignora_anomalie",
    "Chiude anomalie del computo che l'utente ha controllato e vuole lasciare così: non tornano anche se il computo viene riletto.",
    IgnoraAnomalieInput,
    async (input, c) => {
      const s = schedaDi(c);
      const chiavi = new Set<string>();
      for (const a of input.anomalie) {
        const trovate = s.anomalie.filter((x) => x.wbs === pulito(a.codice) && (x.tipo === pulito(a.tipo) || !pulito(a.tipo)));
        if (!trovate.length) throw new Error(`Anomalia ${a.codice} (${a.tipo}) non trovata tra quelle aperte.`);
        for (const x of trovate) chiavi.add(`${x.wbs}|${x.tipo}`);
      }
      const fatto = [...chiavi].map((k) => `Anomalia chiusa: voce ${k.split("|")[0]} (${pulito(input.motivo) || "controllata"})`);
      await applica(
        c,
        {
          anomalie: s.anomalie.filter((x) => !chiavi.has(`${x.wbs}|${x.tipo}`)),
          anomalieIgnorate: [...new Set([...s.anomalieIgnorate, ...chiavi])],
        },
        fatto,
      );
      return { esito: "Anomalie chiuse.", fatto, aperte: s.anomalie.length };
    },
  ),

  rispondi_decisioni: strumento(
    "rispondi_decisioni",
    "Registra la risposta dell'utente alle decisioni aperte della scheda (es. seguire gli alloggi uno per uno o per piano). Poi, se serve, applica la scelta con modifica_zone.",
    RispondiDecisioniInput,
    async (input, c) => {
      const s = schedaDi(c);
      const decisioni = s.decisioni.map((d) => ({ ...d }));
      const fatto: string[] = [];
      for (const r of input.risposte) {
        const d = decisioni.find((x) => x.id === pulito(r.decisione));
        if (!d) throw new Error(`Decisione «${r.decisione}» non trovata.`);
        d.risposta = pulito(r.risposta);
        fatto.push(`${d.domanda} → ${d.risposta}`);
      }
      await applica(c, { decisioni }, fatto);
      return { esito: "Risposte registrate.", fatto };
    },
  ),

  riproponi_zone: strumento(
    "riproponi_zone",
    "Rifà da capo la proposta delle zone dai documenti letti. Sostituisce le zone attuali e le modifiche fatte: usalo solo se l'utente lo chiede.",
    Vuoto,
    async (_input, c) => {
      const s = schedaDi(c);
      if (s.zoneInPreparazione) return { esito: "La proposta delle zone è già in preparazione: riprova tra poco." };
      await proponiZone(s, c.personaId ?? s.creatoDa);
      const dopo = schedaDi(c);
      c.modifiche?.push(`Nuova proposta delle zone: ${dopo.zone.length} zone`);
      return {
        esito: dopo.zone.length ? "Nuova proposta pronta." : "Proposta non riuscita o senza dati: computo, programma e planimetrie non bastano.",
        zone: dopo.zone.map((x) => `${x.id} · ${x.nome} · ${x.piano} · ${x.vociComputo.length} voci · ${x.attivita.length} attività`),
        voci_senza_zona: dopo.vociSenzaZona.length,
      };
    },
  ),

  conferma_scheda: strumento(
    "conferma_scheda",
    "Conferma la scheda del cantiere: da quel momento il Redattore la usa in ogni nuovo report. Chiamalo solo quando l'utente lo chiede esplicitamente.",
    Vuoto,
    async (_input, c) => {
      const s = schedaDi(c);
      if (s.stato === "attiva") return { esito: "La scheda era già confermata." };
      await confermaScheda(c.cantiereId);
      c.modifiche?.push("Scheda confermata");
      void registra({ persona: c.personaId ?? s.creatoDa, tipo: "onboarding", cantiere: s.id, esito: "ok", modalita: "conferma", dettaglio: s.nome });
      return { esito: "Scheda confermata: da ora il Redattore la usa in ogni nuovo report di questo cantiere." };
    },
  ),
};

const STRUMENTI_REVISIONE: Record<string, Strumento<z.ZodType>> = {
  consulta_computo: STRUMENTI.consulta_computo,
  consulta_programma: STRUMENTI.consulta_programma,
  ...STRUMENTI_SCHEDA,
} as Record<string, Strumento<z.ZodType>>;

export const DEFINIZIONI_REVISIONE: BetaTool[] = Object.values(STRUMENTI_REVISIONE).map((s) => s.definizione);

export function eseguiStrumentoRevisione(nome: string, input: unknown, contesto: ContestoStrumento): Promise<EsitoStrumento> {
  return eseguiDa(STRUMENTI_REVISIONE, nome, input, contesto);
}

// ---------------------------------------------------------------------------
// Documenti allegati in chat

const inLettura = (s: SchedaCantiere, ids: string[]) =>
  s.zoneInPreparazione || s.documenti.some((d) => ids.includes(d.id) && (d.stato === "in_coda" || d.stato === "in_lettura"));

/**
 * Aspetta che i documenti allegati al messaggio siano letti (e la proposta delle zone
 * finita), così il Redattore risponde sulla scheda aggiornata. Al più `massimoMs`.
 */
export async function attendiLetture(cantiereId: string, ids: string[], segnale: AbortSignal, massimoMs = 15 * 60_000) {
  const fine = Date.now() + massimoMs;
  for (;;) {
    const s = scheda(cantiereId);
    if (!s || !inLettura(s, ids) || segnale.aborted || Date.now() > fine) return;
    await new Promise((r) => setTimeout(r, 800));
  }
}

/** Riga per il modello sugli allegati del messaggio: com'è andata la lettura. */
export function notaAllegati(s: SchedaCantiere, ids: string[]): string {
  const righe = ids.flatMap((id) => {
    const d = s.documenti.find((x) => x.id === id);
    if (!d) return [];
    const esito =
      d.stato === "letto" ? `letto: ${d.trovato}` : d.stato === "errore" ? `lettura non riuscita: ${d.errore ?? "errore"}` : "lettura ancora in corso";
    return [`«${d.nome}» (${NOMI_DOCUMENTO_PROGETTO[d.tipo]}) · ${esito}`];
  });
  return righe.length ? `[Documenti allegati dall'utente: ${righe.join("; ")}. La scheda qui sopra li comprende già.]` : "";
}

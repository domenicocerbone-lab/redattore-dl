// Prompt di sistema del Redattore DL. Fisso per tutta la conversazione: data, ora e
// tipo di documento scelto viaggiano nei messaggi, così il prefisso resta in cache.

import { createHash } from "node:crypto";
import { NOMI_TIPO_ZONA, eScheda, type Cantiere, type SchedaCantiere } from "../shared/cantieri";
import { TIPI_DOCUMENTO } from "../shared/documenti";
import { formatEuro, formatNumero } from "../shared/numeri";

const RUOLO = `Sei il Redattore DL di NowVision: aiuti il Direttore dei Lavori di un cantiere edile italiano a preparare le bozze dei documenti di cantiere (giornale dei lavori, libretto delle misure, SAL, verbali, ordini di servizio, rapporti di non conformità). Il DL ti racconta la giornata a voce o per iscritto, ti manda foto, e tu prepari bozze che lui verifica e firma. Verifica e firma restano sue: tu prepari, non attesti.`;

const REGOLE = `## Regole sui fatti
- Scrivi solo ciò che il DL ti ha detto, ciò che è nell'anagrafica del cantiere e ciò che si vede nelle foto. Non inventare imprese, nomi, quantità, misure, date, orari, numeri di documento o riferimenti normativi.
- Un dato obbligatorio che manca: nel documento scrivi «[da completare]» e chiedilo al DL. Non riempirlo con un valore plausibile.
- Dalle foto ricavi solo ciò che si vede. Se è un'ipotesi dillo («sembra», «da verificare sul posto»). Imprese, quantità e nomi li chiedi prima di scriverli.
- Cita una norma solo se sei certo che articolo e comma siano corretti; altrimenti descrivi l'obbligo senza citare.
- Quando trasformi le parole del DL in linguaggio formale non cambiare il senso: una disposizione verbale resta verbale, una fornitura «accettata» resta accettata, un sospetto resta un sospetto.
- Se il DL ti chiede qualcosa che spetta a lui (firmare, attestare, decidere una classificazione), proponi e chiedi conferma.

## Calcoli
Non fare mai conti a mente. Per prodotti di misure, totali e deduzioni del libretto usa lo strumento calcola_misure; per importi, ribasso, ritenuta e acconto di un SAL usa calcola_sal. Riporta nei documenti esattamente i valori restituiti. Le righe del libretto in chat vanno nella parte «righe_misura», che fa i conti da sola.

## Come lavori
1. Il DL sceglie un tipo di documento oppure ti manda foto. Se il tipo non è chiaro, deducilo dal racconto o chiedilo.
2. Raccogli i dati obbligatori del tipo (catalogo sotto). Dopo ogni messaggio del DL mostra la parte «dati_raccolti» con tutti i campi del tipo e il loro stato, poi fai al massimo due o tre domande mirate sui campi che mancano o sono da chiarire.
3. Quando i dati obbligatori sono completi, chiedi se vuole aggiungere qualcosa o procedere, con le azioni «Genera bozza →» (primario) e una secondaria pertinente.
4. Se il DL chiede la bozza, scrivila con la parte «documento», anche se manca qualcosa: i dati mancanti restano «[da completare]» e lo dici.
5. Per ogni modifica richiesta riscrivi il documento intero con la parte «documento» e lo stesso titolo: l'interfaccia lo mostra come nuova versione. Se il DL ha modificato a mano la bozza, riparti dal suo testo.
6. Con le foto e nessun tipo scelto: descrivi ciò che vedi con «foto_osservate» (una riga per foto o gruppo di foto simili), poi proponi i documenti utili con «proposte_bozze», mettendo come consigliata la bozza più utile. Le osservazioni su sicurezza (parapetti, ponteggi, DPI, scavi) vanno segnalate anche al CSE. Quando il DL sceglie una proposta, scrivi subito la bozza con «[da completare]» dove serve e poi chiedi i dati mancanti.
7. Le decisioni che spettano al DL e che cambiano il documento (classificazioni, comunicazioni ad altri soggetti, aprire un altro documento) mettile in «da_decidere» o chiedile con azioni a scelta.

## Dati del cantiere
Computo metrico e cronoprogramma del cantiere non sono in questo prompt: consultali con gli strumenti consulta_computo (voci per zona, parole o codice) e consulta_programma (attività per zona, data o parole). Non citare voci, quantità, importi o date del computo e del programma senza averli consultati. Nella scheda del cantiere i valori segnati «(da verificare)» sono stati dedotti dai documenti di progetto: usali, ma ricordalo all'utente quando finiscono in un documento.

## Riprese 360° e dati NowVision
Il DL può allegare riprese 360° della piattaforma NowVision (etichetta «ripresa 360° NowVision», con zona e data). Insieme alle riprese ricevi il riepilogo NowVision del cantiere: cronoprogramma con date previste, avanzamento atteso alla data di riferimento (già calcolato) e stato registrato; computo con quantità, importi e «misurato dall'IA» della piattaforma.
- La data di riferimento del confronto è quella della ripresa più recente, non quella di oggi.
- Confronta con la parte «confronto_programma»: per ogni attività del cronoprogramma pertinente alle zone riprese o prevista in corso alla data di riferimento, metti accanto cosa prevede il programma, cosa risulta registrato in NowVision e cosa si vede nelle riprese. Collega le voci di computo alle attività per significato: i codici dei due file non coincidono.
- Non misurare dalle foto. Quantità e percentuali vengono dal misurato dall'IA della piattaforma o dal libretto delle misure; dalle riprese ricavi solo indicazioni qualitative (avviata, in corso, completata, non visibile). Se il misurato dall'IA e ciò che vedi non tornano, dillo.
- Un'attività prevista in corso che non si vede nelle riprese è «non_visibile», non in ritardo: può non essere stata ripresa. Chiedi al DL e non proporre ordini di servizio per ritardo finché non conferma. «in_ritardo» solo con una prova visiva, come una lavorazione ancora in corso dopo la fine prevista.
- Lo stato reale di partenza è il misurato dall'IA della piattaforma. Il cronoprogramma spesso non ha ancora date effettive né percentuali aggiornate: è normale, non segnalarlo come un problema. Usa il misurato per l'avanzamento e proponi le date effettive e le percentuali da registrare nel cronoprogramma, lasciando «[da completare]» dove le riprese non bastano.
- Segnala invece le lavorazioni avviate prima del previsto o fuori sequenza, e le differenze tra il misurato dall'IA e ciò che vedi.
- Dopo il confronto: «foto_osservate» per i problemi di sicurezza o qualità che vedi, poi «proposte_bozze». Le bozze tipiche sono il giornale dei lavori della data delle riprese, il report di avanzamento con previsto e reale e le date effettive da registrare in NowVision, e se servono la segnalazione al CSE o una non conformità. Il Redattore non modifica NowVision: propone, il DL aggiorna.

## Come rispondi
Rispondi sempre e solo con l'oggetto JSON richiesto: un elenco di parti nell'ordine in cui il DL le legge.
- «testo»: frasi brevi e concrete, in italiano, dando del tu al DL. Niente premesse, niente riassunti di ciò che ha appena detto, niente formule di cortesia. Due o tre frasi bastano quasi sempre.
- «dati_raccolti», «foto_osservate», «proposte_bozze», «confronto_programma», «controlli», «da_decidere», «righe_misura»: le schede strutturate descritte nello schema.
- «documento»: la bozza completa. Accompagnala con un testo di una o due frasi su cosa hai riportato e come (es. «Ho riportato la fornitura come accettata dalla DL»), e chiudi con cosa resta da controllare o firmare.
- «azioni»: pulsanti di risposta rapida in fondo alla risposta, quando c'è una scelta naturale. Al massimo tre, un solo primario. Il messaggio va scritto come lo scriverebbe il DL.
- «titolo_conversazione»: al primo turno e quando il tema diventa più chiaro, un titolo breve come «Giornale 28/10 · Lotto B» o «NC tamponature piano 2»; altrimenti stringa vuota.

## Stile dei documenti
Registro amministrativo italiano dei documenti di direzione lavori: frasi impersonali e complete («Risultano completate…», «Si rileva…», «Pervenuti in cantiere n. 2 bancali…»). Date gg/mm/aaaa, orari hh:mm, numeri con virgola decimale e punto delle migliaia, importi «€ 1.234,56». Usa le sezioni tipiche del documento, nell'ordine consueto. Nell'intestazione e nei dati generali riporta l'anagrafica del cantiere. Le firme sono quelle dei soggetti che firmano davvero quel documento.`;

function catalogo(): string {
  const righe = TIPI_DOCUMENTO.filter((t) => t.campi.length > 0).map((t) => {
    const facoltativi = t.facoltativi.length ? `; facoltativi: ${t.facoltativi.join(", ")}` : "";
    return `- ${t.nome} (\`${t.id}\`): ${t.campi.join(", ")}${facoltativi}`;
  });
  return `## Catalogo dei documenti\nPer ogni tipo, i campi obbligatori da raccogliere (usa questi nomi nella scheda «dati_raccolti»):\n${righe.join("\n")}\n- Altro documento (\`altro\`): concorda con il DL il contenuto.`;
}

const dataIt = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);

/** Scheda costruita con l'onboarding: soggetti, contratto, date, lavorazioni e zone, in forma compatta. */
function schedaConfermata(c: SchedaCantiere): string {
  const dedotto = (chiave: string) => (c.fonti[chiave]?.certezza === "dedotto" ? " (da verificare)" : "");
  const righe = [
    "## Cantiere",
    `- Nome: ${c.nome}`,
    c.lavori && `- Lavori: ${c.lavori}${dedotto("lavori")}`,
    c.indirizzo && `- Indirizzo: ${c.indirizzo}${dedotto("indirizzo")}`,
    `- Appalto: ${c.appalto === "pubblico" ? "pubblico (D.Lgs. 36/2023)" : "privato"}${dedotto("appalto")}`,
    ...Object.entries(c.anagrafica).map(([k, v]) => `- ${k}: ${v}${dedotto(`anagrafica.${k}`)}`),
  ].filter((r): r is string => Boolean(r));
  if (c.soggetti.length) {
    righe.push("", "Soggetti:");
    for (const s of c.soggetti) {
      righe.push(`- ${s.ruolo}: ${s.nome}${s.dettagli ? ` (${s.dettagli})` : ""}${s.fonte?.certezza === "dedotto" ? " (da verificare)" : ""}`);
    }
  }
  const k = c.contratto;
  const contratto = [
    k.importo !== null && `importo contrattuale ${formatEuro(k.importo)}${dedotto("contratto.importo")}`,
    k.oneriSicurezza !== null && `oneri della sicurezza ${formatEuro(k.oneriSicurezza)}${dedotto("contratto.oneriSicurezza")}`,
    k.ribassoPercentuale !== null && `ribasso ${formatNumero(k.ribassoPercentuale, 3)}%${dedotto("contratto.ribassoPercentuale")}`,
    k.ritenutaPercentuale !== null && `ritenuta a garanzia ${formatNumero(k.ritenutaPercentuale)}%${dedotto("contratto.ritenutaPercentuale")}`,
    c.date.consegnaLavori && `consegna lavori ${dataIt(c.date.consegnaLavori)}${dedotto("date.consegnaLavori")}`,
    c.date.durataGiorni !== null && `durata ${c.date.durataGiorni} giorni${dedotto("date.durataGiorni")}`,
    c.date.ultimazionePrevista && `ultimazione prevista ${dataIt(c.date.ultimazionePrevista)}${dedotto("date.ultimazionePrevista")}`,
  ].filter(Boolean);
  if (contratto.length) righe.push("", `Contratto: ${contratto.join("; ")}.`);
  if (c.lavorazioni.length) {
    righe.push("", "Lavorazioni previste:");
    righe.push(...c.lavorazioni.slice(0, 40).map((l) => `- ${l.categoria ? `${l.categoria}: ` : ""}${l.descrizione}`));
    if (c.lavorazioni.length > 40) righe.push(`- … altre ${c.lavorazioni.length - 40}`);
  }
  if (c.zone.length) {
    righe.push("", "Zone del cantiere (nome · piano · tipo · voci di computo · attività):");
    righe.push(
      ...c.zone
        .slice(0, 60)
        .map(
          (z) =>
            `- ${z.nome}${z.piano ? ` · ${z.piano}` : ""} · ${NOMI_TIPO_ZONA[z.tipo]} · ${z.vociComputo.length} ${z.vociComputo.length === 1 ? "voce" : "voci"} · ${z.attivita.length} attività`,
        ),
    );
    if (c.zone.length > 60) righe.push(`- … altre ${c.zone.length - 60} zone`);
  }
  return righe.join("\n");
}

/** Impronta del testo della scheda: cambia solo quando cambia ciò che il modello legge. */
export function impronteScheda(c: Cantiere): string {
  return createHash("sha256").update(schedaCantiere(c)).digest("hex").slice(0, 16);
}

export function schedaCantiere(c: Cantiere): string {
  if (eScheda(c)) {
    if (c.stato === "attiva") return schedaConfermata(c);
    return `## Cantiere
- Nome: ${c.nome}${c.indirizzo ? `\n- Indirizzo: ${c.indirizzo}` : ""}

La scheda del cantiere non è ancora stata confermata dall'utente: non dare per certi soggetti, imprese e importi, chiedili.`;
  }
  return schedaEsempio(c);
}

function schedaEsempio(c: Cantiere): string {
  const anagrafica = Object.entries(c.anagrafica)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const persone = c.persone.map((p) => `- ${p.nome} — ${p.ruolo}`).join("\n");
  let testo = `## Cantiere
- Nome: ${c.nome}
- Lavori: ${c.lavori}
- Indirizzo: ${c.indirizzo}
- Appalto: ${c.appalto === "pubblico" ? "pubblico (D.Lgs. 36/2023)" : "privato"}
${anagrafica}

Persone ricorrenti:
${persone}`;
  if (c.economia) {
    const e = c.economia;
    testo += `

Dati economici del contratto:
- Importo contrattuale: ${formatEuro(e.importoContrattuale)}
- Ribasso d'asta: ${formatNumero(e.ribassoPercentuale, 3)}% (si applica ai lavori, non agli oneri della sicurezza)
- Oneri della sicurezza maturati a oggi: ${formatEuro(e.oneriSicurezzaMaturati)}
- Ritenuta a garanzia: ${formatNumero(e.ritenutaPercentuale)}% sull'importo progressivo
- Anticipazione: non indicata in anagrafica`;
  }
  if (c.elencoPrezzi?.length) {
    const voci = c.elencoPrezzi
      .map(
        (v) =>
          `- ${v.tariffa} · ${v.descrizione} · ${v.um} · prezzo € ${formatNumero(v.prezzo)}` +
          (v.quantitaLibretto !== undefined
            ? ` · quantità a libretto ${formatNumero(v.quantitaLibretto)}`
            : ""),
      )
      .join("\n");
    testo += `

Elenco prezzi contrattuale, con le quantità progressive registrate nel libretto delle misure:
${voci}`;
  }
  return testo;
}

export function promptDiSistema(c: Cantiere, utente: { nome: string; ruolo: string }): string {
  return [
    RUOLO,
    REGOLE,
    catalogo(),
    schedaCantiere(c),
    `## Utente\n${utente.nome}, ${utente.ruolo} del cantiere.`,
  ].join("\n\n");
}

/** Riga di contesto anteposta a ogni messaggio del DL. */
export function contestoMessaggio(adesso: Date, modalita: string | undefined): string {
  const fuso = { timeZone: "Europe/Rome" } as const;
  const giorno = adesso.toLocaleDateString("it-IT", { ...fuso, weekday: "long" });
  const data = adesso.toLocaleDateString("it-IT", {
    ...fuso,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const ora = adesso.toLocaleTimeString("it-IT", { ...fuso, hour: "2-digit", minute: "2-digit" });
  const parti = [`Oggi è ${giorno} ${data}, ore ${ora}.`];
  if (modalita === "foto") {
    parti.push("Il DL ha scelto «Bozze dalle foto»: proponi tu quali documenti preparare.");
  } else if (modalita) {
    const tipo = TIPI_DOCUMENTO.find((t) => t.id === modalita);
    if (tipo) parti.push(`Documento scelto dal DL: ${tipo.nome}.`);
  }
  return `[Contesto: ${parti.join(" ")}]`;
}

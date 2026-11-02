// Finto endpoint /v1/messages che risponde in streaming SSE come l'API Claude,
// con risposte scritte a mano sugli esempi del design. Serve a provare l'interfaccia
// (e a fare demo) senza chiave API e senza costi: `npm run demo`.
//
// Non è il Redattore: le risposte dipendono solo da tipo di documento, foto e
// parole chiave. Il SAL passa davvero dallo strumento calcola_sal del server.

import { createServer, type ServerResponse } from "node:http";

const PORTA = Number(process.env.PORTA_FINTO ?? 4010);

type Blocco = { type: string; [k: string]: unknown };
type Messaggio = { role: "user" | "assistant"; content: string | Blocco[] };

const attesa = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Le date delle risposte seguono il giorno della demo.
const fuso = { timeZone: "Europe/Rome" } as const;
const oggi = () => new Date().toLocaleDateString("it-IT", { ...fuso, day: "2-digit", month: "2-digit", year: "numeric" });
const oggiBreve = () => new Date().toLocaleDateString("it-IT", { ...fuso, day: "2-digit", month: "2-digit" });

function sse(res: ServerResponse, evento: Record<string, unknown>) {
  res.write(`event: ${evento.type}\ndata: ${JSON.stringify(evento)}\n\n`);
}

async function streamTesto(res: ServerResponse, indice: number, testo: string) {
  sse(res, { type: "content_block_start", index: indice, content_block: { type: "text", text: "" } });
  for (let i = 0; i < testo.length; i += 24) {
    sse(res, { type: "content_block_delta", index: indice, delta: { type: "text_delta", text: testo.slice(i, i + 24) } });
    await attesa(12);
  }
  sse(res, { type: "content_block_stop", index: indice });
}

async function rispondi(
  res: ServerResponse,
  contenuto: { json?: unknown; strumento?: { nome: string; input: unknown } },
) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  sse(res, {
    type: "message_start",
    message: {
      id: `msg_finto_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 1 },
    },
  });
  // Ragionamento nascosto, come con display «omitted».
  sse(res, { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
  await attesa(700);
  sse(res, { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "finta" } });
  sse(res, { type: "content_block_stop", index: 0 });

  let stop = "end_turn";
  if (contenuto.strumento) {
    const json = JSON.stringify(contenuto.strumento.input);
    sse(res, {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: `toolu_finto_${Date.now()}`, name: contenuto.strumento.nome, input: {} },
    });
    for (let i = 0; i < json.length; i += 40) {
      sse(res, { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 40) } });
      await attesa(8);
    }
    sse(res, { type: "content_block_stop", index: 1 });
    stop = "tool_use";
  } else {
    await streamTesto(res, 1, JSON.stringify(contenuto.json));
  }
  sse(res, { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 900 } });
  sse(res, { type: "message_stop" });
  res.end();
}

// ---------------------------------------------------------------------------
// Risposte

const testo = (t: string) => ({ tipo: "testo", testo: t });
const azioni = (...a: [string, string, "primario" | "secondario" | "suggerimento", ("invia" | "scrivi")?][]) => ({
  tipo: "azioni",
  azioni: a.map(([t, messaggio, stile, modo]) => ({ testo: t, messaggio, stile, modo: modo ?? "invia" })),
});

const campo = (nome: string, valore: string, stato = "ok") => ({ nome, valore, stato });

function giornaleRaccolta(completo: boolean) {
  const campi = [
    campo("Data", oggi()),
    campo("Meteo", "pioggia fino alle 11, poi sereno"),
    campo("Maestranze", "4 persone, 2 imprese"),
    campo("Lavorazioni", "tamponature P2, scarichi P1"),
    campo("Forniture", "2 bancali Poroton 30, accettati"),
    completo ? campo("Mezzi", "betoniera, montacarichi") : campo("Mezzi", "", "manca"),
    completo ? campo("Disposizioni DL", "protezione solai, verbale") : campo("Disposizioni DL", "", "da_chiarire"),
    campo("Annotazioni", "", "facoltativo"),
  ];
  if (!completo) {
    return {
      parti: [
        testo(
          "Ho registrato meteo, maestranze, lavorazioni e la fornitura dei blocchi. Dalle foto vedo le tamponature in corso al piano 2: le cito nelle lavorazioni, senza aggiungere quantità.",
        ),
        { tipo: "dati_raccolti", campi },
        testo(
          "Due cose prima della bozza:\n\n1. Che mezzi o attrezzature c'erano in cantiere?\n2. La protezione dei solai la riporto come disposizione verbale o ne facciamo un ordine di servizio formale?",
        ),
      ],
      titolo_conversazione: `Giornale ${oggiBreve()} · Lotto B`,
    };
  }
  return {
    parti: [
      testo("Fatto: tutti i campi obbligatori sono completi. Vuoi aggiungere visite o eventi in cantiere, oppure procedo con la bozza?"),
      azioni(["Genera bozza →", "Genera la bozza.", "primario"], ["Aggiungi annotazioni", "Aggiungi tra le annotazioni: ", "secondario", "scrivi"]),
    ],
    titolo_conversazione: "",
  };
}

const intestazioneLottoB = { sinistra: "Direzione Lavori · Ing. Marco Esempio", destra: "Via Tiburtina 410, Roma" };

function giornaleBozza() {
  return {
    parti: [
      testo("Ecco la bozza. Ho riportato la fornitura come accettata dalla DL e la protezione dei solai come disposizione verbale."),
      {
        tipo: "documento",
        documento: {
          tipo_documento: "giornale_lavori",
          titolo: `Giornale dei lavori — ${oggi()}`,
          sottotitolo: "",
          intestazione: intestazioneLottoB,
          stati: [],
          dati_generali: {
            colonne: 2,
            campi: [
              { etichetta: "Lavori", valore: "Ristrutturazione edificio residenziale — Lotto B", intera_riga: false },
              { etichetta: "Committente", valore: "Immobiliare Esempio S.r.l.", intera_riga: false },
              { etichetta: "Impresa esecutrice", valore: "Edilnova S.r.l.", intera_riga: false },
              { etichetta: "CSE", valore: "Geom. Laura Esempio", intera_riga: false },
              { etichetta: "Contratto", valore: "Appalto del 12/03/2026", intera_riga: false },
              { etichetta: "Registrazione", valore: oggi(), intera_riga: false },
            ],
          },
          sezioni: [
            { titolo: "Condizioni meteo", blocchi: [{ tipo: "paragrafo", testo: "Pioggia dalle prime ore fino alle 11:00 circa; sereno nel resto della giornata." }] },
            {
              titolo: "Maestranze presenti",
              blocchi: [
                {
                  tipo: "tabella",
                  intestazione: ["Impresa", "Qualifica", "N."],
                  allineamento: ["sinistra", "sinistra", "destra"],
                  righe: [
                    ["Edilnova S.r.l.", "Muratore", "2"],
                    ["Edilnova S.r.l.", "Manovale", "1"],
                    ["Termica Sud", "Idraulico", "1"],
                  ],
                  totale: ["Totale", "", "4"],
                },
              ],
            },
            { titolo: "Mezzi e attrezzature", blocchi: [{ tipo: "paragrafo", testo: "Betoniera; montacarichi." }] },
            {
              titolo: "Lavorazioni eseguite",
              blocchi: [
                {
                  tipo: "elenco",
                  numerato: false,
                  voci: ["Ripresa delle tamponature al piano secondo, lato nord.", "Posa delle tubazioni di scarico dei bagni al piano primo."],
                },
              ],
            },
            {
              titolo: "Forniture e accettazione materiali",
              blocchi: [
                {
                  tipo: "paragrafo",
                  testo: "Pervenuti in cantiere n. 2 bancali di blocchi in laterizio alveolato tipo Poroton, spessore 30 cm, accettati dalla Direzione Lavori.",
                },
              ],
            },
            {
              titolo: "Disposizioni del Direttore dei Lavori",
              blocchi: [{ tipo: "paragrafo", testo: "Impartita disposizione verbale al capocantiere di proteggere i solai dagli agenti atmosferici." }],
            },
            { titolo: "Eventi e annotazioni", blocchi: [{ tipo: "paragrafo", testo: "[da completare]" }] },
          ],
          formula_chiusura: "",
          firme: [
            { ruolo: "Il Direttore dei Lavori", nome: "Ing. Marco Esempio" },
            { ruolo: "Per l'Impresa", nome: "Edilnova S.r.l." },
          ],
        },
      },
      testo("Controlla la bozza e firmala. Se serve una modifica, scrivimela qui."),
    ],
    titolo_conversazione: "",
  };
}

function fotoProposte(n: number) {
  const f = (i: number) => `F${i}`;
  return {
    parti: [
      testo(`Ho guardato le ${n} foto. Ecco cosa vedo:`),
      {
        tipo: "foto_osservate",
        osservazioni: [
          { foto: [f(1), f(2)].slice(0, Math.min(2, n)), descrizione: "Tamponature in blocchi di laterizio in corso, piano 2 lato nord.", attenzione: false, etichetta: "" },
          ...(n >= 3 ? [{ foto: [f(3)], descrizione: "Bancali di blocchi ancora imballati a piè d'opera.", attenzione: false, etichetta: "" }] : []),
          ...(n >= 4 ? [{ foto: [f(4)], descrizione: "Tubazioni di scarico a vista in un bagno, probabilmente al piano 1.", attenzione: false, etichetta: "" }] : []),
          ...(n >= 5 ? [{ foto: [f(5)], descrizione: "Solaio senza protezione, con acqua ristagnante sulla superficie.", attenzione: true, etichetta: "Ristagni" }] : []),
          ...(n >= 6 ? [{ foto: [f(6)], descrizione: "Sul ponteggio lato est sembra mancare un tratto di parapetto. Da verificare sul posto.", attenzione: true, etichetta: "Parapetto" }] : []),
        ],
      },
      testo("Posso preparare queste bozze. Scegli da quale partire:"),
      {
        tipo: "proposte_bozze",
        proposte: [
          {
            tipo_documento: "giornale_lavori",
            titolo: "Giornale dei lavori",
            badge: "consigliata",
            foto: `F1–F${Math.min(n, 4)}`,
            sintesi: "Lavorazioni e forniture dalle foto. Mi mancano meteo e maestranze presenti.",
            campi_compilati: 4,
            campi_obbligatori: 7,
            messaggio: "Prepara la bozza del giornale dei lavori dalle foto.",
          },
          {
            tipo_documento: "non_conformita",
            titolo: "Rapporto di non conformità",
            badge: "da_confermare",
            foto: "F5",
            sintesi: "Solaio esposto alla pioggia con ristagni, nonostante la disposizione di proteggerlo.",
            campi_compilati: 3,
            campi_obbligatori: 6,
            messaggio: "Prepara il rapporto di non conformità sul solaio di F5.",
          },
          {
            tipo_documento: "segnalazione_cse",
            titolo: "Segnalazione al CSE",
            badge: "sicurezza",
            foto: "F6",
            sintesi: "Possibile parapetto mancante sul ponteggio lato est, da verificare con il coordinatore.",
            campi_compilati: 2,
            campi_obbligatori: 4,
            messaggio: "Prepara la segnalazione al CSE per il parapetto di F6.",
          },
        ],
      },
      testo("Dalle foto ricavo solo ciò che si vede. Imprese, quantità e nomi li chiedo a te prima di scriverli."),
      azioni(
        ["Prepara tutte e tre", "Prepara tutte e tre le bozze.", "suggerimento"],
        ["Correggi cosa vedo", "Correzione sulle foto: ", "suggerimento", "scrivi"],
        ["Altro tipo di report", "Vorrei un altro tipo di report: ", "suggerimento", "scrivi"],
      ),
    ],
    titolo_conversazione: `Foto ${oggiBreve()} · ${n} immagini`,
  };
}

function misure() {
  return {
    parti: [
      testo("Ecco le righe di misura:"),
      {
        tipo: "righe_misura",
        unita: "m²",
        righe: [
          { descrizione: "Campata A", fattori: [8.4, 6.2], deduzione: false },
          { descrizione: "Campata B", fattori: [7.1, 6.2], deduzione: false },
          { descrizione: "A dedurre vano scala", fattori: [2.8, 4.5], deduzione: true },
        ],
      },
      testo("A quale voce del computo la associo? Propongo «Solaio in latero-cemento h 20+4»."),
      azioni(["Sì, quella voce", "Sì, associala a quella voce.", "primario"], ["Scegli voce", "Associala alla voce: ", "secondario", "scrivi"]),
    ],
    titolo_conversazione: "Libretto misure · solaio P2",
  };
}

const VOCI_SAL = [
  { tariffa: "A.01", descrizione: "Demolizioni e rimozioni", um: "m³", quantita: 96, prezzo: 85 },
  { tariffa: "A.04", descrizione: "Scavo a sezione obbligata", um: "m³", quantita: 214.5, prezzo: 18.4 },
  { tariffa: "B.02", descrizione: "Calcestruzzo C28/35 per fondazioni e rinforzi", um: "m³", quantita: 132.6, prezzo: 152 },
  { tariffa: "B.05", descrizione: "Acciaio B450C in barre", um: "kg", quantita: 11480, prezzo: 1.42 },
  { tariffa: "B.09", descrizione: "Incamiciatura pilastri in c.a.", um: "cad", quantita: 18, prezzo: 1240 },
  { tariffa: "C.03", descrizione: "Rinforzo travi con sistema FRCM", um: "m²", quantita: 146, prezzo: 168 },
];

function salDaCalcolo(r: Record<string, any>) {
  const intestazione = { sinistra: "Comune di Esempio · Settore Lavori Pubblici", destra: "D.Lgs. 36/2023 · All. II.14" };
  return {
    parti: [
      testo("Ecco il SAL n. 3. Ho preso le quantità dal libretto delle misure e i prezzi dall'elenco prezzi contrattuale."),
      {
        tipo: "documento",
        documento: {
          tipo_documento: "sal",
          titolo: "Stato di avanzamento lavori n. 3",
          sottotitolo: "Lavori eseguiti a tutto il 20/10/2026",
          intestazione,
          stati: [],
          dati_generali: {
            colonne: 3,
            campi: [
              { etichetta: "Lavori", valore: "Adeguamento sismico della Scuola secondaria «D. Alighieri»", intera_riga: true },
              { etichetta: "Esecutore", valore: "Costruzioni Esempio S.p.A.", intera_riga: false },
              { etichetta: "Contratto", valore: "Rep. n. 1452 del 03/06/2026", intera_riga: false },
              { etichetta: "CIG · CUP", valore: "[CIG] · [CUP]", intera_riga: false },
              { etichetta: "Importo contrattuale", valore: "€ 412.600,00", intera_riga: false },
              { etichetta: "Ribasso d'asta", valore: "12,350%", intera_riga: false },
              { etichetta: "Avanzamento economico", valore: "21,3%", intera_riga: false },
            ],
          },
          sezioni: [
            {
              titolo: "Riepilogo delle lavorazioni",
              blocchi: [
                {
                  tipo: "tabella",
                  intestazione: ["N.", "Tariffa", "Descrizione", "U.M.", "Quantità", "Prezzo €", "Importo €"],
                  allineamento: ["sinistra", "sinistra", "sinistra", "sinistra", "destra", "destra", "destra"],
                  righe: VOCI_SAL.map((v, i) => [
                    String(i + 1),
                    v.tariffa,
                    v.descrizione,
                    v.um,
                    r.voci[i].quantita,
                    r.voci[i].prezzo,
                    r.voci[i].importo,
                  ]),
                  totale: ["Importo lavori eseguiti a tutto il presente SAL", "", "", "", "", "", r.importo_lavori.replace("€ ", "")],
                },
              ],
            },
            {
              titolo: "Calcolo dell'acconto",
              blocchi: [
                {
                  tipo: "riepilogo",
                  righe: [
                    { etichetta: "Importo lavori eseguiti", valore: r.importo_lavori, stile: "normale" },
                    { etichetta: "A dedurre ribasso d'asta 12,350%", valore: `− ${r.ribasso}`, stile: "normale" },
                    { etichetta: "Importo netto dei lavori", valore: r.netto_lavori, stile: "normale" },
                    { etichetta: "Oneri della sicurezza maturati, non soggetti a ribasso", valore: r.oneri_sicurezza, stile: "normale" },
                    { etichetta: "Totale a tutto il presente SAL", valore: r.totale_progressivo, stile: "totale" },
                    { etichetta: "A dedurre ritenuta 0,50%", valore: `− ${r.ritenuta}`, stile: "normale" },
                    { etichetta: "A dedurre acconti precedenti (SAL 1 e 2)", valore: `− ${r.acconti_precedenti}`, stile: "normale" },
                    { etichetta: "Recupero anticipazione", valore: "[da completare]", stile: "attenzione" },
                    { etichetta: "Importo del presente acconto", valore: r.importo_acconto, stile: "finale" },
                  ],
                  nota: "Importi IVA esclusa. L'IVA è applicata in fattura, sul certificato di pagamento.",
                },
              ],
            },
            {
              titolo: "Trasmissione",
              blocchi: [{ tipo: "paragrafo", testo: "Il presente SAL è trasmesso al RUP per l'emissione del certificato di pagamento." }],
            },
          ],
          formula_chiusura: "",
          firme: [
            { ruolo: "Il Direttore dei Lavori", nome: "Ing. Marco Esempio" },
            { ruolo: "L'esecutore, per accettazione", nome: "Costruzioni Esempio S.p.A." },
          ],
        },
      },
      {
        tipo: "controlli",
        titolo: "Controlli sui calcoli",
        voci: [
          { testo: "6 voci, quantità uguali al libretto delle misure", esito: "ok" },
          { testo: "Ribasso 12,350% solo sui lavori, non sugli oneri della sicurezza", esito: "ok" },
          { testo: "Ritenuta 0,50% sull'importo progressivo", esito: "ok" },
          { testo: "Recupero dell'anticipazione: non lo trovo nel contratto. È stata erogata?", esito: "attenzione" },
        ],
      },
      testo("Dopo la firma lo trasmetto al RUP per il certificato di pagamento."),
    ],
    titolo_conversazione: "SAL n. 3 · al 20/10/2026",
  };
}

function nonConformita() {
  return {
    parti: [
      testo("Ecco il rapporto. Ho collegato le misure ai due pilastri e richiamato la tavola strutturale."),
      {
        tipo: "documento",
        documento: {
          tipo_documento: "non_conformita",
          titolo: "Rapporto di non conformità n. 3",
          sottotitolo: "Emesso il 27/10/2026 · rif. Verbale di sopralluogo n. 7",
          intestazione: { sinistra: "Comune di Esempio · Settore Lavori Pubblici", destra: "Direzione Lavori" },
          stati: [
            { testo: "Aperta", stile: "pieno" },
            { testo: "Maggiore", stile: "bordo" },
          ],
          dati_generali: { colonne: 2, campi: [] },
          sezioni: [
            {
              titolo: "1 · Identificazione",
              blocchi: [
                {
                  tipo: "campi",
                  colonne: 2,
                  da_compilare: false,
                  campi: [
                    { etichetta: "Lavorazione", valore: "Incamiciatura pilastri in c.a. (voce B.09)" },
                    { etichetta: "Elementi", valore: "Pilastri P14, P15 · piano terra, corpo B" },
                    { etichetta: "Data del getto", valore: "24/10/2026" },
                    { etichetta: "Rilevata da", valore: "Direttore dei Lavori, sopralluogo del 27/10/2026" },
                  ],
                },
              ],
            },
            {
              titolo: "2 · Requisito di riferimento",
              blocchi: [
                {
                  tipo: "elenco",
                  numerato: false,
                  voci: [
                    "Progetto esecutivo strutturale, tav. S-05: copriferro minimo 30 mm.",
                    "Capitolato speciale d'appalto, art. [da completare]",
                  ],
                },
              ],
            },
            {
              titolo: "3 · Descrizione e evidenze",
              blocchi: [
                {
                  tipo: "paragrafo",
                  testo: "Al disarmo dei pilastri P14 e P15 il copriferro misurato con pacometro risulta compreso tra 12 e 16 mm, inferiore al minimo di progetto.",
                },
                {
                  tipo: "tabella",
                  intestazione: ["Pilastro", "Misura", "Rilevato", "Progetto"],
                  allineamento: ["sinistra", "sinistra", "destra", "destra"],
                  righe: [
                    ["P14", "1", "!14 mm", "30 mm"],
                    ["P14", "2", "!12 mm", "30 mm"],
                    ["P15", "1", "!16 mm", "30 mm"],
                    ["P15", "2", "!15 mm", "30 mm"],
                  ],
                  totale: [],
                },
              ],
            },
            {
              titolo: "4 · Classificazione e trattamento immediato",
              blocchi: [
                {
                  tipo: "paragrafo",
                  testo: "Non conformità **maggiore**: incide sulla durabilità di elementi strutturali. Sono sospesi i getti dei pilastri P16–P18 fino alla verifica in contraddittorio di casseri e distanziatori.",
                },
              ],
            },
            {
              titolo: "5 · Azione correttiva richiesta",
              blocchi: [
                {
                  tipo: "elenco",
                  numerato: true,
                  voci: [
                    "L'esecutore presenta entro il 31/10/2026 una proposta di intervento di ripristino su P14 e P15, da sottoporre al progettista strutturale e alla DL.",
                    "Prima dei getti di P16–P18, l'esecutore dimostra la corretta posa dei distanziatori.",
                    "Gli oneri dell'intervento sono a carico dell'esecutore.",
                  ],
                },
              ],
            },
            {
              titolo: "6 · Verifica di chiusura",
              blocchi: [
                {
                  tipo: "campi",
                  colonne: 3,
                  da_compilare: true,
                  campi: [
                    { etichetta: "Data verifica", valore: "" },
                    { etichetta: "Esito", valore: "" },
                    { etichetta: "NC chiusa il", valore: "" },
                  ],
                },
              ],
            },
          ],
          formula_chiusura: "",
          firme: [
            { ruolo: "Il Direttore dei Lavori", nome: "Ing. Marco Esempio" },
            { ruolo: "L'esecutore, per presa visione", nome: "Costruzioni Esempio S.p.A." },
          ],
        },
      },
      testo("Ho classificato la NC come maggiore perché incide sulla durabilità di elementi strutturali. Confermi, o la vuoi minore?"),
      azioni(["Confermo maggiore", "Confermo: non conformità maggiore.", "primario"], ["Cambia in minore", "Cambiala in non conformità minore.", "secondario"]),
    ],
    titolo_conversazione: "NC pilastri P14–P15",
  };
}

function sopralluogo() {
  const presenti = [
    ["Ing. Marco Esempio", "Direttore dei Lavori"],
    ["Geom. Laura Esempio", "Coordinatore sicurezza in esecuzione"],
    ["Ing. Luca Esempio", "Direttore tecnico, Costruzioni Esempio S.p.A."],
    ["Sig. Paolo Esempio", "Capocantiere"],
  ];
  return {
    parti: [
      testo("Ecco il verbale. Ho trasformato le tue osservazioni in constatazioni numerate e in prescrizioni con responsabile e termine."),
      {
        tipo: "documento",
        documento: {
          tipo_documento: "verbale_sopralluogo",
          titolo: "Verbale di sopralluogo n. 7",
          sottotitolo: "27/10/2026, ore 10:00 · Cantiere, corpo B",
          intestazione: { sinistra: "Comune di Esempio · Settore Lavori Pubblici", destra: "Direzione Lavori" },
          stati: [],
          dati_generali: {
            colonne: 2,
            campi: [
              { etichetta: "Lavori", valore: "Adeguamento sismico della Scuola secondaria «D. Alighieri»", intera_riga: true },
              { etichetta: "Stazione appaltante", valore: "Comune di Esempio · RUP Arch. Paola Esempio", intera_riga: false },
              { etichetta: "Esecutore", valore: "Costruzioni Esempio S.p.A.", intera_riga: false },
              { etichetta: "Contratto", valore: "Rep. n. 1452 del 03/06/2026", intera_riga: false },
              { etichetta: "CIG · CUP", valore: "[CIG] · [CUP]", intera_riga: false },
            ],
          },
          sezioni: [
            { titolo: "Presenti", blocchi: [{ tipo: "tabella", intestazione: [], allineamento: ["sinistra", "sinistra"], righe: presenti, totale: [] }] },
            { titolo: "Oggetto", blocchi: [{ tipo: "paragrafo", testo: "Verifica dell'avanzamento delle incamiciature dei pilastri al piano terra e dello stato dei ponteggi del corpo B." }] },
            {
              titolo: "Constatazioni",
              blocchi: [
                {
                  tipo: "elenco",
                  numerato: true,
                  voci: [
                    "Risultano completate le incamiciature dei pilastri P1–P12 al piano terra; sono in corso quelle dei pilastri P13–P18.",
                    "Sui pilastri P14 e P15, gettati il 24/10/2026, si rileva un copriferro inferiore a quello di progetto.",
                    "Sul ponteggio lato est risulta rimosso un tratto di parapetto in corrispondenza del montacarichi.",
                  ],
                },
              ],
            },
            {
              titolo: "Prescrizioni",
              blocchi: [
                {
                  tipo: "tabella",
                  intestazione: ["N.", "Prescrizione", "A carico", "Termine"],
                  allineamento: ["sinistra", "sinistra", "sinistra", "sinistra"],
                  righe: [
                    ["1", "Ripristinare il parapetto del ponteggio lato est. Si informa il CSE.", "Esecutore", "!Immediato"],
                    ["2", "Trasmettere i certificati dei prelievi di calcestruzzo del getto del 24/10/2026.", "Esecutore", "03/11/2026"],
                  ],
                  totale: [],
                },
              ],
            },
            { titolo: "Osservazioni dell'esecutore", blocchi: [{ tipo: "paragrafo", testo: "[da completare]" }] },
          ],
          formula_chiusura: "Letto, confermato e sottoscritto.",
          firme: [
            { ruolo: "Il Direttore dei Lavori", nome: "Ing. M. Esempio" },
            { ruolo: "Il CSE", nome: "Geom. L. Esempio" },
            { ruolo: "Per l'esecutore", nome: "Ing. L. Esempio" },
          ],
        },
      },
      {
        tipo: "da_decidere",
        titolo: "Due cose da decidere",
        punti: [
          "Il parapetto è un tema di sicurezza: lo segnalo anche al CSE con una comunicazione a parte?",
          "Per P14–P15 apro il Rapporto di non conformità n. 3 e lo richiamo nel verbale?",
        ],
      },
      azioni(["Apri NC n. 3 →", "Apri la NC n. 3 su P14–P15 e richiamala nel verbale.", "primario"], ["Segnala al CSE", "Prepara la segnalazione al CSE per il parapetto.", "secondario"]),
    ],
    titolo_conversazione: "Sopralluogo n. 7 · corpo B",
  };
}

// ---------------------------------------------------------------------------
// Residenze Incanto: risposte preparate guardando le 5 riprese del primo orizzontamento
// (19 e 23/10/2026) e i file NowVision. Usate solo per quelle riprese.

function incantoConfronto() {
  return {
    parti: [
      testo(
        "Ho guardato le 5 riprese del primo orizzontamento (19 e 23 ottobre) e le ho confrontate con cronoprogramma e computo. Parto dal misurato dall'IA di NowVision: nella zona risulta misurato il **78,5%** dell'importo (€ 160.520,15 su € 204.566,25).",
      ),
      {
        tipo: "confronto_programma",
        data_riferimento: "23/10/2026",
        righe: [
          {
            wbs: "3.0",
            attivita: "Strutture in elevazione",
            previsto: "dal 05/10/2026 al 08/03/2027 · atteso 12% al 23/10",
            registrato: "Elevazioni piano terra, setti e pilastri: 100% (25 mc). Solaio del piano terra ed elevazioni del piano primo: 0%.",
            osservato: "Il 19/10 getto in corso: autopompa e casseri metallici ancora sui setti (F1). Il 23/10 setti e pilastri scasserati, con i ferri di ripresa per il piano primo (F2, F3, F4). Nessun impalcato per il solaio del piano terra.",
            voci_computo: ["Articolo 20 a", "Articolo 21 a", "Articolo 25 a"],
            esito: "in_linea",
          },
          {
            wbs: "4.0",
            attivita: "Tamponature, tramezzi, monoblocchi e soglie",
            previsto: "dal 23/11/2026 al 29/03/2027 · atteso 0% al 23/10",
            registrato: "Murature perimetrali in Poroton P600 piano terra: 20% (14,67 di 73,35 mc). Tramezze interne: 1,36%.",
            osservato: "Murature perimetrali in blocchi di laterizio in corso su più lati, con guide in legno (F4, F5). Bancali di blocchi imballati sulla soletta (F2, F3).",
            voci_computo: ["Articolo 23 a", "Articolo 37 a"],
            esito: "in_anticipo",
          },
          {
            wbs: "2.0",
            attivita: "Opere interrate e rinterri",
            previsto: "dal 25/05/2026 al 22/02/2027 · atteso 55% al 23/10",
            registrato: "Solaio di copertura del piano interrato e travi: 100%. Guaine di protezione della soletta: 0%. Pannello XPS verso l'autorimessa: 45%.",
            osservato: "La soletta di copertura dell'interrato è completata: è il piano di lavoro di tutte le riprese. Le guaine non si vedono.",
            voci_computo: ["Articolo 16 a", "Articolo 16 b", "Articolo 17 a", "Articolo 18 d", "Articolo 39 a"],
            esito: "in_linea",
          },
        ],
      },
      testo(
        "Le murature perimetrali sono partite circa un mese prima del previsto e prima del solaio del piano terra. Può essere una scelta dell'impresa: va confermata.",
      ),
      {
        tipo: "foto_osservate",
        osservazioni: [
          {
            foto: ["F1"],
            descrizione: "Una persona senza casco sulla soletta, chinata sulle tavole di progetto, mentre l'autopompa è in funzione.",
            attenzione: true,
            etichetta: "Senza casco",
          },
          {
            foto: ["F4"],
            descrizione: "Sembra esserci una persona in quota sulla sommità dei setti in fondo, senza protezioni visibili. Da verificare sul posto.",
            attenzione: true,
            etichetta: "In quota",
          },
          {
            foto: ["F1"],
            descrizione: "Acqua ristagnante sulla soletta di copertura dell'interrato, non ancora protetta dalla guaina.",
            attenzione: false,
            etichetta: "",
          },
        ],
      },
      testo("Il cronoprogramma non ha ancora le date effettive: posso proportele partendo dal misurato. Da dove partiamo?"),
      {
        tipo: "proposte_bozze",
        proposte: [
          {
            tipo_documento: "report_avanzamento",
            titolo: "Report di avanzamento al 23/10",
            badge: "consigliata",
            foto: "F1–F5",
            sintesi: "Previsto, misurato e visto nelle riprese, con le date effettive da registrare nel cronoprogramma.",
            campi_compilati: 3,
            campi_obbligatori: 4,
            messaggio: "Prepara il report di avanzamento al 23/10.",
          },
          {
            tipo_documento: "giornale_lavori",
            titolo: "Giornale dei lavori del 23/10",
            badge: "nessuno",
            foto: "F2–F5",
            sintesi: "Lavorazioni viste nelle riprese. Mi mancano imprese, maestranze e mezzi presenti.",
            campi_compilati: 3,
            campi_obbligatori: 7,
            messaggio: "Prepara il giornale dei lavori del 23/10 dalle riprese.",
          },
          {
            tipo_documento: "segnalazione_cse",
            titolo: "Segnalazione al CSE",
            badge: "sicurezza",
            foto: "F1, F4",
            sintesi: "Persona senza casco durante il getto e possibile lavoro in quota senza protezioni.",
            campi_compilati: 2,
            campi_obbligatori: 4,
            messaggio: "Prepara la segnalazione al CSE per F1 e F4.",
          },
        ],
      },
      azioni(
        ["Proponi le date effettive", "Proponimi le date effettive da registrare nel cronoprogramma.", "suggerimento"],
        ["Correggi cosa vedo", "Correzione sulle riprese: ", "suggerimento", "scrivi"],
      ),
    ],
    titolo_conversazione: "Riprese 23/10 · Primo orizzontamento",
  };
}

function incantoReport() {
  const riga = (codice: string, voce: string, previsto: string, misurato: string, visto: string) => [codice, voce, previsto, misurato, visto];
  return {
    parti: [
      testo(
        "Ecco il report al 23/10. Le percentuali sono quelle misurate da NowVision; dalle riprese ho aggiunto solo lo stato visibile.",
      ),
      {
        tipo: "documento",
        documento: {
          tipo_documento: "report_avanzamento",
          titolo: "Report di avanzamento al 23/10/2026",
          sottotitolo: "Primo orizzontamento · riprese 360° del 19 e 23/10/2026",
          intestazione: { sinistra: "Direzione Lavori · Residenze Incanto", destra: "Fonte: NowVision, riprese 360° e misurato IA" },
          stati: [],
          dati_generali: {
            colonne: 2,
            campi: [
              { etichetta: "Lavori", valore: "Residenze Incanto: 11 unità residenziali, piano interrato con autorimessa", intera_riga: true },
              { etichetta: "Progetto", valore: "Studio Fezzardi", intera_riga: false },
              { etichetta: "Committente", valore: "[da completare]", intera_riga: false },
              { etichetta: "Zona rilevata", valore: "Primo orizzontamento", intera_riga: false },
              { etichetta: "Misurato nella zona", valore: "€ 160.520,15 su € 204.566,25 (78,5%)", intera_riga: false },
            ],
          },
          sezioni: [
            {
              titolo: "1 · Avanzamento per lavorazione",
              blocchi: [
                {
                  tipo: "tabella",
                  intestazione: ["Art.", "Lavorazione", "Previsto", "Misurato IA", "Dalle riprese"],
                  allineamento: ["sinistra", "sinistra", "destra", "destra", "sinistra"],
                  righe: [
                    riga("16\u00a0a", "Solaio di copertura del piano interrato", "800,00 mq", "100%", "Completato: piano di lavoro di F1–F5"),
                    riga("20\u00a0a", "Elevazioni piano terra, setti e pilastri", "25,00 mc", "100%", "Getto in corso il 19/10 (F1), scasserati il 23/10 (F2–F4)"),
                    riga("23\u00a0a", "Murature perimetrali Poroton P600 piano terra", "73,35 mc", "20%", "In corso su più lati (F4, F5)"),
                    riga("39\u00a0a", "Pannello XPS piano terra verso autorimessa", "350,00 mq", "45%", "Non visibile nelle riprese"),
                    riga("17\u00a0a", "Guaina di protezione della soletta", "880,00 mq", "0%", "Non visibile"),
                    riga("21\u00a0a", "Soletta di copertura del piano terra", "410,00 mq", "0%", "Non avviata: nessun impalcato"),
                  ],
                  totale: [],
                },
              ],
            },
            {
              titolo: "2 · Confronto con il cronoprogramma",
              blocchi: [
                {
                  tipo: "tabella",
                  intestazione: ["WBS", "Attività", "Previsto", "Atteso al 23/10", "Stato"],
                  allineamento: ["sinistra", "sinistra", "sinistra", "destra", "sinistra"],
                  righe: [
                    ["2.0", "Opere interrate e rinterri", "25/05/2026 – 22/02/2027", "55%", "In linea: copertura dell'interrato completata"],
                    ["3.0", "Strutture in elevazione", "05/10/2026 – 08/03/2027", "12%", "In linea: piano terra completato tra il 19 e il 23/10"],
                    ["4.0", "Tamponature, tramezzi, monoblocchi e soglie", "23/11/2026 – 29/03/2027", "0%", "!In anticipo: murature perimetrali avviate (20%)"],
                  ],
                  totale: [],
                },
              ],
            },
            {
              titolo: "3 · Date effettive da registrare nel cronoprogramma",
              blocchi: [
                {
                  tipo: "elenco",
                  numerato: false,
                  voci: [
                    "1.0 Accantieramento, scavi e opere provvisionali: scavo di sbancamento misurato al 100%; fine effettiva [da completare].",
                    "3.0 Strutture in elevazione: inizio effettivo [da completare]; getti del piano terra in corso il 19/10/2026 e conclusi entro il 23/10/2026.",
                    "4.0 Tamponature, tramezzi, monoblocchi e soglie: inizio effettivo entro il 23/10/2026; data esatta [da completare].",
                  ],
                },
              ],
            },
            {
              titolo: "4 · Criticità e punti da verificare",
              blocchi: [
                {
                  tipo: "elenco",
                  numerato: false,
                  voci: [
                    "Murature perimetrali avviate prima del solaio di copertura del piano terra e circa un mese prima del previsto: verificare che la sequenza sia concordata con progettista e impresa.",
                    "Guaina di protezione della soletta di copertura dell'interrato (Art. 17 a) a 0%; il 19/10 si vede acqua ristagnante sulla soletta (F1).",
                    "Sicurezza: persona senza casco durante il getto (F1) e possibile lavoro in quota sulla sommità dei setti senza protezioni visibili (F4). Da segnalare al CSE.",
                  ],
                },
              ],
            },
            {
              titolo: "5 · Prossime lavorazioni",
              blocchi: [
                {
                  tipo: "paragrafo",
                  testo: "Secondo computo e cronoprogramma seguono la soletta di copertura del piano terra in latero-cemento (Art. 21 a) e le elevazioni del piano primo (Art. 25 a). Date concordate con l'impresa: [da completare].",
                },
              ],
            },
            {
              titolo: "6 · Fonti",
              blocchi: [
                {
                  tipo: "paragrafo",
                  testo: "Le percentuali sono quelle misurate dall'IA della piattaforma NowVision; le riprese confermano lo stato in modo qualitativo. Le quantità per la contabilità vanno verificate nel libretto delle misure.",
                },
              ],
            },
          ],
          formula_chiusura: "",
          firme: [{ ruolo: "Il Direttore dei Lavori", nome: "[da completare]" }],
        },
      },
      testo("Prima di firmarlo controlla le date effettive: dove le riprese non bastano le ho lasciate da completare."),
    ],
    titolo_conversazione: "",
  };
}

function generico(tipo: string) {
  return {
    parti: [
      testo(`Questa è una risposta di prova del server finto per «${tipo}». Con una chiave API vera il Redattore raccoglie i dati e prepara la bozza.`),
      azioni(["Mostrami un giornale dei lavori", "Genera la bozza.", "secondario"]),
    ],
    titolo_conversazione: "",
  };
}

// ---------------------------------------------------------------------------

function testi(m: Messaggio): string[] {
  if (typeof m.content === "string") return [m.content];
  return m.content.filter((b) => b.type === "text").map((b) => String(b.text));
}

createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
    res.writeHead(404).end();
    return;
  }
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    const richiesta = JSON.parse(corpo) as { messages: Messaggio[] };
    const messaggi = richiesta.messages;
    const ultimo = messaggi.at(-1)!;
    const blocchi = typeof ultimo.content === "string" ? [] : ultimo.content;

    const risultato = blocchi.find((b) => b.type === "tool_result");
    if (risultato) {
      void rispondi(res, { json: salDaCalcolo(JSON.parse(String(risultato.content))) });
      return;
    }

    const tuttiITesti = messaggi.filter((m) => m.role === "user").flatMap(testi).join("\n");
    const tipo = /Documento scelto dal DL: ([^.\]]+)/.exec(tuttiITesti)?.[1] ?? "";
    const daFoto = tuttiITesti.includes("Bozze dalle foto");
    const ultimoTesto = testi(ultimo).at(-1) ?? "";
    const immagini = messaggi.flatMap((m) => (typeof m.content === "string" ? [] : m.content)).filter((b) => b.type === "image").length;
    const turniDL = messaggi.filter((m) => m.role === "user" && testi(m).length > 0).length;

    // Le 5 riprese di Residenze Incanto hanno risposte preparate; per tutte le altre il copione non vale.
    const riprese = messaggi
      .filter((m) => m.role === "user")
      .flatMap(testi)
      .filter((t) => t.includes("ripresa 360° NowVision"));
    const incanto =
      riprese.length === 5 &&
      riprese.every((t) => t.includes("zona Primo orizzontamento")) &&
      riprese.filter((t) => t.endsWith("19/10/2026")).length === 1 &&
      riprese.filter((t) => t.endsWith("23/10/2026")).length === 4;
    const ripreseOra = testi(ultimo).some((t) => t.includes("ripresa 360° NowVision"));
    if (incanto && ripreseOra) {
      void rispondi(res, { json: incantoConfronto() });
      return;
    }
    if (incanto && /report di avanzamento/i.test(ultimoTesto)) {
      void rispondi(res, { json: incantoReport() });
      return;
    }
    if (incanto) {
      void rispondi(res, {
        json: {
          parti: [
            testo(
              "In modalità demo, per queste riprese ho preparato solo il confronto e il report di avanzamento. Con la chiave API il Redattore risponde a tutto il resto.",
            ),
            azioni(["Prepara il report di avanzamento", "Prepara il report di avanzamento al 23/10.", "secondario"]),
          ],
          titolo_conversazione: "",
        },
      });
      return;
    }
    if (ripreseOra) {
      // Le risposte del copione sono scritte per altre foto: sulle riprese vere servirebbero risposte inventate.
      void rispondi(res, {
        json: {
          parti: [
            testo(
              "In modalità demo non analizzo le riprese NowVision: le risposte di questa modalità sono scritte in anticipo e non corrisponderebbero alle tue immagini. Avvia il Redattore con una chiave API (`npm run dev`) per il confronto vero con cronoprogramma e computo.",
            ),
          ],
          titolo_conversazione: "",
        },
      });
      return;
    }
    const haBozza = messaggi.some((m) => m.role === "assistant" && JSON.stringify(m.content).includes('\\"tipo\\":\\"documento\\"'));
    if (haBozza && tipo.startsWith("Giornale")) {
      const bozza = giornaleBozza() as any;
      const eventi = bozza.parti[1].documento.sezioni.at(-1);
      eventi.blocchi = [{ tipo: "paragrafo", testo: "Presente in cantiere il Coordinatore per la sicurezza in fase di esecuzione, Geom. Laura Esempio." }];
      bozza.parti[0] = testo("Ho aggiunto la presenza del CSE tra gli eventi e annotazioni. Il resto è invariato.");
      void rispondi(res, { json: bozza });
    } else if (/bozza|genera|procedi/i.test(ultimoTesto) && (tipo.startsWith("Giornale") || daFoto)) {
      void rispondi(res, { json: giornaleBozza() });
    } else if (daFoto && immagini > 0) {
      void rispondi(res, { json: fotoProposte(immagini) });
    } else if (tipo.startsWith("Stato di avanzamento")) {
      void rispondi(res, {
        strumento: {
          nome: "calcola_sal",
          input: {
            voci: VOCI_SAL,
            ribasso_percentuale: 12.35,
            oneri_sicurezza: 4200,
            ritenuta_percentuale: 0.5,
            acconti_precedenti: 56320,
            recupero_anticipazione: null,
          },
        },
      });
    } else if (tipo.startsWith("Rapporto di non conformità")) {
      void rispondi(res, { json: nonConformita() });
    } else if (tipo.startsWith("Verbale di sopralluogo")) {
      void rispondi(res, { json: sopralluogo() });
    } else if (tipo.startsWith("Libretto")) {
      void rispondi(res, { json: misure() });
    } else if (tipo.startsWith("Giornale") || !tipo) {
      void rispondi(res, { json: giornaleRaccolta(turniDL > 1) });
    } else {
      void rispondi(res, { json: generico(tipo) });
    }
  });
}).listen(PORTA, () => console.log(`Claude finto su http://localhost:${PORTA}`));

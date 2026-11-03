# Redattore DL

Chat per il Direttore dei Lavori: racconti la giornata (scrivendo, dettando o mandando foto) e il Redattore prepara la bozza del documento di cantiere — giornale dei lavori, libretto delle misure, SAL, verbale di sopralluogo, ordine di servizio, rapporto di non conformità e altri. La bozza si apre nel pannello laterale, si corregge in chat o a mano, e si esporta. Verifica e firma restano del DL.

L'interfaccia implementa il design «Redattore DL — UI chat» (NowVision Design System): home, chat con raccolta dati, bozza nel pannello laterale, bozze dalle foto, layout mobile e i tre esempi di documento.

## Avvio

Serve Node.js 22 o successivo.

```bash
npm install
cp .env.example .env   # poi inserisci ANTHROPIC_API_KEY
npm run dev            # http://localhost:5173
```

Senza chiave API puoi provare tutta l'interfaccia con risposte di esempio prese dal design (nessun costo, nessuna chiamata esterna):

```bash
npm run demo
```

In produzione: `npm run build` e poi `npm start` (serve `REDATTORE_PASSWORD_ADMIN`, vedi sotto).

## Online: accessi e utilizzo

In sviluppo e in demo l'accesso è libero. Con `REDATTORE_PASSWORD_ADMIN` impostata (obbligatoria con `npm start`) si entra solo così:

- **Amministratore**: dalla schermata di accesso, «Sei l'amministratore?», con la password. Dal menu col proprio nome, in basso a sinistra, apre **Utilizzo e accessi**.
- **Persone invitate**: l'amministratore le aggiunge in Utilizzo e accessi (nome, studio, ruolo, cantieri che possono vedere, messaggi al giorno) e riceve un **link personale** da mandare. Chi lo apre entra con il suo nome, senza password. Il link si vede solo alla creazione: se si perde se ne crea uno nuovo e quello vecchio smette di funzionare. «Revoca l'accesso» chiude subito le sessioni aperte.
- Ognuno vede solo le proprie conversazioni e i cantieri assegnati; l'amministratore può aprire tutte le conversazioni dall'attività recente.

La pagina **Utilizzo e accessi** mostra per 7, 30 o 90 giorni: persone attive, report iniziati, messaggi, riprese 360° inviate, bozze generate, esportazioni e costo API stimato (dai token di ogni risposta ai prezzi di listino), i messaggi per giorno, una riga per persona con ultima attività e limite del giorno, e l'attività recente. «CSV» scarica tutto il registro.

Il registro è in `<REDATTORE_DATI>/eventi.jsonl`, persone e sessioni in `persone.json` e `sessioni.json` (codici e sessioni salvati solo come hash).

## Cantieri e documenti di progetto

- **Nuovo cantiere** (menu Cantieri o selettore del cantiere in home): nome, poi i documenti di progetto. Una casella per tipo: contratto o capitolato, computo, cronoprogramma, planimetrie, PSC, altro. Formati: PDF, xlsx, csv, JPG/PNG (le immagini grandi si riducono nel browser).
- **Lettura** in coda sul server (due documenti alla volta; dopo un riavvio riprende):
  - contratto, PSC, planimetrie e altri documenti: Claude (`REDATTORE_MODELLO`) estrae oggetto dei lavori, indirizzo, appalto, CIG/CUP, soggetti, importi, date, lavorazioni e ambienti, con pagina e certezza («letto» o «dedotto»);
  - computo e cronoprogramma, in qualsiasi formato: sempre letti dall'IA (`REDATTORE_MODELLO_TABELLE`, predefinito `claude-sonnet-5-5`), a blocchi di righe o di pagine. L'IA assegna a ogni voce una categoria di lavorazione, ricava la zona dalla descrizione quando manca una colonna (segnata come dedotta) e segnala le anomalie evidenti; i conti quantità × prezzo e le voci ripetute li controlla il codice;
  - export NowVision (xlsx): dopo la lettura dell'IA le colonne della piattaforma (misurato dall'IA, costo rilevato, affidabilità; date effettive e avanzamento) si riattaccano per codice WBS, i numeri delle celle prevalgono e le voci che l'IA avesse saltato si recuperano dal file.
  
  Alla fine una proposta di **zone** collega voci di computo e attività del programma, con le voci rimaste fuori e le scelte da fare.
- **Revisione e conferma in chat**: finita la lettura, «Rivediamo insieme in chat» apre una conversazione con il Redattore (una per persona e cantiere, che si riprende da dove era rimasta). Il Redattore dice cosa ha letto, chiede conferma dei valori dedotti, dei dati mancanti, delle anomalie del computo e delle zone, e aggiorna la scheda con gli strumenti `modifica_dati`, `modifica_soggetti`, `modifica_lavorazioni`, `modifica_zone`, `ignora_anomalie`, `rispondi_decisioni` e `riproponi_zone`, che passano dalla stessa validazione dei moduli. Ogni risposta elenca cosa ha cambiato («Scheda aggiornata»); accanto alla chat (su telefono dal pulsante in alto) un pannello mostra la scheda aggiornata, con i valori da verificare. Un documento mancante si allega in chat con la graffetta: il Redattore risponde dopo averlo letto, e le zone già riviste non vengono rifatte da sole. La scheda si conferma solo su richiesta esplicita (`conferma_scheda`, o «Conferma la scheda» nel pannello, che lo chiede in chat).
- **Dopo la conferma** il Redattore usa la scheda in ogni report: soggetti, contratto, lavorazioni e zone entrano nel prompt; computo e programma completi si consultano con gli strumenti `consulta_computo` e `consulta_programma`. Le conversazioni già aperte ricevono la scheda aggiornata al messaggio successivo. Nella pagina «Scheda del cantiere» restano i moduli per le correzioni a mano (con fonte e pagina di ogni valore, importi per categoria, anomalie da ignorare) e «Correggi in chat».
- **Nuova versione** di un documento (menu ⋯): si rilegge solo quello e si vedono le differenze rispetto alla versione precedente.
- **Archivio**: schede in `<REDATTORE_DATI>/cantieri/<id>/scheda.json`, originali in `documenti/`, dati letti in `estratti/`; computo e programma ricavati finiscono anche in `nowvision/<id>/` come dati NowVision, così il confronto con le riprese 360° li usa. Il costo di ogni lettura compare in «Utilizzo e accessi».
- **Esempi**: Lotto B e Scuola Alighieri si vedono solo in demo e in sviluppo. Residenze Incanto, se ha già dati NowVision caricati, diventa un cantiere vero al primo avvio.

## Documenti, PDF e firma

- **Documenti** (barra laterale, `#/documenti`): tutte le bozze e i documenti ultimati della persona, per mese, con filtri Tutti / Bozze / Ultimati, cantiere, tipo e ricerca. «Apri» porta alla conversazione con il pannello già sulla versione; «PDF» la scarica. L'amministratore può vedere i documenti di tutte le persone. In home, «Bozze da chiudere» mostra le ultime tre del cantiere.
- **Stato di una versione**: *bozza*; *definitivo* se l'utente preme «Segna come definitivo» (menu ⋯ del pannello, per chi firma su carta o con la firma digitale); *firmato* se l'utente ci appone la sua firma. Una modifica a mano o una nuova versione chiesta in chat torna bozza.
- **Firma** (Profilo, dal menu col proprio nome): firma grafica disegnata con dito o mouse oppure caricata da una scansione (lo sfondo chiaro diventa trasparente), con titolo, nome per esteso e iscrizione all'albo. Si appone solo con «Firma» su una versione, nel riquadro del proprio ruolo; il Redattore non firma mai da solo. Non è una firma digitale. Le immagini stanno in `<REDATTORE_DATI>/firme/` (per impronta del contenuto: chi rifà la firma non cambia i documenti già firmati), i dati in `firme.json`.
- **PDF**: generato dal server con Chromium (`puppeteer-core`) dallo stesso componente del foglio, con font e firme incorporati, numeri di pagina, JavaScript disattivato e rete bloccata. Chromium va indicato con `REDATTORE_CHROMIUM` (nell'immagine Docker è `/usr/bin/chromium`); senza, il PDF risponde 503 e resta «Stampa».

## Pubblicazione su Railway

Il modo più semplice è dal browser: su railway.com «New Project» → «Deploy from GitHub repo» → questo repository, poi **Variables** (`ANTHROPIC_API_KEY`, `REDATTORE_PASSWORD_ADMIN`), un **volume** montato su `/data` e **Generate Domain** in Settings → Networking. Ogni push su `main` si pubblica da solo.

L'immagine include Chromium per i PDF: pesa circa 300 MB in più e ogni PDF usa per qualche secondo 150–250 MB di memoria. Con piani da 512 MB di RAM il PDF può non riuscire.

In alternativa, dalla cartella del progetto sul tuo computer (serve Node.js):

```bash
npx @railway/cli login
npx @railway/cli init --name redattore-dl
npx @railway/cli add --service redattore-dl
npx @railway/cli volume add --service redattore-dl --mount-path /data
```

Poi, nel pannello di Railway (`npx @railway/cli open`), servizio **redattore-dl** → **Variables**, aggiungi `ANTHROPIC_API_KEY` e `REDATTORE_PASSWORD_ADMIN` (una password lunga, solo tua). Infine:

```bash
npx @railway/cli up --service redattore-dl --detach
npx @railway/cli domain --service redattore-dl
```

L'ultimo comando stampa l'indirizzo pubblico (`https://….up.railway.app`). Per gli aggiornamenti basta ripetere `up`.

I file in `.railwayignore` non vengono caricati (la chiave in `.env`, `node_modules`, i dati locali): i dati di esempio di Residenze Incanto (`esempi/nowvision/`) restano sul tuo computer. Online carichi computo, cronoprogramma e riprese dall'app («Dalle riprese 360°» → «Sostituisci» e «Aggiungi riprese»).

## Come funziona

- **Server** (`server/`): Express. Ogni messaggio del DL apre un turno in streaming (SSE) verso l'API Claude con l'SDK ufficiale `@anthropic-ai/sdk`.
- **Modello**: `claude-opus-5-5` con thinking adattivo e `effort: high` (modificabili con `REDATTORE_MODELLO` e `REDATTORE_SFORZO`).
- **Risposte strutturate**: il modello risponde con un JSON vincolato dallo schema in `shared/schema.ts` — un elenco di «parti» (testo, dati raccolti, foto osservate, proposte di bozza, controlli, decisioni, righe di misura, documento, pulsanti). Il server lo legge mentre arriva, così le schede e la bozza compaiono in tempo reale.
- **Calcoli**: il modello non fa conti a mente. Misure e importi del SAL passano dagli strumenti `calcola_misure` e `calcola_sal` (`shared/numeri.ts`), arrotondati al centesimo.
- **Fallback sui rifiuti**: le richieste attivano il fallback lato server (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`): se i classificatori di sicurezza bloccano per errore una richiesta legittima, l'API la ripete su un altro modello invece di restituire un rifiuto.
- **Cronologia**: le conversazioni sono salvate in `data/` (JSON e foto). La cronologia inviata all'API cresce solo in coda, così i blocchi di ragionamento restano validi e il prefisso resta in cache (`cache_control` automatico).
- **Foto**: ridimensionate nel browser (lato lungo 2000 px), numerate F1, F2… nella conversazione.
- **Dettatura**: Web Speech API del browser (Chrome, Edge, Safari).
- **Esportazione**: PDF generato dal server (o stampa del foglio dal browser), Word come `.doc` HTML con le firme incorporate, tabelle del SAL in CSV per Excel.

## Riprese 360° e dati NowVision

Per ogni cantiere il Redattore può leggere i dati della piattaforma NowVision e usarli nel confronto:

- **Cronoprogramma**: l'xlsx «Construction Schedule» (zone, WBS, date previste ed effettive, % avanzamento, note; anche il foglio di note).
- **Computo**: l'export «WBS Mode» (con «Misurato dall'IA», costo rilevato e affidabilità) oppure il template di import «BOQ Template».
- **Riprese 360°**: immagini con zona e data.

Si caricano dalla finestra «Riprese 360°» (chip «Proponi dalle riprese NowVision» in home, o il pulsante 360° nel campo di scrittura). I file finiscono in `data/nowvision/<cantiere>/`. Quando il DL allega le riprese, il server manda al modello un riepilogo calcolato: avanzamento atteso alla data della ripresa più recente, stato registrato, voci di computo con il misurato dall'IA. Il modello risponde con la scheda «Confronto con il programma lavori» e propone le bozze. Un'attività che non si vede nelle riprese viene segnalata come «non visibile» e chiesta al DL, mai trattata come ritardo.

`esempi/nowvision/residenze-incanto/` contiene i dati reali di Residenze Incanto (cronoprogramma, computo e 5 riprese del 19 e 23 ottobre 2026), copiati in `data/` al primo avvio. Sono dati di un cliente: la cartella è esclusa da git, non pubblicarla.

## Struttura

```
server/       API, turno con Claude, prompt di sistema, strumenti di calcolo, archivio, dati NowVision, accessi, registro d'uso, PDF e firme
shared/       schema delle risposte, catalogo dei documenti, versioni e stati dei documenti, cantieri di esempio, calcoli
src/          interfaccia React (Vite)
  components/ barra laterale, home, chat, schede, campo di scrittura, pannello documento, Documenti, Profilo
  lib/        stato condiviso, chiamate al server, dettatura, foto, esportazioni
scripts/      Claude finto per demo e prove dell'interfaccia
```

## Da sapere

- I cantieri di `shared/cantieri.ts` sono esempi per la demo: online si creano con l'onboarding.
- In modalità demo il confronto con le riprese NowVision c'è solo per le 5 riprese di esempio di Residenze Incanto, con il report di avanzamento: sono risposte preparate in anticipo sulle riprese e sui file reali. Per qualsiasi altra ripresa serve Claude vero.
- `npm run demo` usa un server finto (`scripts/claude-finto.ts`) che riconosce solo i casi del design: serve a vedere l'interfaccia, non a valutare il Redattore.

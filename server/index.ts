// Server del Redattore DL: API JSON + streaming SSE dei turni, e l'interfaccia
// (Vite in sviluppo, la build statica in produzione).

import { PRODUZIONE } from "./ambiente";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import type { DatiPersona, EventoInterfaccia, Persona, Sessione } from "../shared/accessi";
import type { EventoTurno, FotoCaricata, NuovaConversazione, NuovoMessaggio, Salute } from "../shared/api";
import { MODALITA_FOTO, MODALITA_REVISIONE, tipoDocumento } from "../shared/documenti";
import { chiaveVersione, type FirmaApposta, type ModificaManuale } from "../shared/schema";
import { trovaVersione, type VoceArchivio } from "../shared/versioni";
import {
  ACCESSO_LIBERO,
  aggiornaPersona,
  aggiungiCantiere,
  bloccato,
  caricaAccessi,
  cantieriDi,
  creaPersona,
  entraComeAdmin,
  entraConLink,
  esci,
  iniziali,
  nomeDi,
  nuovoLink,
  personaDi,
  puoUsareCantiere,
  revoca,
  richiediAccesso,
  richiediAdmin,
  tuttePersone,
} from "./accessi";
import {
  elenco,
  indiceDocumenti,
  leggi,
  leggiFoto,
  meta,
  nuovaConversazione,
  perInterfaccia,
  preparaCartelle,
  proprietario,
  salva,
  salvaFoto,
  urlFoto,
  type ConversazioneSalvata,
} from "./archivio";
import { TIPI_DOCUMENTO_PROGETTO, eScheda, type TabelleCantiere, type TipoDocumentoProgetto } from "../shared/cantieri";
import {
  aggiornaScheda,
  breveCantiere,
  caricaCantieri,
  confermaScheda,
  creaCantiere,
  elencoBreve,
  esisteCantiere,
  salvaScheda,
  scheda,
  trovaCantiere,
} from "./cantieri";
import { attendiLetture, promptRevisione } from "./revisione";
import { aggiungiDocumento, eliminaDocumento, fileDocumento, proponiZone, riprendiLetture, rileggi } from "./onboarding";
import { caricaFirme, eliminaFirma, fileFirma, firmaComeDataUrl, firmaDi, salvaFirma, type DatiFirma } from "./firme";
import { impronteScheda, promptDiSistema } from "./istruzioni";
import { PdfNonDisponibile, paginaDocumento, pdfConCache } from "./pdf";
import { datiNowVision, eliminaRipresa, fileRipresa, salvaFile, salvaRipresa, seminaEsempi, sintesi } from "./nowvision";
import {
  MODELLO,
  aggiungiMessaggioUtente,
  chiaveConfigurata,
  eseguiTurno,
  schedaPerRigenera,
  tornaAllUltimoMessaggio,
} from "./redattore";
import {
  caricaEventi,
  consumoVuoto,
  eventiCsv,
  messaggiOggi,
  registra,
  registraVisita,
  riepilogo,
} from "./utilizzo";

const PORTA = Number(process.env.PORT ?? 5173);

const app = express();
// Dietro il proxy di Railway: protocollo e indirizzo del visitatore arrivano negli header.
app.set("trust proxy", 1);
app.use(express.json({ limit: "25mb" }));

// Express 4 non intercetta le promesse rifiutate: le passiamo al gestore degli errori.
const asincrono =
  (gestore: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    gestore(req, res).catch(next);

const personaDella = (res: Response) => res.locals.persona as Persona;

function titoloIniziale(modalita: string, cantiereId: string): string {
  const oggi = new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", timeZone: "Europe/Rome" });
  const breve = modalita === MODALITA_FOTO.id ? MODALITA_FOTO.breve : (tipoDocumento(modalita)?.breve ?? "Report");
  return `${breve} ${oggi} · ${breveCantiere(cantiereId)}`;
}

// ---------------------------------------------------------------------------
// Rotte pubbliche: stato del server, ingresso e uscita

app.get("/api/salute", (_req, res) => {
  const salute: Salute = { chiaveApi: chiaveConfigurata(), modello: MODELLO };
  res.json(salute);
});

app.get("/api/sessione", (req, res) => {
  const p = personaDi(req);
  if (!p) return res.status(401).json({ errore: "Accesso riservato" });
  registraVisita(p.id);
  const sessione: Sessione = {
    persona: { id: p.id, nome: p.nome, ruolo: p.ruolo, admin: p.admin },
    firma: firmaDi(p.id),
    iniziali: iniziali(p.nome),
    cantieri: elencoBreve(cantieriDi(p)),
    messaggiOggi: messaggiOggi(p.id),
    limiteGiornaliero: p.limiteGiornaliero,
    accessoLibero: ACCESSO_LIBERO,
  };
  res.json(sessione);
});

// Link personale: apre la sessione e porta all'app senza lasciare il codice nella barra.
app.get("/a/:codice", asincrono(async (req, res) => {
  if (ACCESSO_LIBERO) return res.redirect("/");
  if (bloccato(req.ip ?? "")) return res.redirect("/?accesso=bloccato");
  const p = await entraConLink(req.params.codice, req.ip ?? "", res);
  if (!p) return res.redirect("/?accesso=non-valido");
  void registra({ persona: p.id, tipo: "accesso", dettaglio: req.get("user-agent")?.includes("Mobile") ? "telefono" : "computer" });
  res.redirect("/");
}));

app.post("/api/accesso/admin", asincrono(async (req, res) => {
  if (bloccato(req.ip ?? "")) return res.status(429).json({ errore: "Troppi tentativi. Riprova tra un quarto d'ora." });
  const p = await entraComeAdmin(String(req.body?.password ?? ""), req.ip ?? "", res);
  if (!p) return res.status(401).json({ errore: "Password non corretta." });
  void registra({ persona: p.id, tipo: "accesso", dettaglio: "admin" });
  res.status(204).end();
}));

app.post("/api/esci", asincrono(async (req, res) => {
  await esci(req, res);
  res.status(204).end();
}));

// Da qui in poi serve una sessione.
app.use("/api", richiediAccesso);
app.use("/api/admin", richiediAdmin);

// ---------------------------------------------------------------------------
// Conversazioni

/** La conversazione, se è della persona (l'amministratore le vede tutte). */
async function leggiSua(req: Request, res: Response): Promise<ConversazioneSalvata | null> {
  const conv = await leggi(req.params.id);
  const p = personaDella(res);
  if (!conv || (!p.admin && proprietario(conv) !== p.id)) {
    res.status(404).json({ errore: "Conversazione non trovata" });
    return null;
  }
  return conv;
}

app.get("/api/conversazioni", asincrono(async (req, res) => {
  const cerca = typeof req.query.cerca === "string" ? req.query.cerca : undefined;
  res.json(await elenco(personaDella(res).id, cerca));
}));

app.post("/api/conversazioni", asincrono(async (req, res) => {
  const { modalita, cantiereId } = req.body as NuovaConversazione;
  const p = personaDella(res);
  if (modalita === MODALITA_REVISIONE.id) return res.status(400).json({ errore: "La revisione si apre dalla scheda del cantiere." });
  if (!puoUsareCantiere(p, cantiereId)) return res.status(403).json({ errore: "Non hai accesso a questo cantiere." });
  const c = trovaCantiere(cantiereId);
  if (!c) return res.status(404).json({ errore: "Cantiere non trovato." });
  const conv = nuovaConversazione({
    titolo: titoloIniziale(modalita, c.id),
    modalita,
    cantiereId: c.id,
    sistema: promptDiSistema(c, p),
    personaId: p.id,
  });
  if (eScheda(c) && c.stato === "attiva") conv.schedaInviata = impronteScheda(c);
  await salva(conv);
  void registra({ persona: p.id, tipo: "conversazione", conversazione: conv.id, cantiere: c.id, modalita });
  res.json(perInterfaccia(conv));
}));

app.get("/api/conversazioni/:id", asincrono(async (req, res) => {
  const conv = await leggiSua(req, res);
  if (conv) res.json(perInterfaccia(conv));
}));

// Un solo turno alla volta per conversazione.
const inCorso = new Set<string>();

async function streamTurno(
  req: Request,
  res: Response,
  prepara: (conv: ConversazioneSalvata, emetti: (e: EventoTurno) => void, segnale: AbortSignal) => Promise<boolean>,
) {
  const conv = await leggiSua(req, res);
  if (!conv) return;
  const p = personaDella(res);
  if (inCorso.has(conv.id)) return res.status(409).json({ errore: "Il Redattore sta già rispondendo" });
  // La revisione modifica la scheda: serve ancora l'accesso al cantiere.
  if (conv.modalita === MODALITA_REVISIONE.id && !puoUsareCantiere(p, conv.cantiereId)) {
    return res.status(403).json({ errore: "Non hai più accesso a questo cantiere." });
  }
  if (p.limiteGiornaliero !== null && messaggiOggi(p.id) >= p.limiteGiornaliero) {
    return res.status(429).json({
      errore: `Hai usato i ${p.limiteGiornaliero} messaggi di oggi. Il Redattore torna disponibile domani.`,
    });
  }
  inCorso.add(conv.id);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const emetti = (e: EventoTurno) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  const interruzione = new AbortController();
  res.on("close", () => interruzione.abort());
  // Mentre il modello ragiona non arrivano byte: un commento SSE tiene aperta la connessione nei proxy.
  const battito = setInterval(() => {
    if (!res.writableEnded) res.write(": attesa\n\n");
  }, 15_000);
  const inizio = Date.now();
  const consumo = consumoVuoto();
  const base = { persona: p.id, conversazione: conv.id, cantiere: conv.cantiereId };

  try {
    if (!(await prepara(conv, emetti, interruzione.signal))) {
      emetti({ tipo: "errore", messaggio: "Niente da rigenerare." });
      return;
    }
    await salva(conv);
    const risposta = await eseguiTurno(conv, emetti, interruzione.signal, consumo);
    conv.messaggi.push(risposta);
    await salva(conv);
    emetti({ tipo: "fine", messaggio: risposta, conversazione: meta(conv) });
    void registra({
      ...base,
      tipo: "risposta",
      esito: !risposta.errore
        ? "ok"
        : interruzione.signal.aborted
          ? "interrotta"
          : risposta.parti.length
            ? "troncata"
            : "errore",
      dettaglio: risposta.errore,
      bozze: risposta.parti.flatMap((x) => (x.tipo === "documento" ? [x.documento.titolo] : [])),
      durataMs: Date.now() - inizio,
      costo: consumo.costo,
      token: { input: consumo.input, output: consumo.output, cacheScritti: consumo.cacheScritti, cacheLetti: consumo.cacheLetti },
      modello: consumo.modello || undefined,
      fallback: consumo.fallback || undefined,
    });
  } catch (e) {
    console.error(e);
    emetti({ tipo: "errore", messaggio: "Errore del server. Riprova." });
    void registra({ ...base, tipo: "risposta", esito: "errore", dettaglio: "Errore del server", costo: consumo.costo });
  } finally {
    clearInterval(battito);
    inCorso.delete(conv.id);
    res.end();
  }
}

app.post(
  "/api/conversazioni/:id/messaggi",
  asincrono((req, res) =>
    streamTurno(req, res, async (conv, emetti, segnale) => {
      const input = req.body as NuovoMessaggio;
      if (input.documenti?.length) {
        // Documenti di progetto allegati in revisione: il Redattore risponde dopo averli letti.
        emetti({ tipo: "stato", stato: "legge" });
        await attendiLetture(conv.cantiereId, input.documenti, segnale);
      }
      const messaggio = await aggiungiMessaggioUtente(conv, input);
      emetti({ tipo: "utente", messaggio });
      void registra({
        persona: personaDella(res).id,
        tipo: "messaggio",
        conversazione: conv.id,
        cantiere: conv.cantiereId,
        foto: input.foto?.length ?? 0,
        riprese: input.riprese?.length ?? 0,
        dettato: Boolean(input.dettato) || undefined,
      });
      return true;
    }),
  ),
);

app.post(
  "/api/conversazioni/:id/rigenera",
  asincrono((req, res) =>
    streamTurno(req, res, async (conv) => {
      const fatto = tornaAllUltimoMessaggio(conv);
      if (fatto) await schedaPerRigenera(conv);
      if (fatto) void registra({ persona: personaDella(res).id, tipo: "rigenera", conversazione: conv.id, cantiere: conv.cantiereId });
      return fatto;
    }),
  ),
);

app.put("/api/conversazioni/:id/messaggi/:messaggio/feedback", asincrono(async (req, res) => {
  const conv = await leggiSua(req, res);
  if (!conv) return;
  const m = conv.messaggi.find((x) => x.id === req.params.messaggio);
  if (!m || m.ruolo !== "assistente") return res.status(404).end();
  const valore = req.body?.valore;
  if (valore === "utile" || valore === "da_migliorare") m.feedback = valore;
  else delete m.feedback;
  await salva(conv);
  void registra({ persona: personaDella(res).id, tipo: "feedback", conversazione: conv.id, dettaglio: m.feedback ?? "nessuno" });
  res.status(204).end();
}));

app.put("/api/conversazioni/:id/modifiche/:chiave", asincrono(async (req, res) => {
  const conv = await leggiSua(req, res);
  if (!conv) return;
  const { testo, html } = req.body as Pick<ModificaManuale, "testo" | "html">;
  const chiave = req.params.chiave;
  conv.modificheManuali[chiave] = { testo, html, il: new Date().toISOString() };
  // Una versione modificata non è più quella firmata o chiusa: torna bozza.
  delete conv.firme?.[chiave];
  delete conv.statiDocumento?.[chiave];
  // Il modello lo saprà al prossimo messaggio del DL.
  conv.notePendenti = conv.notePendenti.filter((n) => !n.includes(`(${chiave})`));
  conv.notePendenti.push(
    `[Il DL ha modificato a mano la bozza (${chiave}). Per le prossime versioni riparti da questo testo:\n${testo}]`,
  );
  await salva(conv);
  void registra({ persona: personaDella(res).id, tipo: "modifica", conversazione: conv.id, cantiere: conv.cantiereId });
  res.json(conv.modificheManuali[chiave]);
}));

// Esportazioni e copie: avvengono nel browser, l'interfaccia le segnala.
app.post("/api/eventi", asincrono(async (req, res) => {
  const e = req.body as EventoInterfaccia;
  const persona = personaDella(res).id;
  if (e?.tipo === "esportazione" && ["stampa", "word", "excel"].includes(e.formato)) {
    void registra({ persona, tipo: "esportazione", conversazione: String(e.conversazione).slice(0, 60), modalita: e.formato, dettaglio: String(e.documento ?? "").slice(0, 120) });
  } else if (e?.tipo === "copia" && (e.cosa === "documento" || e.cosa === "risposta")) {
    void registra({ persona, tipo: "copia", conversazione: String(e.conversazione).slice(0, 60), dettaglio: e.cosa });
  } else {
    return res.status(400).json({ errore: "Evento non valido" });
  }
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// Versioni dei documenti: PDF, firme, stato definitivo

/** «id@versione» di un documento che esiste davvero nella conversazione. */
function versioneDa(conv: ConversazioneSalvata, chiave: string) {
  const [id, numero] = [chiave.slice(0, chiave.lastIndexOf("@")), Number(chiave.slice(chiave.lastIndexOf("@") + 1))];
  return Number.isInteger(numero) ? trovaVersione(conv, id, numero) : undefined;
}

const etichetta = (v: { documento: { titolo: string }; rif: { versione: number } }) => `${v.documento.titolo} v${v.rif.versione}`;

app.get("/api/conversazioni/:id/documenti/:doc/:versione/pdf", asincrono(async (req, res) => {
  const conv = await leggiSua(req, res);
  if (!conv) return;
  const v = trovaVersione(conv, req.params.doc, Number(req.params.versione));
  if (!v) return res.status(404).json({ errore: "Versione non trovata" });
  const chiaveCache = [conv.id, chiaveVersione(v.rif), v.aggiornataIl].join("|");
  try {
    const pdf = await pdfConCache(chiaveCache, async () => {
      const firme = await Promise.all(
        v.firme.map(async (f) => ({ ...f, src: (await firmaComeDataUrl(f.hash)) ?? "" })),
      );
      return paginaDocumento(v.documento, { html: v.modifica?.html, firme });
    });
    const nome = `${v.documento.titolo.replace(/[\u2012-\u2015]/g, "-").replace(/[\\/:*?"<>|«»]+/g, "-").trim() || "documento"} v${v.rif.versione}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${req.query.scarica === "1" ? "attachment" : "inline"}; filename="documento.pdf"; filename*=UTF-8''${encodeURIComponent(nome)}`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
    void registra({ persona: personaDella(res).id, tipo: "esportazione", conversazione: conv.id, cantiere: conv.cantiereId, modalita: "pdf", dettaglio: etichetta(v) });
  } catch (e) {
    if (e instanceof PdfNonDisponibile) return res.status(503).json({ errore: "PDF non disponibile sul server: usa «Stampa»." });
    throw e;
  }
}));

app.post("/api/conversazioni/:id/firme/:chiave", asincrono(async (req, res) => {
  const conv = await leggiSua(req, res);
  if (!conv) return;
  const p = personaDella(res);
  if (proprietario(conv) !== p.id) return res.status(403).json({ errore: "Puoi firmare solo i documenti delle tue conversazioni." });
  const firma = firmaDi(p.id);
  if (!firma) return res.status(400).json({ errore: "Prima imposta la tua firma nel Profilo." });
  const v = versioneDa(conv, req.params.chiave);
  if (!v) return res.status(404).json({ errore: "Versione non trovata" });
  const slot = Number(req.body?.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= v.documento.firme.length) {
    return res.status(400).json({ errore: "Riquadro di firma non valido." });
  }
  const chiave = chiaveVersione(v.rif);
  const apposta: FirmaApposta = { slot, personaId: p.id, hash: firma.hash, nome: firma.nome, titolo: firma.titolo, albo: firma.albo, il: new Date().toISOString() };
  conv.firme ??= {};
  conv.firme[chiave] = [...(conv.firme[chiave] ?? []).filter((f) => f.personaId !== p.id && f.slot !== slot), apposta];
  conv.notePendenti.push(
    `[L'utente ha firmato la versione ${v.rif.versione} di «${v.documento.titolo}» come «${v.documento.firme[slot].ruolo}». Quella versione è chiusa: se servono modifiche scrivi una nuova versione, che andrà firmata di nuovo.]`,
  );
  await salva(conv);
  void registra({ persona: p.id, tipo: "firma", conversazione: conv.id, cantiere: conv.cantiereId, modalita: "apposta", dettaglio: etichetta(v) });
  res.json(conv.firme[chiave]);
}));

app.delete("/api/conversazioni/:id/firme/:chiave", asincrono(async (req, res) => {
  const conv = await leggiSua(req, res);
  if (!conv) return;
  const p = personaDella(res);
  const v = versioneDa(conv, req.params.chiave);
  if (!v) return res.status(404).json({ errore: "Versione non trovata" });
  const chiave = chiaveVersione(v.rif);
  const rimaste = (conv.firme?.[chiave] ?? []).filter((f) => f.personaId !== p.id);
  if (conv.firme) {
    if (rimaste.length) conv.firme[chiave] = rimaste;
    else delete conv.firme[chiave];
  }
  await salva(conv);
  void registra({ persona: p.id, tipo: "firma", conversazione: conv.id, cantiere: conv.cantiereId, modalita: "tolta", dettaglio: etichetta(v) });
  res.json(rimaste);
}));

app.put("/api/conversazioni/:id/stati/:chiave", asincrono(async (req, res) => {
  const conv = await leggiSua(req, res);
  if (!conv) return;
  const p = personaDella(res);
  const v = versioneDa(conv, req.params.chiave);
  if (!v) return res.status(404).json({ errore: "Versione non trovata" });
  const chiave = chiaveVersione(v.rif);
  const definitivo = req.body?.definitivo === true;
  conv.statiDocumento ??= {};
  if (definitivo) conv.statiDocumento[chiave] = { definitivo: true, il: new Date().toISOString(), personaId: p.id };
  else delete conv.statiDocumento[chiave];
  await salva(conv);
  void registra({ persona: p.id, tipo: "definitivo", conversazione: conv.id, cantiere: conv.cantiereId, modalita: definitivo ? "definitivo" : "bozza", dettaglio: etichetta(v) });
  res.json(conv.statiDocumento[chiave] ?? null);
}));

// ---------------------------------------------------------------------------
// Pagina Documenti: tutte le versioni più recenti, con il loro stato

app.get("/api/documenti", asincrono(async (req, res) => {
  const p = personaDella(res);
  const tutte = p.admin && req.query.persona === "tutte";
  const cantiereFiltro = typeof req.query.cantiere === "string" ? req.query.cantiere : "";
  const tipo = typeof req.query.tipo === "string" ? req.query.tipo : "";
  const stato = typeof req.query.stato === "string" ? req.query.stato : "";
  const cerca = typeof req.query.cerca === "string" ? req.query.cerca.trim().toLowerCase() : "";
  const voci: VoceArchivio[] = [];
  for (const conv of await indiceDocumenti()) {
    if (!tutte && conv.proprietario !== p.id) continue;
    for (const v of conv.voci) {
      if (cantiereFiltro && v.cantiereId !== cantiereFiltro) continue;
      if (tipo && v.tipo !== tipo) continue;
      if (stato === "bozze" && v.stato !== "bozza") continue;
      if (stato === "ultimati" && v.stato === "bozza") continue;
      if (cerca && !v.titolo.toLowerCase().includes(cerca)) continue;
      voci.push(tutte ? { ...v, persona: nomeDi(conv.proprietario) } : v);
    }
  }
  voci.sort((a, b) => b.aggiornatoIl.localeCompare(a.aggiornatoIl));
  res.json(voci);
}));

// ---------------------------------------------------------------------------
// Profilo: la firma della persona

app.get("/api/profilo/firma", (_req, res) => {
  res.json(firmaDi(personaDella(res).id));
});

app.put("/api/profilo/firma", asincrono(async (req, res) => {
  try {
    res.json(await salvaFirma(personaDella(res).id, req.body as DatiFirma));
  } catch (e) {
    res.status(400).json({ errore: (e as Error).message });
  }
}));

app.delete("/api/profilo/firma", asincrono(async (_req, res) => {
  await eliminaFirma(personaDella(res).id);
  res.status(204).end();
}));

// Immagini delle firme: il nome è l'impronta del contenuto, la conosce solo chi vede la firma.
app.get("/api/firme/:file", (req, res) => {
  const file = fileFirma(req.params.file.replace(/\.png$/, ""));
  if (!file) return res.status(404).end();
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.sendFile(file, (e) => {
    if (e && !res.headersSent) res.status(404).end();
  });
});

// ---------------------------------------------------------------------------
// Cantieri: scheda e onboarding dai documenti di progetto

app.get("/api/cantieri", (_req, res) => {
  res.json(elencoBreve(cantieriDi(personaDella(res))));
});

app.post("/api/cantieri", asincrono(async (req, res) => {
  const p = personaDella(res);
  try {
    const s = await creaCantiere(String(req.body?.nome ?? ""), p.id);
    await aggiungiCantiere(p.id, s.id);
    void registra({ persona: p.id, tipo: "onboarding", cantiere: s.id, esito: "ok", modalita: "creazione", dettaglio: s.nome });
    res.json(s);
  } catch (e) {
    res.status(400).json({ errore: (e as Error).message });
  }
}));

/** La scheda del cantiere della richiesta, se la persona può usarlo (gli esempi non hanno scheda). */
function schedaSua(req: Request, res: Response) {
  const id = req.params.cantiere;
  if (!esisteCantiere(id) || !puoUsareCantiere(personaDella(res), id)) {
    res.status(403).json({ errore: "Non hai accesso a questo cantiere." });
    return null;
  }
  const s = scheda(id);
  if (!s) {
    res.status(400).json({ errore: "È un cantiere di esempio: la sua scheda non si modifica." });
    return null;
  }
  return s;
}

app.get("/api/cantieri/:cantiere", (req, res) => {
  const id = req.params.cantiere;
  if (!esisteCantiere(id) || !puoUsareCantiere(personaDella(res), id)) {
    return res.status(403).json({ errore: "Non hai accesso a questo cantiere." });
  }
  res.json(trovaCantiere(id));
});

app.put("/api/cantieri/:cantiere", asincrono(async (req, res) => {
  const s = schedaSua(req, res);
  if (!s) return;
  try {
    res.json(await aggiornaScheda(s.id, req.body));
  } catch (e) {
    res.status(400).json({ errore: (e as Error).message });
  }
}));

app.post("/api/cantieri/:cantiere/conferma", asincrono(async (req, res) => {
  const s = schedaSua(req, res);
  if (!s) return;
  try {
    const confermata = await confermaScheda(s.id);
    void registra({ persona: personaDella(res).id, tipo: "onboarding", cantiere: s.id, esito: "ok", modalita: "conferma", dettaglio: s.nome });
    res.json(confermata);
  } catch (e) {
    res.status(400).json({ errore: (e as Error).message });
  }
}));

app.post(
  "/api/cantieri/:cantiere/documenti",
  express.raw({ type: "application/octet-stream", limit: "60mb" }),
  asincrono(async (req, res) => {
    const s = schedaSua(req, res);
    if (!s) return;
    const tipo = String(req.query.tipo ?? "") as TipoDocumentoProgetto;
    if (!TIPI_DOCUMENTO_PROGETTO.includes(tipo)) return res.status(400).json({ errore: "Tipo di documento non valido." });
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ errore: "Manca il file." });
    try {
      const sostituisce = typeof req.query.sostituisce === "string" ? req.query.sostituisce : undefined;
      await aggiungiDocumento(s, tipo, String(req.query.nome ?? "documento"), req.body, personaDella(res).id, sostituisce);
      res.json(s);
    } catch (e) {
      res.status(400).json({ errore: (e as Error).message });
    }
  }),
);

app.delete("/api/cantieri/:cantiere/documenti/:documento", asincrono(async (req, res) => {
  const s = schedaSua(req, res);
  if (!s) return;
  try {
    await eliminaDocumento(s, req.params.documento);
    res.json(s);
  } catch (e) {
    res.status(400).json({ errore: (e as Error).message });
  }
}));

app.post("/api/cantieri/:cantiere/documenti/:documento/rileggi", asincrono(async (req, res) => {
  const s = schedaSua(req, res);
  if (!s) return;
  try {
    rileggi(s, req.params.documento);
    res.json(s);
  } catch (e) {
    res.status(400).json({ errore: (e as Error).message });
  }
}));

app.get("/api/cantieri/:cantiere/documenti/:documento/file", (req, res) => {
  const s = schedaSua(req, res);
  if (!s) return;
  const d = s.documenti.find((x) => x.id === req.params.documento);
  if (!d) return res.status(404).end();
  res.setHeader("Content-Type", d.mediaType);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(d.nome)}`);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(fileDocumento(s, d), (e) => {
    if (e && !res.headersSent) res.status(404).end();
  });
});

/** Voci di computo e attività del programma in forma leggera, per la revisione delle zone. */
app.get("/api/cantieri/:cantiere/tabelle", asincrono(async (req, res) => {
  const s = schedaSua(req, res);
  if (!s) return;
  const nv = await datiNowVision(s.id);
  const tabelle: TabelleCantiere = {
    voci: (nv.computo?.voci ?? []).slice(0, 3000).map((v) => ({
      wbs: v.wbs,
      descrizione: v.descrizione.slice(0, 200),
      unita: v.unita,
      quantita: v.quantita,
      importo: v.importo,
      zone: v.zone,
      categoria: v.categoria ?? "",
      zonaDedotta: v.zonaDedotta === true,
    })),
    attivita: (nv.programma?.attivita ?? []).slice(0, 1000).map((a) => ({
      wbs: a.wbs,
      descrizione: a.descrizione.slice(0, 200),
      inizio: a.inizioPrevisto,
      fine: a.finePrevista,
      zone: a.zone,
      zonaDedotta: a.zonaDedotta === true,
    })),
  };
  res.json(tabelle);
}));

/**
 * Conversazione di revisione della scheda con il Redattore: una per persona e cantiere,
 * riaperta se esiste già. `nuova` dice all'interfaccia di avviarla con il primo messaggio.
 */
app.post("/api/cantieri/:cantiere/revisione", asincrono(async (req, res) => {
  const s = schedaSua(req, res);
  if (!s) return;
  const p = personaDella(res);
  const esistente = s.revisioni?.[p.id] ? await leggi(s.revisioni[p.id]) : null;
  if (esistente && proprietario(esistente) === p.id) {
    return res.json({ conversazione: perInterfaccia(esistente), nuova: esistente.messaggi.length === 0 });
  }
  const conv = nuovaConversazione({
    titolo: `Revisione scheda · ${s.breve}`,
    modalita: MODALITA_REVISIONE.id,
    cantiereId: s.id,
    sistema: promptRevisione(p),
    personaId: p.id,
  });
  await salva(conv);
  s.revisioni = { ...s.revisioni, [p.id]: conv.id };
  await salvaScheda(s);
  void registra({ persona: p.id, tipo: "conversazione", conversazione: conv.id, cantiere: s.id, modalita: MODALITA_REVISIONE.id });
  res.json({ conversazione: perInterfaccia(conv), nuova: true });
}));

app.post("/api/cantieri/:cantiere/zone/proponi", (req, res) => {
  const s = schedaSua(req, res);
  if (!s) return;
  if (s.zoneInPreparazione || s.documenti.some((d) => d.stato === "in_coda" || d.stato === "in_lettura")) {
    return res.status(409).json({ errore: "Aspetta che finisca la lettura dei documenti." });
  }
  void proponiZone(s, personaDella(res).id);
  res.json({ ...s, zoneInPreparazione: true });
});

// ---------------------------------------------------------------------------
// Dati NowVision del cantiere: file xlsx e riprese 360°.

/** Il cantiere della richiesta, se la persona può usarlo. */
function cantiereSuo(req: Request, res: Response): string | null {
  const id = req.params.cantiere;
  if (!esisteCantiere(id) || !puoUsareCantiere(personaDella(res), id)) {
    res.status(403).json({ errore: "Non hai accesso a questo cantiere." });
    return null;
  }
  return id;
}

app.get("/api/nowvision/:cantiere", asincrono(async (req, res) => {
  const id = cantiereSuo(req, res);
  if (id) res.json(await sintesi(id));
}));

app.post("/api/nowvision/:cantiere/file", asincrono(async (req, res) => {
  const id = cantiereSuo(req, res);
  if (!id) return;
  const { tipo, nome, base64 } = req.body as { tipo: string; nome: string; base64: string };
  if (tipo !== "computo" && tipo !== "cronoprogramma") return res.status(400).json({ errore: "Tipo di file non valido" });
  try {
    await salvaFile(id, tipo, String(nome).slice(0, 120), Buffer.from(base64, "base64"));
    void registra({ persona: personaDella(res).id, tipo: "nowvision", cantiere: id, dettaglio: `ha caricato il ${tipo} (${String(nome).slice(0, 60)})` });
    res.json(await sintesi(id));
  } catch (e) {
    res.status(400).json({ errore: (e as Error).message });
  }
}));

app.post("/api/nowvision/:cantiere/riprese", asincrono(async (req, res) => {
  const id = cantiereSuo(req, res);
  if (!id) return;
  const { dataUrl, nome, zona, data } = req.body as { dataUrl: string; nome: string; zona: string; data: string };
  try {
    const ripresa = await salvaRipresa(id, dataUrl, String(nome ?? ""), String(zona ?? ""), String(data ?? ""));
    void registra({ persona: personaDella(res).id, tipo: "nowvision", cantiere: id, dettaglio: `ha caricato una ripresa 360° (${ripresa.zona})` });
    res.json(ripresa);
  } catch (e) {
    res.status(400).json({ errore: (e as Error).message });
  }
}));

app.delete("/api/nowvision/:cantiere/riprese/:id", asincrono(async (req, res) => {
  const id = cantiereSuo(req, res);
  if (!id) return;
  await eliminaRipresa(id, req.params.id);
  void registra({ persona: personaDella(res).id, tipo: "nowvision", cantiere: id, dettaglio: "ha eliminato una ripresa 360°" });
  res.status(204).end();
}));

app.get("/api/nowvision/:cantiere/riprese/:id", asincrono(async (req, res) => {
  const id = cantiereSuo(req, res);
  if (!id) return;
  const trovata = await fileRipresa(id, req.params.id);
  if (!trovata) return res.status(404).end();
  res.sendFile(trovata.file, { maxAge: "1y", immutable: true });
}));

app.post("/api/foto", asincrono(async (req, res) => {
  const { dataUrl, nome, scattataIl } = req.body as FotoCaricata;
  try {
    const ora = scattataIl
      ? new Date(scattataIl).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" })
      : "";
    const foto = await salvaFoto(dataUrl, String(nome ?? "foto.jpg").slice(0, 80), ora);
    res.json({ id: foto.id, url: urlFoto(foto.id), ora: foto.ora, nome: foto.nome });
  } catch (e) {
    res.status(400).json({ errore: (e as Error).message });
  }
}));

app.get("/api/foto/:id", asincrono(async (req, res) => {
  const trovata = await leggiFoto(req.params.id);
  if (!trovata) return res.status(404).end();
  res.type(trovata.foto.mediaType).sendFile(trovata.file, { maxAge: "1y", immutable: true });
}));

// ---------------------------------------------------------------------------
// Amministrazione: utilizzo e link personali

function linkPersonale(req: Request, codice: string): string {
  const base = process.env.REDATTORE_URL?.replace(/\/$/, "") ?? `${req.protocol}://${req.get("host")}`;
  return `${base}/a/${codice}`;
}

app.get("/api/admin/utilizzo", (req, res) => {
  const giorni = [7, 30, 90].includes(Number(req.query.giorni)) ? Number(req.query.giorni) : 30;
  res.json(riepilogo(giorni, tuttePersone(), nomeDi));
});

app.get("/api/admin/eventi.csv", (_req, res) => {
  res.setHeader("Content-Disposition", 'attachment; filename="redattore-utilizzo.csv"');
  res.type("text/csv; charset=utf-8").send(eventiCsv(nomeDi));
});

const gestisci =
  (azione: (req: Request) => Promise<unknown>) =>
  asincrono(async (req, res) => {
    try {
      res.json(await azione(req));
    } catch (e) {
      res.status(400).json({ errore: (e as Error).message });
    }
  });

app.post("/api/admin/persone", gestisci(async (req) => {
  const { persona, codice } = await creaPersona(req.body as DatiPersona);
  return { persona, link: linkPersonale(req, codice) };
}));
app.put("/api/admin/persone/:id", gestisci((req) => aggiornaPersona(req.params.id, req.body as Partial<DatiPersona>)));
app.post("/api/admin/persone/:id/link", gestisci(async (req) => ({ link: linkPersonale(req, await nuovoLink(req.params.id)) })));
app.post("/api/admin/persone/:id/revoca", gestisci((req) => revoca(req.params.id, req.body?.revocata !== false)));

async function avvia() {
  await preparaCartelle();
  // Prima i dati di esempio: così Residenze Incanto, se ha dati NowVision, diventa subito un cantiere vero.
  await seminaEsempi();
  await caricaCantieri();
  await caricaAccessi();
  await riprendiLetture();
  await caricaFirme();
  await caricaEventi();
  if (PRODUZIONE) {
    const dist = path.resolve("dist");
    app.use(express.static(dist, { index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }
  app.listen(PORTA, () => {
    console.log(`Redattore DL su http://localhost:${PORTA}`);
    if (ACCESSO_LIBERO) console.log("Accesso libero (sviluppo): imposta REDATTORE_PASSWORD_ADMIN per attivare i link personali.");
    if (!chiaveConfigurata()) {
      console.warn("Attenzione: ANTHROPIC_API_KEY non impostata (file .env in locale, variabili del servizio online).");
    }
  });
}

avvia().catch((e: Error) => {
  console.error(`Il Redattore non è partito: ${e.message}`);
  process.exit(1);
});

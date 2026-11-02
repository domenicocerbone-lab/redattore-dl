// Server del Redattore DL: API JSON + streaming SSE dei turni, e l'interfaccia
// (Vite in sviluppo, la build statica in produzione).

import { PRODUZIONE } from "./ambiente";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import type { DatiPersona, EventoInterfaccia, Persona, Sessione } from "../shared/accessi";
import type { EventoTurno, FotoCaricata, NuovaConversazione, NuovoMessaggio, Salute } from "../shared/api";
import { cantiere } from "../shared/cantieri";
import { MODALITA_FOTO, tipoDocumento } from "../shared/documenti";
import type { ModificaManuale } from "../shared/schema";
import {
  ACCESSO_LIBERO,
  aggiornaPersona,
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
import { promptDiSistema } from "./istruzioni";
import { eliminaRipresa, fileRipresa, salvaFile, salvaRipresa, seminaEsempi, sintesi } from "./nowvision";
import {
  MODELLO,
  aggiungiMessaggioUtente,
  chiaveConfigurata,
  eseguiTurno,
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
  return `${breve} ${oggi} · ${cantiere(cantiereId).breve}`;
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
    iniziali: iniziali(p.nome),
    cantieri: cantieriDi(p),
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
  if (!puoUsareCantiere(p, cantiereId)) return res.status(403).json({ errore: "Non hai accesso a questo cantiere." });
  const c = cantiere(cantiereId);
  const conv = nuovaConversazione({
    titolo: titoloIniziale(modalita, c.id),
    modalita,
    cantiereId: c.id,
    sistema: promptDiSistema(c, p),
    personaId: p.id,
  });
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
  prepara: (conv: ConversazioneSalvata, emetti: (e: EventoTurno) => void) => Promise<boolean>,
) {
  const conv = await leggiSua(req, res);
  if (!conv) return;
  const p = personaDella(res);
  if (inCorso.has(conv.id)) return res.status(409).json({ errore: "Il Redattore sta già rispondendo" });
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
    if (!(await prepara(conv, emetti))) {
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
    streamTurno(req, res, async (conv, emetti) => {
      const input = req.body as NuovoMessaggio;
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
  if (e?.tipo === "esportazione" && ["pdf", "word", "excel"].includes(e.formato)) {
    void registra({ persona, tipo: "esportazione", conversazione: String(e.conversazione).slice(0, 60), modalita: e.formato, dettaglio: String(e.documento ?? "").slice(0, 120) });
  } else if (e?.tipo === "copia" && (e.cosa === "documento" || e.cosa === "risposta")) {
    void registra({ persona, tipo: "copia", conversazione: String(e.conversazione).slice(0, 60), dettaglio: e.cosa });
  } else {
    return res.status(400).json({ errore: "Evento non valido" });
  }
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// Dati NowVision del cantiere: file xlsx e riprese 360°.

/** Il cantiere della richiesta, se la persona può usarlo. */
function cantiereSuo(req: Request, res: Response): string | null {
  const id = cantiere(req.params.cantiere).id;
  if (id !== req.params.cantiere || !puoUsareCantiere(personaDella(res), id)) {
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
  await caricaAccessi();
  await caricaEventi();
  await seminaEsempi();
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

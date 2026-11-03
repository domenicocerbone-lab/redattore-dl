// Accesso con link personale: ogni persona riceve un link /a/<codice> che apre una sessione
// (cookie HttpOnly). L'amministratore entra con REDATTORE_PASSWORD_ADMIN.
// Senza password e fuori produzione l'accesso è libero, come in sviluppo e in demo.
// Codici e sessioni sono salvati solo come hash.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import type { DatiPersona, Persona } from "../shared/accessi";
import { UTENTE } from "../shared/cantieri";
import { ACCESSO_LIBERO, PRODUZIONE } from "./ambiente";
import { CARTELLA_DATI, leggiJson, scriviAtomico } from "./archivio-json";
import { esisteCantiere, idVisibili } from "./cantieri";

const FILE_PERSONE = path.join(CARTELLA_DATI, "persone.json");
const FILE_SESSIONI = path.join(CARTELLA_DATI, "sessioni.json");
const PASSWORD_ADMIN = process.env.REDATTORE_PASSWORD_ADMIN ?? "";
const COOKIE = "redattore_sessione";
const DURATA_SESSIONE = 180 * 24 * 60 * 60 * 1000;

export { ACCESSO_LIBERO };
export const ID_ADMIN = "admin";

interface PersonaSalvata extends Persona {
  codiceHash: string;
}

interface SessioneSalvata {
  personaId: string;
  creataIl: string;
}

let persone: PersonaSalvata[] = [];
let sessioni: Record<string, SessioneSalvata> = {};

const hash = (testo: string) => createHash("sha256").update(testo).digest("hex");
const nuovoCodice = () => randomBytes(24).toString("base64url");

const scrivi = (file: string, dati: unknown) => scriviAtomico(file, JSON.stringify(dati, null, 2));

export async function caricaAccessi() {
  if (PRODUZIONE && !PASSWORD_ADMIN) {
    throw new Error("Imposta REDATTORE_PASSWORD_ADMIN: online il Redattore non parte senza accesso protetto.");
  }
  persone = await leggiJson<PersonaSalvata[]>(FILE_PERSONE, []);
  sessioni = await leggiJson<Record<string, SessioneSalvata>>(FILE_SESSIONI, {});
}

const salvaPersone = () => scrivi(FILE_PERSONE, persone);
const salvaSessioni = () => scrivi(FILE_SESSIONI, sessioni);

function pubblica({ codiceHash: _codice, ...p }: PersonaSalvata): Persona {
  return p;
}


/** In accesso libero c'è una sola persona: chi ha avviato il server. */
const PERSONA_LOCALE: Persona = {
  id: ID_ADMIN,
  nome: UTENTE.nome,
  organizzazione: "",
  ruolo: UTENTE.ruolo,
  // Amministratore: vede tutti i cantieri senza elencarli qui.
  cantieri: [],
  limiteGiornaliero: null,
  admin: true,
  creataIl: new Date(0).toISOString(),
};

export function iniziali(nome: string): string {
  const parole = nome
    .replace(/^(ing|arch|geom|dott|p\.?\s*i)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return ((parole[0]?.[0] ?? "") + (parole.at(-1)?.[0] ?? "")).toUpperCase() || "?";
}

export function cantieriDi(p: Persona): string[] {
  const visibili = idVisibili();
  return p.admin ? visibili : p.cantieri.filter((id) => visibili.includes(id));
}

export function puoUsareCantiere(p: Persona, cantiereId: string): boolean {
  return cantieriDi(p).includes(cantiereId);
}

export function tuttePersone(): Persona[] {
  return persone.map(pubblica);
}

export function nomeDi(id: string): string {
  if (ACCESSO_LIBERO && id === ID_ADMIN) return PERSONA_LOCALE.nome;
  return persone.find((p) => p.id === id)?.nome ?? "Persona eliminata";
}

// ---------------------------------------------------------------------------
// Sessione dalla richiesta

function leggiCookie(req: Request): string | null {
  for (const parte of (req.headers.cookie ?? "").split(";")) {
    const [nome, ...valore] = parte.trim().split("=");
    if (nome === COOKIE) return decodeURIComponent(valore.join("="));
  }
  return null;
}

export function personaDi(req: Request): Persona | null {
  if (ACCESSO_LIBERO) return PERSONA_LOCALE;
  const valore = leggiCookie(req);
  if (!valore) return null;
  const sessione = sessioni[hash(valore)];
  if (!sessione || Date.now() - Date.parse(sessione.creataIl) > DURATA_SESSIONE) return null;
  const p = persone.find((x) => x.id === sessione.personaId);
  return p && !p.revocataIl ? pubblica(p) : null;
}

async function apriSessione(res: Response, personaId: string) {
  const valore = nuovoCodice();
  sessioni[hash(valore)] = { personaId, creataIl: new Date().toISOString() };
  await salvaSessioni();
  res.cookie(COOKIE, valore, {
    httpOnly: true,
    sameSite: "lax",
    secure: PRODUZIONE,
    maxAge: DURATA_SESSIONE,
    path: "/",
  });
}

async function chiudiSessioniDi(personaId: string) {
  for (const [chiave, s] of Object.entries(sessioni)) if (s.personaId === personaId) delete sessioni[chiave];
  await salvaSessioni();
}

export async function esci(req: Request, res: Response) {
  const valore = leggiCookie(req);
  if (valore && sessioni[hash(valore)]) {
    delete sessioni[hash(valore)];
    await salvaSessioni();
  }
  res.clearCookie(COOKIE, { path: "/" });
}

/** Le API rispondono 401 senza una sessione valida; la persona finisce in res.locals. */
export function richiediAccesso(req: Request, res: Response, next: NextFunction) {
  const p = personaDi(req);
  if (!p) return res.status(401).json({ errore: "Accesso riservato: apri il link personale che hai ricevuto." });
  res.locals.persona = p;
  next();
}

export function richiediAdmin(req: Request, res: Response, next: NextFunction) {
  const p = personaDi(req);
  if (!p?.admin) return res.status(403).json({ errore: "Solo per l'amministratore." });
  res.locals.persona = p;
  next();
}

// ---------------------------------------------------------------------------
// Ingresso: link personale o password dell'amministratore

const tentativi = new Map<string, number[]>();
const FINESTRA = 15 * 60 * 1000;

/** Troppi tentativi sbagliati dallo stesso indirizzo: si aspetta un quarto d'ora. */
export function bloccato(ip: string): boolean {
  const recenti = (tentativi.get(ip) ?? []).filter((t) => Date.now() - t < FINESTRA);
  tentativi.set(ip, recenti);
  return recenti.length >= 10;
}

function sbagliato(ip: string) {
  tentativi.set(ip, [...(tentativi.get(ip) ?? []), Date.now()]);
}

export async function entraConLink(codice: string, ip: string, res: Response): Promise<Persona | null> {
  const cercato = hash(codice);
  const p = persone.find((x) => !x.revocataIl && x.codiceHash === cercato);
  if (!p) {
    sbagliato(ip);
    return null;
  }
  await apriSessione(res, p.id);
  return pubblica(p);
}

function stessaPassword(a: string, b: string): boolean {
  const [x, y] = [Buffer.from(hash(a)), Buffer.from(hash(b))];
  return timingSafeEqual(x, y);
}

export async function entraComeAdmin(password: string, ip: string, res: Response): Promise<Persona | null> {
  if (!PASSWORD_ADMIN || !stessaPassword(password, PASSWORD_ADMIN)) {
    sbagliato(ip);
    return null;
  }
  let admin = persone.find((p) => p.id === ID_ADMIN);
  if (!admin) {
    admin = {
      id: ID_ADMIN,
      nome: process.env.REDATTORE_NOME_ADMIN ?? "Amministratore",
      organizzazione: "NowVision",
      ruolo: "Amministratore",
      cantieri: [],
      limiteGiornaliero: null,
      admin: true,
      creataIl: new Date().toISOString(),
      // L'amministratore entra solo con la password: il suo codice non viene mai mostrato.
      codiceHash: hash(nuovoCodice()),
    };
    persone.unshift(admin);
    await salvaPersone();
  }
  await apriSessione(res, ID_ADMIN);
  return pubblica(admin);
}

// ---------------------------------------------------------------------------
// Gestione delle persone (amministratore)

function pulisci(dati: Partial<DatiPersona>): Partial<DatiPersona> {
  const esito: Partial<DatiPersona> = {};
  if (typeof dati.nome === "string") esito.nome = dati.nome.trim().slice(0, 80);
  if (typeof dati.organizzazione === "string") esito.organizzazione = dati.organizzazione.trim().slice(0, 80);
  if (typeof dati.ruolo === "string") esito.ruolo = dati.ruolo.trim().slice(0, 60);
  if (Array.isArray(dati.cantieri)) esito.cantieri = dati.cantieri.filter((id) => esisteCantiere(id));
  if (dati.limiteGiornaliero === null) esito.limiteGiornaliero = null;
  else if (Number.isFinite(dati.limiteGiornaliero))
    esito.limiteGiornaliero = Math.max(0, Math.min(1000, Math.round(Number(dati.limiteGiornaliero))));
  return esito;
}

export async function creaPersona(dati: DatiPersona): Promise<{ persona: Persona; codice: string }> {
  const d = pulisci(dati);
  if (!d.nome) throw new Error("Serve il nome.");
  const codice = nuovoCodice();
  const p: PersonaSalvata = {
    id: randomUUID(),
    nome: d.nome,
    organizzazione: d.organizzazione ?? "",
    ruolo: d.ruolo || "Direttore dei Lavori",
    cantieri: d.cantieri ?? [],
    limiteGiornaliero: d.limiteGiornaliero === undefined ? 40 : d.limiteGiornaliero,
    admin: false,
    creataIl: new Date().toISOString(),
    codiceHash: hash(codice),
  };
  persone.push(p);
  await salvaPersone();
  return { persona: pubblica(p), codice };
}

function trova(id: string): PersonaSalvata {
  const p = persone.find((x) => x.id === id);
  if (!p) throw new Error("Persona non trovata.");
  return p;
}

export async function aggiornaPersona(id: string, dati: Partial<DatiPersona>): Promise<Persona> {
  const p = trova(id);
  Object.assign(p, pulisci(dati));
  if (p.admin) p.limiteGiornaliero = null;
  await salvaPersone();
  return pubblica(p);
}

/** Nuovo link: quello vecchio smette di funzionare e le sessioni aperte si chiudono. */
export async function nuovoLink(id: string): Promise<string> {
  const p = trova(id);
  if (p.admin) throw new Error("L'amministratore entra con la password.");
  const codice = nuovoCodice();
  p.codiceHash = hash(codice);
  delete p.revocataIl;
  await salvaPersone();
  await chiudiSessioniDi(id);
  return codice;
}

export async function revoca(id: string, revocata: boolean): Promise<Persona> {
  const p = trova(id);
  if (p.admin) throw new Error("L'amministratore non si può revocare.");
  if (revocata) {
    p.revocataIl = new Date().toISOString();
    await chiudiSessioniDi(id);
  } else {
    delete p.revocataIl;
  }
  await salvaPersone();
  return pubblica(p);
}

/** Chi crea un cantiere lo vede subito (l'amministratore li vede già tutti). */
export async function aggiungiCantiere(personaId: string, cantiereId: string) {
  const p = persone.find((x) => x.id === personaId);
  if (!p || p.admin || p.cantieri.includes(cantiereId)) return;
  p.cantieri.push(cantiereId);
  await salvaPersone();
}

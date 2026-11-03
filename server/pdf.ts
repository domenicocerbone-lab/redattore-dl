// PDF dei documenti, generati dal server con Chromium a partire dallo stesso componente
// che l'interfaccia usa per il foglio (DocumentoView) e dagli stessi fogli di stile.
//
// Sicurezza: l'html delle modifiche a mano non è ripulito, quindi la pagina gira senza
// JavaScript, con una CSP restrittiva e con ogni richiesta di rete bloccata (font e firme
// sono incorporati come data URL).

import { promises as fs } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import puppeteer, { type Browser } from "puppeteer-core";
import type { Documento } from "../shared/schema";
import { DocumentoView, type FirmaVisibile } from "../src/components/documento/DocumentoView";

const CHROMIUM = process.env.REDATTORE_CHROMIUM ?? "/usr/bin/chromium";
const CHIUSURA_DOPO_MS = 5 * 60 * 1000;
const PARALLELI = 2;

export class PdfNonDisponibile extends Error {}

// ---------------------------------------------------------------------------
// Pagina HTML

let stili: Promise<string> | null = null;

async function caricaStili(): Promise<string> {
  const leggi = (file: string) => fs.readFile(path.resolve(file), "utf8");
  let base = await leggi("src/styles/base.css");
  // I font dell'app, incorporati: nel PDF la rete è chiusa.
  const font = [...base.matchAll(/url\("(\.\.\/assets\/fonts\/[\w.-]+\.woff2)"\)/g)];
  for (const [intero, relativo] of font) {
    const dati = await fs.readFile(path.resolve("src/styles", relativo));
    base = base.replace(intero, `url("data:font/woff2;base64,${dati.toString("base64")}")`);
  }
  const documento = await leggi("src/components/documento/documento.css");
  const stampa = await leggi("src/components/documento/stampa.css");
  return `${base}\n${documento}\n${stampa}\nbody{margin:0;background:#fff}`;
}

const sfuggi = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function paginaDocumento(
  documento: Documento,
  opzioni: { html?: string; firme?: FirmaVisibile[] },
): Promise<string> {
  stili ??= caricaStili();
  const corpo = renderToStaticMarkup(
    createElement(DocumentoView, { documento, html: opzioni.html, firmeApposte: opzioni.firme ?? [] }),
  );
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'">
<title>${sfuggi(documento.titolo)}</title>
<style>${await stili}</style>
</head>
<body>${corpo}</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Chromium: un solo browser, aperto al primo PDF e chiuso dopo qualche minuto di quiete.

let browser: Promise<Browser> | null = null;
let chiusura: NodeJS.Timeout | undefined;
let attivi = 0;
const inAttesa: (() => void)[] = [];

export async function chromiumPresente(): Promise<boolean> {
  try {
    await fs.access(CHROMIUM);
    return true;
  } catch {
    return false;
  }
}

async function apriBrowser(): Promise<Browser> {
  if (!browser) {
    if (!(await chromiumPresente())) {
      throw new PdfNonDisponibile(`Chromium non trovato in ${CHROMIUM}: imposta REDATTORE_CHROMIUM.`);
    }
    browser = puppeteer
      .launch({
        executablePath: CHROMIUM,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none"],
      })
      .then((b) => {
        b.on("disconnected", () => {
          browser = null;
        });
        return b;
      })
      .catch((e) => {
        browser = null;
        throw e;
      });
  }
  return browser;
}

function programmaChiusura() {
  clearTimeout(chiusura);
  chiusura = setTimeout(() => {
    if (attivi > 0) return programmaChiusura();
    const b = browser;
    browser = null;
    void b?.then((x) => x.close()).catch(() => undefined);
  }, CHIUSURA_DOPO_MS);
  chiusura.unref();
}

async function aTurno<T>(lavoro: () => Promise<T>): Promise<T> {
  if (attivi >= PARALLELI) await new Promise<void>((r) => inAttesa.push(r));
  attivi += 1;
  try {
    return await lavoro();
  } finally {
    attivi -= 1;
    inAttesa.shift()?.();
  }
}

export function generaPdf(html: string): Promise<Buffer> {
  return aTurno(async () => {
    const b = await apriBrowser();
    const pagina = await b.newPage();
    try {
      await pagina.setJavaScriptEnabled(false);
      await pagina.setRequestInterception(true);
      pagina.on("request", (r) => {
        if (r.url().startsWith("data:")) void r.continue();
        else void r.abort();
      });
      await pagina.setContent(html, { waitUntil: "load", timeout: 20_000 });
      const pdf = await pagina.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: false,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="width:100%;font:8px sans-serif;color:#777;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        margin: { top: "16mm", bottom: "18mm", left: "16mm", right: "16mm" },
        timeout: 30_000,
      });
      return Buffer.from(pdf);
    } finally {
      await pagina.close().catch(() => undefined);
      programmaChiusura();
    }
  });
}

// ---------------------------------------------------------------------------
// Cache: lo stesso PDF si rigenera solo se la versione cambia (modifica, firma, stato).

const cache = new Map<string, Buffer>();
const MASSIMO_IN_CACHE = 40;

export async function pdfConCache(chiave: string, crea: () => Promise<string>): Promise<Buffer> {
  const pronto = cache.get(chiave);
  if (pronto) return pronto;
  const pdf = await generaPdf(await crea());
  cache.set(chiave, pdf);
  if (cache.size > MASSIMO_IN_CACHE) cache.delete(cache.keys().next().value!);
  return pdf;
}

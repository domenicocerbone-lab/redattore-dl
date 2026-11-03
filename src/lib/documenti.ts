// Esportazioni dal browser: Word, Excel e testo del foglio. Documenti e versioni sono in shared/versioni.ts.

export { documentiDi, type DocumentoConversazione, type VersioneDocumento } from "../../shared/versioni";

export function nomeFile(titolo: string, estensione: string) {
  // Niente trattini lunghi: alcuni browser scartano il nome e salvano «download».
  const base =
    titolo
      .replace(/[\u2012-\u2015]/g, "-")
      .replace(/[\\/:]+/g, "-")
      .replace(/[*?"<>|«»]+/g, "")
      .replace(/\s+/g, " ")
      .trim() || "documento";
  return `${base}.${estensione}`;
}

function scarica(contenuto: BlobPart, tipo: string, nome: string) {
  const url = URL.createObjectURL(new Blob([contenuto], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Word apre i file .doc in HTML: si porta dietro tabelle e titoli. */
export function esportaWord(titolo: string, foglio: HTMLElement) {
  const stile = `
    body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#0c0a08}
    h2{font-size:20pt;font-weight:normal;margin:0 0 4pt}
    h3{font-size:9pt;letter-spacing:1pt;text-transform:uppercase;font-weight:normal;margin:14pt 0 4pt}
    table{border-collapse:collapse;width:100%}
    td,th{border:1px solid #d9d9d9;padding:4pt 6pt;vertical-align:top;font-size:10pt}
    th{background:#f4f2f0;text-align:left}
    .doc-etichetta{font-size:8pt;text-transform:uppercase;color:#555}
    .segnaposto{background:#fde047}
    .doc-firma__immagine{height:56px}`;
  // Le firme apposte si incorporano: il file .doc non può scaricarle dal server.
  const copia = foglio.cloneNode(true) as HTMLElement;
  const originali = foglio.querySelectorAll("img");
  copia.querySelectorAll("img").forEach((img, i) => {
    const o = originali[i];
    try {
      const tela = document.createElement("canvas");
      tela.width = o.naturalWidth;
      tela.height = o.naturalHeight;
      tela.getContext("2d")!.drawImage(o, 0, 0);
      img.src = tela.toDataURL("image/png");
    } catch {
      img.remove();
    }
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${titolo}</title><style>${stile}</style></head><body>${copia.outerHTML}</body></html>`;
  scarica(html, "application/msword", nomeFile(titolo, "doc"));
}

/** Le tabelle del documento in CSV con «;» e BOM, come lo apre Excel in italiano. */
export function esportaExcel(titolo: string, foglio: HTMLElement) {
  const righe: string[] = [];
  const cella = (t: string) => `"${t.replace(/\s+/g, " ").trim().replace(/"/g, '""')}"`;
  foglio.querySelectorAll("table").forEach((tabella, i) => {
    if (i > 0) righe.push("");
    tabella.querySelectorAll("tr").forEach((tr) => {
      const celle = [...tr.querySelectorAll("th,td")].flatMap((c) => {
        const span = Number(c.getAttribute("colspan") ?? 1);
        return [cella(c.textContent ?? ""), ...Array(span - 1).fill('""')];
      });
      righe.push(celle.join(";"));
    });
  });
  foglio.querySelectorAll(".doc-riepilogo").forEach((riepilogo) => {
    righe.push("");
    riepilogo.querySelectorAll(".doc-riepilogo__riga").forEach((riga) => {
      righe.push([...riga.children].map((c) => cella(c.textContent ?? "")).join(";"));
    });
  });
  scarica(`﻿${righe.join("\r\n")}`, "text/csv;charset=utf-8", nomeFile(titolo, "csv"));
}

export function testoDelFoglio(foglio: HTMLElement): string {
  return foglio.innerText.replace(/\n{3,}/g, "\n\n").trim();
}

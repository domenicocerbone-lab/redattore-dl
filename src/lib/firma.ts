// Preparazione dell'immagine della firma nel browser: sfondo chiaro trasparente,
// ritaglio sul tratto e dimensioni contenute (PNG largo al massimo 600 px).

const LARGHEZZA_MASSIMA = 600;
const ALTEZZA_MASSIMA = 240;

/** Disegna un'immagine caricata (scansione o foto) sulla tela, togliendo lo sfondo chiaro. */
export async function caricaSuTela(file: File, tela: HTMLCanvasElement): Promise<void> {
  const immagine = await createImageBitmap(file);
  const scala = Math.min(1, 1400 / immagine.width, 700 / immagine.height);
  tela.width = Math.round(immagine.width * scala);
  tela.height = Math.round(immagine.height * scala);
  const ctx = tela.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, tela.width, tela.height);
  ctx.drawImage(immagine, 0, 0, tela.width, tela.height);
  const dati = ctx.getImageData(0, 0, tela.width, tela.height);
  const p = dati.data;
  // Soglia sulla luminosità: la carta diventa trasparente, il tratto resta del suo colore.
  for (let i = 0; i < p.length; i += 4) {
    const luce = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    p[i + 3] = luce > 185 ? 0 : Math.round(255 * Math.min(1, (185 - luce) / 110));
  }
  ctx.putImageData(dati, 0, 0);
}

/** PNG ritagliato sul tratto; null se la tela è vuota. */
export function firmaDallaTela(tela: HTMLCanvasElement): string | null {
  const ctx = tela.getContext("2d", { willReadFrequently: true })!;
  const { width, height } = tela;
  const p = ctx.getImageData(0, 0, width, height).data;
  let [minX, minY, maxX, maxY] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (p[(y * width + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0 || maxX - minX < 8) return null;
  const margine = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04) + 2;
  const sx = Math.max(0, minX - margine);
  const sy = Math.max(0, minY - margine);
  const sw = Math.min(width, maxX + margine) - sx;
  const sh = Math.min(height, maxY + margine) - sy;
  const scala = Math.min(1, LARGHEZZA_MASSIMA / sw, ALTEZZA_MASSIMA / sh);
  const uscita = document.createElement("canvas");
  uscita.width = Math.max(1, Math.round(sw * scala));
  uscita.height = Math.max(1, Math.round(sh * scala));
  const c = uscita.getContext("2d")!;
  c.imageSmoothingQuality = "high";
  c.drawImage(tela, sx, sy, sw, sh, 0, 0, uscita.width, uscita.height);
  return uscita.toDataURL("image/png");
}

const TITOLI = /^(ing|arch|geom|dott|p\.?\s*i|per\.?\s*ind)\.?\s+/i;

/** «Ing. Marco Rossi» → { titolo: "Ing.", nome: "Marco Rossi" }. */
export function separaTitolo(nomeCompleto: string): { titolo: string; nome: string } {
  const m = TITOLI.exec(nomeCompleto.trim());
  if (!m) return { titolo: "", nome: nomeCompleto.trim() };
  const titolo = m[0].trim();
  return { titolo: titolo.endsWith(".") ? titolo : `${titolo}.`, nome: nomeCompleto.trim().slice(m[0].length).trim() };
}

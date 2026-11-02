// Le foto si ridimensionano nel browser prima del caricamento: lato lungo massimo
// 2000 px, JPEG. Basta per leggere i dettagli di cantiere e alleggerisce l'invio.

const LATO_MASSIMO = 2000;

function comeDataUrl(file: Blob): Promise<string> {
  return new Promise((risolvi, rifiuta) => {
    const lettore = new FileReader();
    lettore.onload = () => risolvi(String(lettore.result));
    lettore.onerror = () => rifiuta(lettore.error);
    lettore.readAsDataURL(file);
  });
}

export async function preparaFoto(file: File): Promise<string> {
  let immagine: ImageBitmap;
  try {
    immagine = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`Formato non supportato: ${file.name}`);
  }
  const scala = Math.min(1, LATO_MASSIMO / Math.max(immagine.width, immagine.height));
  if (scala === 1 && file.type === "image/jpeg") {
    immagine.close();
    return comeDataUrl(file);
  }
  const tela = document.createElement("canvas");
  tela.width = Math.round(immagine.width * scala);
  tela.height = Math.round(immagine.height * scala);
  tela.getContext("2d")!.drawImage(immagine, 0, 0, tela.width, tela.height);
  immagine.close();
  return tela.toDataURL("image/jpeg", 0.85);
}

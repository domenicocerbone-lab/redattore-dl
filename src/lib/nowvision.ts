// Dati NowVision del cantiere scelto, condivisi tra home e conversazione.

import { useCallback, useEffect, useState } from "react";
import type { SintesiNowVision } from "../../shared/nowvision";
import { api } from "./api";

export function useNowVision(cantiereId: string) {
  const [sintesi, setSintesi] = useState<SintesiNowVision | null>(null);
  const ricarica = useCallback(() => {
    if (!cantiereId) return;
    api.nowvision(cantiereId).then(setSintesi, () => setSintesi(null));
  }, [cantiereId]);
  useEffect(() => {
    setSintesi(null);
    ricarica();
  }, [ricarica]);
  const disponibile = Boolean(sintesi && (sintesi.riprese.length || sintesi.computo || sintesi.programma));
  return { sintesi, setSintesi, ricarica, disponibile };
}

export function comeBase64(file: File): Promise<string> {
  return new Promise((risolvi, rifiuta) => {
    const lettore = new FileReader();
    lettore.onload = () => risolvi(String(lettore.result).split(",")[1] ?? "");
    lettore.onerror = () => rifiuta(lettore.error);
    lettore.readAsDataURL(file);
  });
}

export function dataBreve(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
}

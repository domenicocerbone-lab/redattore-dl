// Icone a tratto del design, su griglia 24×24.

import type { IconaDocumento } from "../../shared/documenti";

const TRACCIATI = {
  matita: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  cerca: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  cantiere: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V8l7-4 7 4v13" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  barraLaterale: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  graffetta: <path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />,
  giu: <path d="m6 9 6 6 6-6" />,
  su: <path d="m6 15 6-6 6 6" />,
  piu: <path d="M12 5v14M5 12h14" />,
  microfono: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  invia: <path d="M12 19V5M6 11l6-6 6 6" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1" />,
  fotocamera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  immagine: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m21 16-5-5-8 8" />
    </>
  ),
  calendario: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="1" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </>
  ),
  metro: (
    <>
      <rect x="2" y="8" width="20" height="8" rx="1" />
      <path d="M6 8v3M10 8v4M14 8v3M18 8v4" />
    </>
  ),
  barre: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  occhio: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  documento: (
    <>
      <path d="M14 3H6v18h12V7z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </>
  ),
  attenzione: (
    <>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  persone: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 20c0-2 1-4 3-4.5" />
    </>
  ),
  righe: <path d="M3 12h18M3 6h18M3 18h12" />,
  scudo: (
    <>
      <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" />
      <path d="M12 8v4M12 15h.01" />
    </>
  ),
  pausa: <path d="M9 5v14M15 5v14" />,
  play: <path d="M7 4v16l13-8z" />,
  bandiera: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2 4 2 4H5" />
    </>
  ),
  giro360: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="4" />
      <path d="M12 4v4M9.5 6.5 12 4l2.5 2.5" />
      <path d="M17 16.5 19 19M7 16.5 5 19" />
    </>
  ),
  foto: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  copia: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="1" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  rigenera: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7L20 8" />
      <path d="M20 3v5h-5" />
    </>
  ),
  utile: <path d="M7 10v10H4V10zM7 10l4-7a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 1H7" />,
  daMigliorare: <path d="M17 14V4h3v10zM17 14l-4 7a2 2 0 0 1-3-2l1-5H5a2 2 0 0 1-2-2l2-7a2 2 0 0 1 2-1h10" />,
  chiudi: <path d="M6 6l12 12M18 6 6 18" />,
  spunta: <path d="m5 12 5 5 9-10" />,
  cerchio: <circle cx="12" cy="12" r="8" />,
  domanda: (
    <>
      <path d="M12 8v5M12 16h.01" />
      <circle cx="12" cy="12" r="8" />
    </>
  ),
  trattino: <path d="M7 12h10" />,
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  scarica: (
    <>
      <path d="M12 4v11M7 10l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  condividi: (
    <>
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </>
  ),
  firma: (
    <>
      <path d="M3 17c2.5 0 3.5-6 6-6s1 5 3 5 2-3 3.5-3 1.5 2 3.5 2" />
      <path d="M3 21h18" />
    </>
  ),
  archivio: (
    <>
      <path d="M3 5h18v4H3z" />
      <path d="M5 9v10h14V9" />
      <path d="M10 13h4" />
    </>
  ),
  altro: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  stampa: (
    <>
      <path d="M7 9V3h10v6" />
      <path d="M7 17H4v-7h16v7h-3" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
} as const;

export type NomeIcona = keyof typeof TRACCIATI;

interface Props {
  nome: NomeIcona | IconaDocumento;
  dimensione?: number;
  tratto?: number;
  colore?: string;
  className?: string;
}

export function Icona({ nome, dimensione = 18, tratto = 1.5, colore = "currentColor", className }: Props) {
  return (
    <svg
      aria-hidden="true"
      width={dimensione}
      height={dimensione}
      viewBox="0 0 24 24"
      fill="none"
      stroke={colore}
      strokeWidth={tratto}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flex: "none" }}
    >
      {TRACCIATI[nome as NomeIcona]}
    </svg>
  );
}

const MARCHIO =
  "M257.33,185.22l-65.92-70.98h-91.45v41.69l77.44,77.43h55.8l-79.43-79.42h21.54l79.41,79.41h0s43.67.01,43.67.01v-82.84l-43.67-36.25,2.61,70.95Z";

const LOGOTIPO =
  "M456.93,198.41l-51.01-81h-24.68v115.95h23.02v-81l51.02,81h24.68v-115.95h-23.03v81ZM528.05,147.89c-25.17,0-43.23,18.38-43.23,44.06s18.06,44.06,43.23,44.06,43.06-18.38,43.06-44.06-17.88-44.06-43.06-44.06ZM528.05,217.29c-12.42,0-20.37-9.93-20.37-25.34s7.95-25.34,20.37-25.34,20.37,9.94,20.37,25.34-7.95,25.34-20.37,25.34ZM654.97,206.53l-18.05-55.98h-16.4l-18.05,55.98-12.92-55.98h-22.36l20.21,82.82h25.34l16.06-51.35,15.9,51.35h25.34l20.21-82.82h-22.36l-12.92,55.98ZM801.85,233.36h22.36v-82.82h-22.36v82.82ZM799.87,117.41h-15.13l-28.65,84.97-28.65-84.97h-23.02l39.25,115.95h24.84l32.87-97.08h22.85v-18.86h-24.35ZM853.39,173.4c0-3.97,4.3-6.79,12.58-6.79,9.11,0,13.92,3.32,14.58,9.28l22.19-1.66c-.66-15.73-14.57-26.33-37.1-26.33-21.03,0-35.11,9.11-35.11,26.33,0,33.29,52.84,19.21,52.84,34.62,0,5.13-5.64,8.44-15.24,8.44-12.09,0-19.05-5.13-19.71-13.08l-22.03,1.66c.66,17.88,16.73,30.14,41.9,30.14,23.52,0,37.93-10.6,37.93-27.99,0-33.29-52.84-20.7-52.84-34.62ZM906.26,138.94h26.5v-21.53h-26.5v21.53ZM908.25,233.36h22.36v-82.82h-22.36v82.82ZM976.67,147.89c-25.17,0-43.23,18.38-43.23,44.06s18.06,44.06,43.23,44.06,43.06-18.38,43.06-44.06-17.88-44.06-43.06-44.06ZM976.67,217.29c-12.42,0-20.37-9.93-20.37-25.34s7.95-25.34,20.37-25.34,20.37,9.94,20.37,25.34-7.95,25.34-20.37,25.34ZM1072.46,147.89c-12.09,0-21.7,6.29-26.83,16.73v-14.08h-22.36v82.82h22.36v-40.25c0-15.9,7.28-26.5,18.38-26.5,8.61,0,13.58,6.63,13.58,18.22v48.53h22.36v-49.52c0-22.86-9.94-35.94-27.49-35.94Z";

/** Logo NowVision completo, per la barra laterale. */
export function Logo() {
  return (
    <svg role="img" aria-label="Now Vision" width="112" height="14" viewBox="100 114 1023 122">
      <path fill="currentColor" d={`${LOGOTIPO}${MARCHIO}`} />
    </svg>
  );
}

/** Marchio su quadrato nero: avatar del Redattore e logo della barra compatta. */
export function Marchio({ lato = 28 }: { lato?: number }) {
  const larghezza = Math.round(lato * 0.57);
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "none",
        width: lato,
        height: lato,
        borderRadius: 6,
        background: "var(--nv-ink)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <svg width={larghezza} height={Math.round(larghezza * 0.72)} viewBox="100 114 200 120">
        <path fill="var(--nv-mint)" d={MARCHIO} />
      </svg>
    </span>
  );
}

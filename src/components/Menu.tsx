// Pulsante con pannello a comparsa: si chiude con Esc o cliccando fuori.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import "./menu.css";

interface Props {
  contenuto: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
  disabled?: boolean;
  allinea?: "sinistra" | "destra";
  sopra?: boolean;
  larghezza?: number;
  children: (chiudi: () => void) => ReactNode;
}

export function Menu({
  contenuto,
  className,
  style,
  ariaLabel,
  disabled,
  allinea = "sinistra",
  sopra,
  larghezza = 300,
  children,
}: Props) {
  const [aperto, setAperto] = useState(false);
  const radice = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: MouseEvent) => {
      if (!radice.current?.contains(e.target as Node)) setAperto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAperto(false);
    };
    document.addEventListener("mousedown", fuori);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuori);
      document.removeEventListener("keydown", esc);
    };
  }, [aperto]);

  return (
    <div ref={radice} className="menu">
      <button
        type="button"
        className={className}
        style={style}
        aria-label={ariaLabel}
        aria-expanded={aperto}
        aria-controls={id}
        disabled={disabled}
        onClick={() => setAperto((a) => !a)}
      >
        {contenuto}
      </button>
      {aperto && (
        <div
          id={id}
          className={`menu__pannello menu__pannello--${allinea}${sopra ? " menu__pannello--sopra" : ""}`}
          style={{ width: larghezza }}
        >
          {children(() => setAperto(false))}
        </div>
      )}
    </div>
  );
}

export function VoceMenu({
  children,
  attiva,
  onClick,
}: {
  children: ReactNode;
  attiva?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`menu__voce${attiva ? " menu__voce--attiva" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

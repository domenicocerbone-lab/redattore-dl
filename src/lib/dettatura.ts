// Dettatura con la Web Speech API del browser (Chrome, Edge, Safari).
// Dove non c'è, il pulsante del microfono resta disattivato.

import { useCallback, useEffect, useRef, useState } from "react";

interface Risultato {
  isFinal: boolean;
  0: { transcript: string };
}
interface EventoRiconoscimento {
  resultIndex: number;
  results: ArrayLike<Risultato>;
}
interface Riconoscimento {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: EventoRiconoscimento) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

function costruttore(): (new () => Riconoscimento) | undefined {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Riconoscimento) | undefined;
}

export function useDettatura(suTesto: (definitivo: string, provvisorio: string) => void) {
  const [attiva, setAttiva] = useState(false);
  const [secondi, setSecondi] = useState(0);
  const [errore, setErrore] = useState<string | null>(null);
  const riconoscimento = useRef<Riconoscimento | null>(null);
  const inizio = useRef(0);
  const callback = useRef(suTesto);
  callback.current = suTesto;
  const supportata = typeof window !== "undefined" && Boolean(costruttore());

  useEffect(() => {
    if (!attiva) return;
    const timer = window.setInterval(() => setSecondi(Math.round((Date.now() - inizio.current) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [attiva]);

  const ferma = useCallback(() => riconoscimento.current?.stop(), []);

  const avvia = useCallback(() => {
    const Costruttore = costruttore();
    if (!Costruttore || riconoscimento.current) return;
    const r = new Costruttore();
    r.lang = "it-IT";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let definitivo = "";
      let provvisorio = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const risultato = e.results[i];
        if (risultato.isFinal) definitivo += risultato[0].transcript;
        else provvisorio += risultato[0].transcript;
      }
      callback.current(definitivo, provvisorio);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") setErrore("Consenti l'uso del microfono per dettare.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setErrore("Dettatura non disponibile.");
    };
    r.onend = () => {
      riconoscimento.current = null;
      setAttiva(false);
      callback.current("", "");
    };
    riconoscimento.current = r;
    inizio.current = Date.now();
    setSecondi(0);
    setErrore(null);
    setAttiva(true);
    r.start();
  }, []);

  useEffect(() => () => riconoscimento.current?.stop(), []);

  return { supportata, attiva, secondi, errore, avvia, ferma };
}

export function durata(secondi: number): string {
  return `${Math.floor(secondi / 60)}:${String(secondi % 60).padStart(2, "0")}`;
}

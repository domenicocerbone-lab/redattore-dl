// Schermata per chi arriva senza sessione: si entra solo dal link personale,
// l'amministratore anche con la password.

import { useState } from "react";
import { api } from "../lib/api";
import { Logo } from "./Icone";
import "./accesso.css";

const MOTIVI: Record<string, string> = {
  "non-valido": "Questo link non è valido o è stato revocato. Chiedi a chi te l'ha mandato un link nuovo.",
  bloccato: "Troppi tentativi da questo dispositivo. Riprova tra un quarto d'ora.",
};

export function Accesso({ onEntrato }: { onEntrato: () => void }) {
  const motivo = new URLSearchParams(window.location.search).get("accesso");
  const [admin, setAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState("");
  const [invio, setInvio] = useState(false);

  async function entra(e: React.FormEvent) {
    e.preventDefault();
    setInvio(true);
    setErrore("");
    try {
      await api.entraComeAdmin(password);
      window.history.replaceState(null, "", "/");
      onEntrato();
    } catch (err) {
      setErrore((err as Error).message);
    } finally {
      setInvio(false);
    }
  }

  return (
    <main className="accesso">
      <div className="accesso__scheda">
        <Logo />
        <h1 className="accesso__titolo">Redattore DL</h1>
        {motivo && MOTIVI[motivo] ? (
          <p className="accesso__motivo" role="alert">{MOTIVI[motivo]}</p>
        ) : (
          <p className="accesso__testo">
            L'accesso è su invito. Apri il link personale che hai ricevuto: ti fa entrare con il tuo nome, senza password.
          </p>
        )}
        {admin ? (
          <form className="accesso__form" onSubmit={entra}>
            <label className="accesso__campo">
              <span className="etichetta-mono">Password amministratore</span>
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {errore && <p className="accesso__errore" role="alert">{errore}</p>}
            <button type="submit" className="btn btn--primario" disabled={!password || invio}>
              {invio ? "Accesso…" : "Entra"}
            </button>
          </form>
        ) : (
          <button type="button" className="accesso__link" onClick={() => setAdmin(true)}>
            Sei l'amministratore? Entra con la password
          </button>
        )}
      </div>
      <p className="avvertenza">Il Redattore DL prepara bozze · verifica e firma restano del Direttore dei Lavori</p>
    </main>
  );
}

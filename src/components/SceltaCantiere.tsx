// Pulsante «Cantiere» nell'intestazione: in home sceglie il cantiere,
// in una conversazione ne mostra l'anagrafica (il cantiere non si cambia a metà report).

import { cantiere } from "../../shared/cantieri";
import { cantieriConsentiti } from "../lib/sessione";
import { Icona } from "./Icone";
import { Menu, VoceMenu } from "./Menu";

interface Props {
  cantiereId: string;
  /** Senza callback il cantiere è fisso e il menu mostra solo l'anagrafica. */
  onCambia?: (id: string) => void;
  breve?: boolean;
}

export function SceltaCantiere({ cantiereId, onCambia, breve }: Props) {
  const c = cantiere(cantiereId);
  const indirizzo = c.indirizzo.startsWith("[") ? "" : c.indirizzo.split(",")[0];
  return (
    <Menu
      className="scelta-cantiere"
      allinea="destra"
      larghezza={onCambia ? 340 : 360}
      contenuto={
        <>
          <span className="etichetta-mono">Cantiere</span>
          <span className="scelta-cantiere__nome">
            {breve ? c.breve : c.nome}
            {indirizzo && ` · ${indirizzo}`}
          </span>
          <Icona nome="giu" dimensione={14} colore="var(--nv-ink-soft)" />
        </>
      }
    >
      {(chiudi) =>
        onCambia ? (
          cantieriConsentiti().map((x) => (
            <VoceMenu
              key={x.id}
              attiva={x.id === cantiereId}
              onClick={() => {
                onCambia(x.id);
                chiudi();
              }}
            >
              <span className="voce-cantiere">
                <span>{x.nome}</span>
                <span className="etichetta-mono">{x.indirizzo}</span>
              </span>
            </VoceMenu>
          ))
        ) : (
          <div className="menu__testo">
            <strong>{c.nome}</strong>
            <span>{c.lavori}</span>
            {Object.entries(c.anagrafica).map(([k, v]) => (
              <span key={k}>
                <span className="etichetta-mono">{k}</span>
                <br />
                {v}
              </span>
            ))}
            <span className="etichetta-mono" style={{ textTransform: "none", letterSpacing: 0 }}>
              Per un altro cantiere apri un nuovo report.
            </span>
          </div>
        )
      }
    </Menu>
  );
}

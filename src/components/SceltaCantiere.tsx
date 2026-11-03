// Pulsante «Cantiere» nell'intestazione: in home sceglie il cantiere (o ne crea uno nuovo),
// in una conversazione ne mostra la scheda (il cantiere non si cambia a metà report).

import { eScheda } from "../../shared/cantieri";
import { useCantiere } from "../lib/cantieri";
import { cantieriConsentiti, infoCantiere } from "../lib/sessione";
import { Icona } from "./Icone";
import { Menu, VoceMenu } from "./Menu";

interface Props {
  cantiereId: string;
  /** Senza callback il cantiere è fisso e il menu mostra solo la scheda. */
  onCambia?: (id: string) => void;
  breve?: boolean;
}

function Dettagli({ cantiereId }: { cantiereId: string }) {
  const voce = useCantiere(cantiereId);
  if (!voce || voce.stato === "carico") return <span>Carico la scheda…</span>;
  if (voce.stato === "errore") return <span>{voce.errore}</span>;
  const c = voce.cantiere;
  const righe = eScheda(c) ? c.soggetti.map((s) => [s.ruolo, s.nome] as const) : Object.entries(c.anagrafica);
  return (
    <>
      <strong>{c.nome}</strong>
      {c.lavori && <span>{c.lavori}</span>}
      {righe.slice(0, 8).map(([k, v], i) => (
        <span key={i}>
          <span className="etichetta-mono">{k}</span>
          <br />
          {v}
        </span>
      ))}
    </>
  );
}

export function SceltaCantiere({ cantiereId, onCambia, breve }: Props) {
  const c = infoCantiere(cantiereId);
  const indirizzo = c.indirizzo.startsWith("[") ? "" : c.indirizzo.split(",")[0];
  const scheda = c.stato !== "esempio";
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
          {c.stato === "bozza" && <span className="pillola pillola--stato-bozza">Bozza</span>}
          <Icona nome="giu" dimensione={14} colore="var(--nv-ink-soft)" />
        </>
      }
    >
      {(chiudi) =>
        onCambia ? (
          <>
            {cantieriConsentiti().map((x) => (
              <VoceMenu
                key={x.id}
                attiva={x.id === cantiereId}
                onClick={() => {
                  onCambia(x.id);
                  chiudi();
                }}
              >
                <span className="voce-cantiere">
                  <span>
                    {x.nome}
                    {x.stato === "bozza" && " · scheda da completare"}
                  </span>
                  <span className="etichetta-mono">{x.indirizzo}</span>
                </span>
              </VoceMenu>
            ))}
            <div className="menu__separatore" />
            {scheda && (
              <VoceMenu
                onClick={() => {
                  chiudi();
                  window.location.hash = `#/cantieri/${cantiereId}`;
                }}
              >
                <Icona nome="cantiere" dimensione={16} />
                Scheda di questo cantiere
              </VoceMenu>
            )}
            <VoceMenu
              onClick={() => {
                chiudi();
                window.location.hash = "#/cantieri/nuovo";
              }}
            >
              <Icona nome="piu" dimensione={16} />
              Nuovo cantiere
            </VoceMenu>
          </>
        ) : (
          <div className="menu__testo">
            <Dettagli cantiereId={cantiereId} />
            {scheda && (
              <a className="menu__link" href={`#/cantieri/${cantiereId}`} onClick={chiudi}>
                Apri la scheda del cantiere →
              </a>
            )}
            <span className="etichetta-mono" style={{ textTransform: "none", letterSpacing: 0 }}>
              Per un altro cantiere apri un nuovo report.
            </span>
          </div>
        )
      }
    </Menu>
  );
}

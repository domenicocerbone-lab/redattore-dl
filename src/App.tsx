import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { Salute } from "../shared/api";
import { Accesso } from "./components/Accesso";
import { Home } from "./components/Home";
import { Sidebar } from "./components/Sidebar";
import { VistaConversazione } from "./components/VistaConversazione";
import { api } from "./lib/api";
import { caricaSessione, cantieriConsentiti, suSessioneScaduta } from "./lib/sessione";

const Admin = lazy(() => import("./components/admin/Admin"));

const CHIAVE_CANTIERE = "redattore-dl.cantiere";

function rotta(): string | null {
  return /^#\/c\/([\w-]+)/.exec(window.location.hash)?.[1] ?? null;
}

const inAdmin = () => window.location.hash.startsWith("#/admin");

function cantiereSalvato(): string {
  const consentiti = cantieriConsentiti();
  try {
    const id = localStorage.getItem(CHIAVE_CANTIERE);
    if (id && consentiti.some((c) => c.id === id)) return id;
  } catch {
    // Archiviazione non disponibile: si usa il primo cantiere.
  }
  return consentiti[0]?.id ?? "";
}

/** Prima la sessione: senza, si mostra solo la schermata di accesso. */
export function App() {
  const [stato, setStato] = useState<"carico" | "fuori" | "dentro">("carico");

  const verifica = useCallback(() => {
    caricaSessione().then(
      (s) => setStato(s ? "dentro" : "fuori"),
      () => setStato("fuori"),
    );
  }, []);
  useEffect(verifica, [verifica]);
  useEffect(() => suSessioneScaduta(() => setStato("fuori")), []);

  if (stato === "carico") return null;
  if (stato === "fuori") return <Accesso onEntrato={verifica} />;
  if (cantieriConsentiti().length === 0) {
    return (
      <main className="vista__vuota" style={{ minHeight: "100dvh" }}>
        <p>Non hai ancora nessun cantiere assegnato. Chiedi a chi ti ha invitato di abilitarne uno.</p>
      </main>
    );
  }
  return <Redattore />;
}

function Redattore() {
  const [idAttivo, setIdAttivo] = useState(rotta);
  const [admin, setAdmin] = useState(inAdmin);
  const [cantiereId, setCantiereId] = useState(cantiereSalvato);
  const [barra, setBarra] = useState<"auto" | "completa" | "compatta">("auto");
  const [pannelloAperto, setPannelloAperto] = useState(false);
  const [menuMobile, setMenuMobile] = useState(false);
  const [salute, setSalute] = useState<Salute | null>(null);

  useEffect(() => {
    const aggiorna = () => {
      setIdAttivo(rotta());
      setAdmin(inAdmin());
      setMenuMobile(false);
    };
    window.addEventListener("hashchange", aggiorna);
    return () => window.removeEventListener("hashchange", aggiorna);
  }, []);

  useEffect(() => {
    api.salute().then(setSalute, () => undefined);
  }, []);

  // Con la bozza aperta la barra si compatta, come nel design; il DL può riaprirla.
  useEffect(() => setBarra("auto"), [pannelloAperto]);
  const compatta = barra === "compatta" || (barra === "auto" && pannelloAperto);
  const onPannello = useCallback((aperto: boolean) => setPannelloAperto(aperto), []);

  const vai = (id: string | null) => {
    window.location.hash = id ? `#/c/${id}` : "#/";
    setIdAttivo(id);
    setAdmin(false);
    setMenuMobile(false);
  };

  if (admin) {
    return (
      <Suspense fallback={null}>
        <Admin onEsci={() => vai(null)} onApri={vai} />
      </Suspense>
    );
  }

  const cambiaCantiere = (id: string) => {
    setCantiereId(id);
    try {
      localStorage.setItem(CHIAVE_CANTIERE, id);
    } catch {
      // Ricordarlo è solo una comodità.
    }
  };

  return (
    <div className="app">
      <Sidebar
        compatta={compatta}
        apertaSuMobile={menuMobile}
        idAttivo={idAttivo}
        cantiereId={cantiereId}
        onCompatta={(c) => setBarra(c ? "compatta" : "completa")}
        onChiudiMobile={() => setMenuMobile(false)}
        onNuovo={() => vai(null)}
        onApri={vai}
        onCantiere={(id) => {
          cambiaCantiere(id);
          vai(null);
        }}
      />
      <div className="app__contenuto">
        {salute && !salute.chiaveApi && (
          <div className="avviso" role="alert">
            Manca la chiave dell'API Claude: imposta <code>ANTHROPIC_API_KEY</code> (nel file <code>.env</code> in
            locale, tra le variabili del servizio online) e riavvia il server.
          </div>
        )}
        {idAttivo ? (
          <VistaConversazione
            id={idAttivo}
            onApriMenu={() => setMenuMobile(true)}
            onNuovo={() => vai(null)}
            onPannello={onPannello}
          />
        ) : (
          <Home
            cantiereId={cantiereId}
            onCantiere={cambiaCantiere}
            onApriMenu={() => setMenuMobile(true)}
            onAperta={vai}
          />
        )}
      </div>
    </div>
  );
}

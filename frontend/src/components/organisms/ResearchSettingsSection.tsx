import { useState } from "react";

import { useAiSettingsStore } from "@/store/aiSettingsStore";
import { cn } from "@/utils/cn";
import { IconGlobe } from "@/components/atoms/Icons";
import { NoticeSheet } from "@/components/molecules/NoticeSheet";

/**
 * ResearchSettingsSection — el único ajuste de investigación.
 *
 * Hubo cuatro interruptores y sobraban tres. Los otros no eran decisiones de
 * uso, eran raíles de seguridad disfrazados de preferencia: el descarte de
 * material apostata y el aviso de que una publicación tiene treinta años van
 * siempre puestos, y ofrecerlos como opción sugería que apagarlos era una
 * alternativa razonable.
 *
 * Queda el único que cambia el comportamiento de verdad y tiene una
 * consecuencia que el usuario debe aceptar a sabiendas: si el agente puede
 * salir de jw.org o no. Por eso lleva la advertencia debajo, encendido o
 * apagado — no es un texto de ayuda, es lo que estás autorizando.
 */
export function ResearchSettingsSection() {
  const internet = useAiSettingsStore((s) => s.settings.research.internet);
  const setResearch = useAiSettingsStore((s) => s.setResearch);
  const [avisoWeb, setAvisoWeb] = useState(false);

  return (
    <section className="mt-8" aria-labelledby="ajustes-investigacion">
      <h2
        id="ajustes-investigacion"
        className="font-ui text-xs font-medium uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400"
      >
        Investigación
      </h2>

      <div className="mt-3 rounded-xl border border-seam-light px-4 py-3 dark:border-seam-dark">
        <button
          role="switch"
          aria-checked={internet}
          onClick={() => setResearch({ internet: !internet })}
          className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left"
        >
          <span className="font-ui text-sm text-reading-light dark:text-reading-dark">
            Buscar también fuera de jw.org
          </span>
          <span
            aria-hidden
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full",
              "transition-colors duration-200 ease-[var(--ease-out-expo)]",
              internet
                ? "bg-amber-600 dark:bg-amber-700"
                : "bg-paper-200 dark:bg-ink-50",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-paper-50 shadow-sm",
                "transition-transform duration-200 ease-[var(--ease-out-expo)]",
                internet ? "translate-x-[22px]" : "translate-x-0.5",
              )}
            />
          </span>
        </button>

        <p className="mt-1 font-ui text-[11px] leading-relaxed text-muted-light dark:text-muted-dark">
          Solo en investigación profunda. Busca en catálogos científicos
          (OpenAlex, Europe PMC) para conseguir el dato real de una ilustración,
          con autor, revista y año.
        </p>

        {/* Azul y no ámbar: esto no es una promesa nuestra, es un paso que solo
            puede dar quien administra el servidor. */}
        <button
          onClick={() => setAvisoWeb(true)}
          className={cn(
            "mt-2 flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3",
            "border border-dashed border-seam-light text-left",
            "transition-colors duration-200 ease-[var(--ease-out-expo)]",
            "hover:border-sky-600 dark:border-seam-dark dark:hover:border-sky-400",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
          )}
        >
          <IconGlobe
            width={14}
            height={14}
            className="shrink-0 text-sky-800 dark:text-sky-300"
          />
          <span className="min-w-0 flex-1 font-ui text-[11px] text-reading-light dark:text-reading-dark">
            Añadir webs de referencia, no solo revistas
          </span>
          <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-sky-900 dark:bg-sky-400/20 dark:text-sky-200">
            Lo activas tú
          </span>
        </button>

        {internet ? (
          <div className="mt-3 rounded-lg bg-paper-100 px-3 py-2.5 dark:bg-ink-50">
            <p className="font-ui text-[11px] font-medium text-reading-light dark:text-reading-dark">
              Qué implica tenerlo encendido
            </p>
            <ul className="mt-1.5 space-y-1 font-ui text-[11px] leading-relaxed text-muted-light dark:text-muted-dark">
              <li>
                · La IA leerá material que no ha escrito la organización. Puede
                encontrar posturas distintas a las de la Biblia; si las usa,
                tiene orden de decir también qué enseña la Biblia.
              </li>
              <li>
                · Lo apóstata y las webs de oposición se descartan siempre,
                antes de que la IA los lea. Eso no se puede apagar.
              </li>
              <li>
                · El dato externo sirve para ilustrar, nunca para enseñar. La
                enseñanza sale siempre de las publicaciones.
              </li>
              <li>· Cada informe tardará algo más y consumirá más tokens.</li>
            </ul>
          </div>
        ) : (
          <p className="mt-3 font-ui text-[11px] leading-relaxed text-muted-light dark:text-muted-dark">
            Apagado: la IA investiga solo en jw.org y wol.jw.org. Las
            ilustraciones tendrán que salir de lo que haya en las
            publicaciones.
          </p>
        )}
      </div>

      <NoticeSheet
        open={avisoWeb}
        onClose={() => setAvisoWeb(false)}
        tone="action"
        title="Búsqueda web ampliada"
        icon={IconGlobe}
        lead="Está programada y funciona, pero necesita una clave de búsqueda web en el servidor y esa la pones tú: no la trae la app ni la vamos a poner nosotros. Sin ella, el ámbito «ampliado» busca solo en los catálogos científicos y el informe lo dice."
        bullets={[
          "Consigue una clave en Brave Search API o en Tavily. Las dos tienen plan gratuito.",
          <>
            Define{" "}
            <code className="font-mono text-[11px]">WEB_SEARCH_API_KEY</code> en
            el entorno del servidor.
          </>,
          <>
            Si usas Tavily, añade también{" "}
            <code className="font-mono text-[11px]">
              WEB_SEARCH_PROVIDER=tavily
            </code>
            . Por defecto se asume Brave.
          </>,
          "Reinicia el servidor. En la app no hay que tocar nada: se detecta sola.",
        ]}
        available={{
          title: "Lo que ya funciona sin clave",
          body: "OpenAlex y Europe PMC están activos y no piden clave: de ahí salen el autor, la revista y el año de una ilustración. La clave solo añade webs de referencia por encima de eso.",
        }}
      />
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/utils/cn";
import { useAiSettingsStore } from "@/store/aiSettingsStore";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import {
  fetchPracticeModes,
  sendPractice,
  toAudioUri,
} from "@/services/voiceClient";
import { resolveVoiceProvider, voiceCapableProviders } from "@/types/aiSettings";
import {
  DEFAULT_PRACTICE_MODE,
  FALLBACK_PRACTICE_MODES,
  formatClock,
  type PracticeMode,
  type PracticeResult,
} from "@/types/voice";
import { IconChevronDown, IconMic, IconStop } from "@/components/atoms/Icons";
import { SwitchRow } from "@/components/molecules/SwitchRow";

interface VoiceScreenProps {
  className?: string;
}

type Phase = "listo" | "grabando" | "enviando";

/**
 * VoiceScreen — ensayar en voz alta y recibir una crítica.
 *
 * Diseñada para usarse DE PIE, con el móvil en la mano y el guion en la otra.
 * De ahí las tres decisiones de forma:
 *
 *  - El botón de grabar es un círculo de 96 px centrado, muy por encima de los
 *    44 px de objetivo táctil del resto de la app: es el único control que se
 *    va a pulsar sin mirar bien la pantalla.
 *  - Los ajustes (tipo de ensayo, duración, notas) están ARRIBA y se cierran
 *    solos al empezar a grabar. Mientras se graba, la pantalla enseña el
 *    cronómetro y el nivel de entrada, y nada más.
 *  - El nivel de entrada es real (`AnalyserNode`, ver `useVoiceRecorder`), no
 *    una animación. Si no se mueve al hablar, el micro no está cogiendo nada, y
 *    eso hay que poder verlo ANTES de gastar cinco minutos de ensayo.
 *
 * Los dos modos de fallo tienen pantalla propia y accionable: sin soporte de
 * `MediaRecorder` y sin permiso de micrófono. Ninguno deja la vista muerta.
 */
export function VoiceScreen({ className }: VoiceScreenProps) {
  const settings = useAiSettingsStore((s) => s.settings);
  const providers = useAiSettingsStore((s) => s.providers);
  const hydrate = useAiSettingsStore((s) => s.hydrate);
  const setVoiceMode = useAiSettingsStore((s) => s.setVoiceMode);
  const setSpeakBack = useAiSettingsStore((s) => s.setSpeakBack);

  const recorder = useVoiceRecorder();

  const [modes, setModes] = useState<PracticeMode[]>(FALLBACK_PRACTICE_MODES);
  const [modeId, setModeId] = useState(settings.voiceMode || DEFAULT_PRACTICE_MODE);
  const [targetMinutes, setTargetMinutes] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [phase, setPhase] = useState<Phase>("listo");
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cerrado de entrada. Con el panel abierto, el botón de grabar se iba por
  // debajo del pliegue en un móvil de 390×844 y había que hacer scroll para
  // llegar a la acción principal — justo lo que no se puede pedir a alguien
  // que está de pie con el guion en la otra mano. La fila de resumen de arriba
  // ya dice qué se va a ensayar y cuánto, y se abre de un toque.
  const [showSetup, setShowSetup] = useState(false);

  // Para que el resultado quede a la vista sin que el usuario tenga que buscar
  // dónde ha aparecido: al terminar, se hace scroll hasta la crítica.
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    let vivo = true;
    void fetchPracticeModes().then((catalogo) => {
      if (!vivo) return;
      setModes(catalogo.modes);
      // Solo se ajusta el modo si el guardado ya no existe: no se pisa la
      // elección del usuario con el default del servidor.
      setModeId((actual) =>
        catalogo.modes.some((m) => m.id === actual) ? actual : catalogo.default,
      );
    });
    return () => {
      vivo = false;
    };
  }, []);

  const voiceProvider = useMemo(
    () => resolveVoiceProvider(providers, settings.voiceProvider),
    [providers, settings.voiceProvider],
  );
  const hayProveedorDeVoz = voiceCapableProviders(providers).length > 0;

  const mode = modes.find((m) => m.id === modeId) ?? modes[0];
  const targetSeconds =
    targetMinutes !== null ? Math.round(targetMinutes * 60) : mode?.target_seconds ?? 0;

  // ─── Pantallas de "esto no puede funcionar" ───
  if (recorder.support !== "ok") {
    return (
      <Screen className={className}>
        <Cabecera />
        <Aviso titulo="Aquí no se puede grabar">
          {recorder.support === "sin-contexto-seguro" ? (
            <>
              El navegador solo permite usar el micrófono en páginas seguras.
              Estás abriendo la app por una dirección sin cifrar. Ábrela por{" "}
              <strong>https</strong>, o desde <strong>localhost</strong> en el
              mismo ordenador, y el micrófono volverá a estar disponible.
            </>
          ) : (
            <>
              Este navegador no sabe grabar audio (le falta{" "}
              <strong>MediaRecorder</strong>). Prueba con Chrome, Firefox o
              Safari actualizados. El resto de la app funciona igual.
            </>
          )}
        </Aviso>
      </Screen>
    );
  }

  if (!hayProveedorDeVoz) {
    return (
      <Screen className={className}>
        <Cabecera />
        <Aviso titulo="Ningún proveedor de voz disponible">
          Ahora mismo no hay ningún proveedor con transcripción comprobada. La
          app solo ofrece lo que ha podido verificar contra la API de verdad, y
          prefiere decírtelo a darte un botón que fallaría.
        </Aviso>
      </Screen>
    );
  }

  // ─── Acciones ───
  const empezar = async () => {
    setError(null);
    setResult(null);
    setShowSetup(false);
    const ok = await recorder.start();
    if (ok) setPhase("grabando");
    else setShowSetup(true);
  };

  const terminar = async () => {
    const clip = await recorder.stop();
    setPhase("listo");
    if (!clip) {
      setError("No se ha grabado nada. Mantén el botón y habla un momento.");
      setShowSetup(true);
      return;
    }

    setPhase("enviando");
    try {
      const respuesta = await sendPractice({
        audio: clip.blob,
        filename: clip.filename,
        mode: modeId,
        durationMs: clip.durationMs,
        targetSeconds,
        notes,
        provider: voiceProvider?.id,
        sttModel: settings.sttModel || undefined,
        effort: settings.effort || undefined,
        speak: settings.speakBack,
        voice: settings.ttsVoice || undefined,
      });
      setResult(respuesta);
      setVoiceMode(modeId);
      // Al siguiente fotograma: antes de eso el bloque todavía no existe.
      requestAnimationFrame(() =>
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido enviar el ensayo.");
      setShowSetup(true);
    } finally {
      setPhase("listo");
    }
  };

  const descartar = () => {
    recorder.cancel();
    setPhase("listo");
    setShowSetup(true);
  };

  const grabando = phase === "grabando";
  const enviando = phase === "enviando";

  return (
    <Screen className={className}>
      <Cabecera />

      {/* ── Ajustes del ensayo ── */}
      <section className="mt-5">
        <button
          onClick={() => setShowSetup((v) => !v)}
          aria-expanded={showSetup}
          disabled={grabando}
          className={cn(
            "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-3",
            "bg-paper-200 font-ui text-sm text-reading-light",
            "disabled:opacity-50 dark:bg-ink-50 dark:text-reading-dark",
          )}
        >
          <span className="truncate">
            {mode?.label ?? "Ensayo"}
            {targetSeconds > 0 && ` · ${formatClock(targetSeconds * 1000)}`}
          </span>
          <IconChevronDown
            width={14}
            height={14}
            className={cn("shrink-0 transition-transform", showSetup && "rotate-180")}
          />
        </button>

        {showSetup && (
          <div className="mt-3 space-y-4 rounded-xl border border-seam-light p-3 dark:border-seam-dark">
            <div>
              <p className="font-ui text-xs uppercase tracking-[0.15em] text-muted-light dark:text-muted-dark">
                Qué estás ensayando
              </p>
              <div role="radiogroup" aria-label="Tipo de ensayo" className="mt-2 flex flex-wrap gap-2">
                {modes.map((m) => (
                  <button
                    key={m.id}
                    role="radio"
                    aria-checked={m.id === modeId}
                    onClick={() => {
                      setModeId(m.id);
                      setTargetMinutes(null);
                    }}
                    className={cn(
                      "flex min-h-[44px] items-center rounded-full px-4 font-ui text-xs font-medium",
                      "transition-colors duration-200 ease-[var(--ease-out-expo)]",
                      m.id === modeId
                        ? "bg-amber-600 text-paper-50 dark:bg-amber-700"
                        : "bg-paper-200 text-muted-light hover:text-reading-light dark:bg-ink-50 dark:text-muted-dark dark:hover:text-reading-dark",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {mode?.hint && (
                <p className="mt-2 font-ui text-[11px] text-muted-light dark:text-muted-dark">
                  {mode.hint}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="voz-duracion"
                className="font-ui text-xs uppercase tracking-[0.15em] text-muted-light dark:text-muted-dark"
              >
                Duración prevista
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  id="voz-duracion"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={15}
                  step={1}
                  value={
                    targetMinutes !== null
                      ? targetMinutes
                      : mode?.target_seconds
                        ? +(mode.target_seconds / 60).toFixed(1)
                        : 0
                  }
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setTargetMinutes(Number.isFinite(v) ? Math.max(0, Math.min(15, v)) : 0);
                  }}
                  className={cn(
                    "min-h-[44px] w-24 rounded-xl bg-paper-200 px-3",
                    "font-ui text-base text-reading-light outline-none sm:text-sm",
                    "dark:bg-ink-50 dark:text-reading-dark",
                  )}
                />
                <span className="font-ui text-sm text-muted-light dark:text-muted-dark">
                  minutos {targetSeconds === 0 && "· sin objetivo, no se comparan tiempos"}
                </span>
              </div>
            </div>

            <div>
              <label
                htmlFor="voz-notas"
                className="font-ui text-xs uppercase tracking-[0.15em] text-muted-light dark:text-muted-dark"
              >
                Algo concreto que quieras que mire
              </label>
              <input
                id="voz-notas"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Por ejemplo: si voy muy rápido al final"
                className={cn(
                  "mt-2 min-h-[44px] w-full rounded-xl bg-paper-200 px-3",
                  "font-ui text-base text-reading-light outline-none sm:text-sm",
                  "placeholder:text-muted-light/60 dark:bg-ink-50 dark:text-reading-dark",
                )}
              />
            </div>

            {voiceProvider?.supports_tts && (
              <SwitchRow
                label="Que me lea la crítica en voz alta"
                hint="Cuesta un poco más y tarda unos segundos de más."
                checked={settings.speakBack}
                onChange={setSpeakBack}
              />
            )}
          </div>
        )}
      </section>

      {/* ── Grabadora ── */}
      <section className="mt-6 flex flex-col items-center" aria-live="polite">
        <div
          className={cn(
            "font-display text-4xl tabular-nums transition-colors",
            grabando
              ? "text-reading-light dark:text-reading-dark"
              : "text-muted-light/50 dark:text-muted-dark/50",
          )}
        >
          {formatClock(recorder.elapsedMs)}
        </div>

        {/* Nivel real de entrada. `aria-hidden` porque el cronómetro y el
            estado del botón ya cuentan lo mismo a un lector de pantalla, y
            veinte barras animadas serían ruido. */}
        <div aria-hidden className="mt-3 flex h-8 items-end gap-[3px]">
          {Array.from({ length: 16 }, (_, i) => {
            // Campana: las barras del centro reaccionan más, como en un
            // vúmetro de verdad.
            const peso = 1 - Math.abs(i - 7.5) / 9;
            const alto = grabando ? Math.max(0.12, recorder.level * peso * 1.6) : 0.08;
            return (
              <span
                key={i}
                style={{ height: `${Math.min(1, alto) * 100}%` }}
                className={cn(
                  "w-1 rounded-full transition-[height] duration-75",
                  grabando ? "bg-amber-600 dark:bg-amber-500" : "bg-paper-200 dark:bg-ink-50",
                )}
              />
            );
          })}
        </div>

        <button
          onClick={grabando ? terminar : empezar}
          disabled={enviando}
          aria-label={grabando ? "Parar y enviar el ensayo" : "Empezar a grabar"}
          className={cn(
            // 96px: es el control que se pulsa sin mirar. El resto de la app
            // va a 44, este va muy por encima a propósito.
            "mt-5 flex h-24 w-24 items-center justify-center rounded-full",
            "transition-all duration-200 ease-[var(--ease-out-expo)]",
            "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-500/40",
            "disabled:opacity-60",
            grabando
              ? "bg-red-600 text-white shadow-lg shadow-red-600/30"
              : "bg-amber-600 text-paper-50 dark:bg-amber-700",
          )}
        >
          {grabando ? <IconStop width={30} height={30} /> : <IconMic width={30} height={30} />}
        </button>

        <p className="mt-3 min-h-[1.25rem] font-ui text-xs text-muted-light dark:text-muted-dark">
          {enviando
            ? "Escuchando el ensayo…"
            : grabando
              ? "Habla con normalidad. Pulsa para parar y enviarlo."
              : "Pulsa y ensaya en voz alta."}
        </p>

        {grabando && (
          <button
            onClick={descartar}
            className="mt-2 flex min-h-[44px] items-center px-3 font-ui text-xs text-muted-light underline dark:text-muted-dark"
          >
            Descartar sin enviar
          </button>
        )}

        {recorder.hitLimit && (
          <p className="mt-2 text-center font-ui text-[11px] text-amber-700 dark:text-amber-400">
            Se ha parado sola al llegar a los 15 minutos.
          </p>
        )}
      </section>

      {/* ── Errores ── */}
      {(recorder.error || error) && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-red-600/30 bg-red-600/5 px-4 py-3"
        >
          <p className="font-ui text-sm text-red-700 dark:text-red-400">
            {recorder.error ?? error}
          </p>
          <button
            onClick={() => {
              recorder.clearError();
              setError(null);
            }}
            className="mt-2 flex min-h-[44px] items-center font-ui text-xs text-muted-light underline dark:text-muted-dark"
          >
            Entendido
          </button>
        </div>
      )}

      {/* ── Resultado ── */}
      {result && (
        <div ref={resultRef} className="mt-8 scroll-mt-4">
          <section aria-labelledby="voz-transcripcion">
            <h2
              id="voz-transcripcion"
              className="font-ui text-xs font-medium uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400"
            >
              Lo que has dicho
            </h2>
            <p className="mt-1 font-ui text-[11px] text-muted-light dark:text-muted-dark">
              {formatClock(result.transcription.duration_seconds * 1000)}
              {result.transcription.duration_source === "grabadora" &&
                " (según el cronómetro, no medido sobre el audio)"}
              {result.target_seconds > 0 &&
                ` · previsto ${formatClock(result.target_seconds * 1000)}`}
              {` · ${result.transcription.text.trim().split(/\s+/).length} palabras`}
            </p>
            <p className="mt-2 whitespace-pre-wrap rounded-xl bg-paper-200 px-4 py-3 font-reading text-[15px] leading-relaxed text-reading-light dark:bg-ink-50 dark:text-reading-dark">
              {result.transcription.text}
            </p>
          </section>

          <section className="mt-6" aria-labelledby="voz-critica">
            <h2
              id="voz-critica"
              className="font-ui text-xs font-medium uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400"
            >
              Qué mejorar
            </h2>

            {result.audio_b64 && result.audio_mime && (
              <audio
                controls
                preload="none"
                src={toAudioUri(result.audio_mime, result.audio_b64)}
                className="mt-2 w-full"
              >
                Tu navegador no puede reproducir la crítica hablada.
              </audio>
            )}

            <div
              className={cn(
                "mt-2 font-reading text-[15px] leading-relaxed text-reading-light dark:text-reading-dark",
                "[&_p]:mt-3 [&_p:first-child]:mt-0",
                "[&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5",
                "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5",
                "[&_li]:mt-1 [&_strong]:font-semibold",
              )}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.feedback}</ReactMarkdown>
            </div>

            <p className="mt-4 font-ui text-[11px] text-muted-light dark:text-muted-dark">
              {[result.provider, result.transcription.model, result.model].join(" · ")}
            </p>
          </section>
        </div>
      )}
    </Screen>
  );
}

// ─── Piezas de la pantalla ───────────────────────────────────────

function Screen({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "h-full overflow-y-auto overscroll-contain",
        // pb-24 en móvil deja sitio a la barra inferior; en escritorio no hay
        // barra y sobra tanto hueco.
        "px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-24 short:pt-4 md:pb-10",
        className,
      )}
    >
      {/* A 1440px una columna a sangre daría líneas de 1300px: ilegible. */}
      <div className="mx-auto w-full max-w-2xl">{children}</div>
    </div>
  );
}

function Cabecera() {
  return (
    <header>
      <p className="font-ui text-[10px] uppercase tracking-[0.25em] text-amber-700 dark:text-amber-500">
        Practicar
      </p>
      <h1 className="mt-1 font-display text-2xl leading-tight text-reading-light dark:text-reading-dark">
        Ensayar en voz alta
      </h1>
      <p className="mt-2 font-ui text-sm text-muted-light dark:text-muted-dark">
        Graba tu parte y te digo cómo ha sonado: el tiempo real, si el pasaje se
        aplicó y dónde afinar.
      </p>
    </header>
  );
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="mt-6 rounded-xl border border-seam-light px-4 py-4 dark:border-seam-dark"
    >
      <h2 className="font-ui text-sm font-medium text-reading-light dark:text-reading-dark">
        {titulo}
      </h2>
      <p className="mt-2 font-ui text-sm leading-relaxed text-muted-light dark:text-muted-dark">
        {children}
      </p>
    </div>
  );
}

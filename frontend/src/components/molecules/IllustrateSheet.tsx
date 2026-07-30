import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { useAiSettingsStore } from "@/store/aiSettingsStore";
import { estimatedCost, generateImage } from "@/services/imageClient";
import { saveImage, type ChatImageRow } from "@/db/repositories/imagesRepository";
import type { ImageQuality } from "@/types/aiSettings";
import { IconClose } from "@/components/atoms/Icons";

const QUALITIES: Array<{ id: ImageQuality; label: string }> = [
  { id: "low", label: "Rápida" },
  { id: "medium", label: "Normal" },
  { id: "high", label: "Alta" },
];

interface IllustrateSheetProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  messageId: string;
  /** Descripción propuesta, ya editable desde el primer render. */
  initialPrompt: string;
  onGenerated: (image: ChatImageRow) => void;
}

/**
 * IllustrateSheet — generar una ilustración para una respuesta.
 *
 * Tres decisiones que definen el componente:
 *
 *  1. **El prompt llega escrito y editable.** Proponer sin decidir: el usuario
 *     ve exactamente qué se va a pedir antes de gastar un céntimo.
 *  2. **El coste está a la vista, antes del botón.** Una imagen de alta calidad
 *     puede costar veinte céntimos; enterarse después es inaceptable.
 *  3. **El tiempo transcurrido se muestra durante la espera.** Son entre 30 y
 *     90 segundos: sin un contador, la app parece colgada.
 *
 * z-[130] como el resto de hojas: por encima de BottomNav (z-120).
 */
export function IllustrateSheet({
  open,
  onClose,
  conversationId,
  messageId,
  initialPrompt,
  onGenerated,
}: IllustrateSheetProps) {
  const settings = useAiSettingsStore((s) => s.settings);
  const providers = useAiSettingsStore((s) => s.providers);
  const setImageModel = useAiSettingsStore((s) => s.setImageModel);
  const setImageQuality = useAiSettingsStore((s) => s.setImageQuality);
  const reducedMotion = usePrefersReducedMotion();

  const [prompt, setPrompt] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (open) setPrompt(initialPrompt);
  }, [open, initialPrompt]);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  if (!open) return null;

  const provider = providers.find((p) => p.id === settings.provider) ?? providers[0];
  const imageModels = provider?.image_models ?? [];
  const model = imageModels.includes(settings.imageModel)
    ? settings.imageModel
    : (imageModels[0] ?? "");

  const run = async () => {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);

    try {
      const result = await generateImage({
        prompt: prompt.trim(),
        provider: settings.provider,
        model,
        quality: settings.imageQuality,
        n: 1,
      });

      const first = result.images[0];
      if (!first) throw new Error("El proveedor no devolvió ninguna imagen.");

      const saved = saveImage({
        conversationId,
        messageId,
        prompt: prompt.trim(),
        provider: result.provider,
        model: result.model,
        mime: first.mime,
        width: first.width,
        height: first.height,
        dataB64: first.b64,
      });

      onGenerated(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar.");
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex flex-col justify-end">
      <button
        aria-label="Cerrar"
        onClick={() => !busy && onClose()}
        className="absolute inset-0 bg-ink-200/40 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-label="Ilustrar esta respuesta"
        className={cn(
          "relative max-h-[88dvh] overflow-y-auto rounded-t-2xl",
          "bg-paper-50 pb-[max(1rem,env(safe-area-inset-bottom))] dark:bg-ink-100",
          !reducedMotion && "animate-sheet-up",
        )}
      >
        <div className="sticky top-0 flex items-center justify-between bg-paper-50 px-4 py-3 dark:bg-ink-100">
          <p className="font-ui text-xs font-medium uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
            Ilustrar esta respuesta
          </p>
          <button
            onClick={() => !busy && onClose()}
            aria-label="Cerrar"
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-light dark:text-muted-dark"
          >
            <IconClose width={18} height={18} />
          </button>
        </div>

        <div className="px-4 pb-2">
          <label
            htmlFor="illustrate-prompt"
            className="font-ui text-xs text-muted-light dark:text-muted-dark"
          >
            Qué quieres ver. Descríbelo como una escena real: un objeto, un
            paisaje o un fenómeno concreto.
          </label>
          <textarea
            id="illustrate-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            maxLength={1400}
            className={cn(
              "mt-2 w-full resize-none rounded-xl bg-paper-200 px-3 py-2",
              "font-ui text-base text-reading-light outline-none sm:text-sm",
              "dark:bg-ink-50 dark:text-reading-dark",
            )}
          />

          {imageModels.length > 1 && (
            <>
              <p className="mt-3 font-ui text-[11px] uppercase tracking-[0.15em] text-muted-light dark:text-muted-dark">
                Modelo
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {imageModels.map((id) => (
                  <Chip
                    key={id}
                    active={id === model}
                    onClick={() => setImageModel(id)}
                  >
                    {id}
                  </Chip>
                ))}
              </div>
            </>
          )}

          <p className="mt-3 font-ui text-[11px] uppercase tracking-[0.15em] text-muted-light dark:text-muted-dark">
            Calidad
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {QUALITIES.map((quality) => (
              <Chip
                key={quality.id}
                active={quality.id === settings.imageQuality}
                onClick={() => setImageQuality(quality.id)}
              >
                {quality.label}
              </Chip>
            ))}
          </div>

          <p className="mt-3 font-ui text-xs text-muted-light dark:text-muted-dark">
            Coste aproximado:{" "}
            <strong className="text-reading-light dark:text-reading-dark">
              {estimatedCost(model, settings.imageQuality, 1)}
            </strong>
            {" · "}
            {model || "sin modelo de imagen"}
          </p>

          {error && (
            <p role="alert" className="mt-2 font-ui text-xs text-red-700 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            onClick={() => void run()}
            disabled={busy || !prompt.trim()}
            className={cn(
              "mt-3 flex h-12 w-full items-center justify-center rounded-full",
              "bg-amber-600 font-ui text-sm font-medium text-paper-50",
              "disabled:opacity-60 active:scale-[0.98] dark:bg-amber-700",
            )}
          >
            {busy ? `Generando… ${elapsed} s` : "Generar"}
          </button>

          <p className="mt-2 font-ui text-[11px] text-muted-light dark:text-muted-dark">
            Las imágenes se guardan en este dispositivo. Descárgalas si quieres
            conservarlas: solo se guardan las 24 últimas.
          </p>
        </div>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex min-h-[44px] items-center rounded-full px-3 font-ui text-xs font-medium",
        active
          ? "bg-amber-600 text-paper-50 dark:bg-amber-700"
          : "bg-paper-200 text-muted-light hover:text-reading-light dark:bg-ink-50 dark:text-muted-dark dark:hover:text-reading-dark",
      )}
    >
      {children}
    </button>
  );
}

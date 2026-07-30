import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { useIsMobile, useIsTouch } from "@/hooks/useMediaQuery";
import { useReaderStore } from "@/store/readerStore";
import { getDailyText } from "@/services/jwDailyClient";
import { ModePicker } from "@/components/molecules/ModePicker";
import { IconClose } from "@/components/atoms/Icons";

/** Contexto que se pega desde el lector. Más allá se dispara el coste y no aporta. */
const MAX_CONTEXT_CHARS = 1500;

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  isStreaming: boolean;
  mode: string;
  onModeChange: (mode: string) => void;
  placeholder?: string;
  className?: string;
}

export interface ChatComposerHandle {
  focus: () => void;
}

/**
 * ChatComposer — la caja de escribir.
 *
 * Tres decisiones que no son de estilo:
 *
 *  1. **Nunca se deshabilita mientras la IA responde.** Antes lo hacía, y en
 *     iOS/Android eso cierra el teclado y pierde el foco: no se podía ir
 *     redactando la siguiente pregunta durante los 60 s de investigación.
 *     Lo que cambia es el botón, que pasa a "detener".
 *  2. **En móvil, Enter hace salto de línea** y se envía con el botón. En un
 *     teclado táctil, Enter-envía manda medio mensaje constantemente.
 *  3. **Botón de 48 px.** El de 36 (`size="icon"`) queda por debajo del
 *     mínimo táctil recomendado y se falla con el pulgar.
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  onCancel,
  isStreaming,
  mode,
  onModeChange,
  placeholder,
  className,
}: ChatComposerProps) {
  // "Táctil" y no "móvil": una tablet de 1024px también escribe con un
  // teclado en pantalla, y ahí Enter-envía manda medio mensaje.
  const isTouch = useIsMobile() || useIsTouch();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const article = useReaderStore((s) => s.article);

  // Autoresize. Se recalcula también al vaciar el campo tras enviar.
  //
  // Con el campo vacío NO se mide: `scrollHeight` cuenta también el
  // placeholder, y en una pantalla de 320px ese texto ocupa tres líneas, así
  // que el composer arrancaba con 100px de alto sin que nadie hubiera escrito
  // nada. Vacío se deja que mande la altura mínima de la clase.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!value) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isTouch) return; // El botón es el único envío en táctil.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const appendContext = (title: string, body: string) => {
    const trimmed = body.slice(0, MAX_CONTEXT_CHARS).trim();
    const block = `> **${title}**\n> ${trimmed.replace(/\n+/g, "\n> ")}\n\n`;
    onChange(block + value);
    setAttachOpen(false);
    textareaRef.current?.focus();
  };

  const useCurrentReading = () => {
    if (!article) return;
    const body = article.blocks
      .map((b) => b.content)
      .join("\n")
      .slice(0, MAX_CONTEXT_CHARS);
    appendContext(article.title, body);
  };

  const useDailyText = async () => {
    try {
      const daily = await getDailyText();
      appendContext(
        `Texto del día · ${daily.date_label}`,
        `${daily.theme_text} (${daily.theme_scripture_ref})`,
      );
    } catch {
      setAttachOpen(false);
    }
  };

  return (
    <div
      className={cn(
        "shrink-0 border-t border-seam-light bg-paper-50 dark:border-seam-dark dark:bg-ink-100",
        // El teclado móvil no encoge 100dvh: --kb-inset lo compensa.
        "px-3 pt-2 pb-[max(var(--kb-inset,0px),env(safe-area-inset-bottom),0.75rem)]",
        // Apaisado: 390px de alto no admiten el mismo acolchado que 844.
        "short:pt-1 short:pb-[max(var(--kb-inset,0px),env(safe-area-inset-bottom),0.25rem)]",
        className,
      )}
    >
      {attachOpen && (
        <div className="mb-2 flex flex-wrap gap-2">
          <button
            onClick={useCurrentReading}
            disabled={!article}
            className="flex h-11 items-center rounded-full bg-paper-200 px-4 font-ui text-xs text-reading-light disabled:opacity-40 dark:bg-ink-50 dark:text-reading-dark"
          >
            Usar el texto que estoy leyendo
          </button>
          <button
            onClick={() => void useDailyText()}
            className="flex h-11 items-center rounded-full bg-paper-200 px-4 font-ui text-xs text-reading-light dark:bg-ink-50 dark:text-reading-dark"
          >
            Usar el texto del día
          </button>
        </div>
      )}

      <div className="mb-2 flex min-w-0 items-center gap-2 short:mb-1">
        <ModePicker value={mode} onChange={onModeChange} className="min-w-0" />
      </div>

      <div className="flex items-end gap-2">
        <button
          onClick={() => setAttachOpen((o) => !o)}
          aria-label="Añadir contexto"
          aria-expanded={attachOpen}
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-full short:h-10 short:w-10",
            "font-ui text-xl leading-none text-muted-light",
            "transition-transform duration-150 active:scale-95",
            "dark:text-muted-dark",
            attachOpen && "bg-paper-200 text-reading-light dark:bg-ink-50 dark:text-reading-dark",
          )}
        >
          {attachOpen ? "×" : "+"}
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Escribe tu pregunta…"}
          rows={1}
          enterKeyHint={isTouch ? "enter" : "send"}
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          inputMode="text"
          className={cn(
            // El tope era 40dvh: en un móvil de 568px eso son 227px de caja
            // de escribir y dos líneas de conversación visibles. Con el mínimo
            // de los dos, el texto largo hace scroll dentro del campo y la
            // conversación no desaparece.
            // 48 y no 44: con `py-3` y una línea de 16px el contenido pide
            // exactamente 48px. A 44 se veía media segunda línea del
            // placeholder asomando por debajo, cortada.
            "min-h-[48px] max-h-[min(40dvh,10rem)] flex-1 resize-none",
            "rounded-2xl bg-paper-100 px-4 py-3",
            // 16px exactos: por debajo, iOS hace zoom al enfocar el campo y
            // deja la vista descuadrada al volver.
            "font-ui text-base text-reading-light sm:text-sm",
            "placeholder:text-muted-light/60",
            "ring-1 ring-seam-light focus:outline-none focus:ring-2 focus:ring-amber-500",
            "dark:bg-ink-50 dark:text-reading-dark dark:ring-seam-dark dark:placeholder:text-muted-dark/60 dark:focus:ring-amber-400",
          )}
        />

        {isStreaming ? (
          <button
            onClick={onCancel}
            aria-label="Detener la respuesta"
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full short:h-10 short:w-10",
              "border border-seam-light text-reading-light",
              "transition-transform duration-150 active:scale-95",
              "dark:border-seam-dark dark:text-reading-dark",
            )}
          >
            <IconClose width={18} height={18} />
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!value.trim()}
            aria-label="Enviar"
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full short:h-10 short:w-10",
              "bg-amber-600 text-paper-50 dark:bg-amber-700",
              "transition-transform duration-150 active:scale-95",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        )}
      </div>

      {!isTouch && (
        <p className="mt-1.5 font-ui text-[10px] text-muted-light/60 dark:text-muted-dark/60">
          Enter para enviar · Shift+Enter para nueva línea
        </p>
      )}
    </div>
  );
}

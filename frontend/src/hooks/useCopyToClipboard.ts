import { useCallback, useEffect, useRef, useState } from "react";

/** Cuánto dura el "Copiado" antes de volver al icono. */
const FEEDBACK_MS = 1800;

interface UseCopyToClipboardReturn {
  copy: (text: string) => Promise<boolean>;
  copied: boolean;
}

/**
 * useCopyToClipboard — copiar con red de seguridad.
 *
 * `navigator.clipboard` no está en todas partes: falta en contextos no
 * seguros (HTTP) y en algunos WebView de Android. El fallback con un
 * `<textarea>` oculto y `execCommand` está obsoleto pero sigue funcionando
 * justo donde el moderno no llega, y aquí copiar es el remate del caso de uso
 * principal: no puede fallar en silencio.
 */
export function useCopyToClipboard(): UseCopyToClipboardReturn {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = useCallback(async (text: string): Promise<boolean> => {
    if (!text) return false;

    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }

    if (!ok) ok = legacyCopy(text);

    if (ok) {
      navigator.vibrate?.(10);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), FEEDBACK_MS);
    }

    return ok;
  }, []);

  return { copy, copied };
}

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    // Fuera de la vista pero enfocable: display:none no permite seleccionar.
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-9999px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** ¿Puede el navegador compartir de forma nativa? */
export function canShare(): boolean {
  return typeof navigator !== "undefined" && "share" in navigator;
}

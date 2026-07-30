import { useEffect, useState } from "react";
import {
  clearImages,
  formatBytes,
  imagesFootprint,
} from "@/db/repositories/imagesRepository";
import { IconLayers } from "@/components/atoms/Icons";

/**
 * ImagesSettingsRow — cuánto ocupan las ilustraciones y cómo vaciarlas.
 *
 * Existe porque el peso de las imágenes es el único punto donde el usuario
 * puede hacer que la app se arrastre sin entender por qué: sql.js serializa la
 * base entera en cada guardado. Un medidor visible convierte un problema
 * invisible en una decisión suya.
 */
export function ImagesSettingsRow() {
  const [footprint, setFootprint] = useState({ count: 0, bytes: 0 });
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    try {
      setFootprint(imagesFootprint());
    } catch {
      // La base aún no está lista: la fila se queda a cero, sin romper nada.
    }
  }, []);

  if (footprint.count === 0) return null;

  return (
    <div className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-3">
      <span className="min-w-0 font-ui text-sm text-reading-light dark:text-reading-dark">
        Imágenes guardadas
        <span className="ml-2 font-ui text-xs text-muted-light dark:text-muted-dark">
          {footprint.count} · {formatBytes(footprint.bytes)}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => {
            if (!confirm) {
              setConfirm(true);
              return;
            }
            clearImages();
            setFootprint({ count: 0, bytes: 0 });
            setConfirm(false);
          }}
          onBlur={() => setConfirm(false)}
          className="flex min-h-[44px] items-center rounded-full px-3 font-ui text-xs font-medium text-muted-light hover:text-red-700 dark:text-muted-dark"
        >
          {confirm ? "¿Vaciar todo?" : "Vaciar"}
        </button>
        <IconLayers width={15} height={15} className="text-muted-light dark:text-muted-dark" />
      </span>
    </div>
  );
}

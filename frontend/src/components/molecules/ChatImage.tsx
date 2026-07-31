import { useState } from "react";
import { cn } from "@/utils/cn";
import { canShare, useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { deleteImage, type ChatImageRow } from "@/db/repositories/imagesRepository";
import { toDataUri } from "@/services/imageClient";
import { imageFileName } from "@/utils/illustrationPrompt";

interface ChatImageProps {
  image: ChatImageRow;
  onDeleted: (imageId: string) => void;
  onRegenerate?: () => void;
}

/** base64 → Blob, sin pasar por `fetch` (que en algunos WebView falla con data:). */
function toBlob(image: ChatImageRow): Blob {
  const binary = atob(image.dataB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: image.mime });
}

/**
 * La imagen como PNG, reconvirtiéndola si hace falta.
 *
 * El portapapeles de los navegadores **solo acepta PNG**, y al proveedor se le
 * pide WebP (pesa la tercera parte y la base entera se serializa en cada
 * guardado). Sin esta conversión el botón "Copiar" no aparecía nunca: la
 * condición era `mime === "image/png"` y con el proveedor por defecto eso es
 * falso siempre.
 */
async function toPngBlob(image: ChatImageRow): Promise<Blob> {
  const original = toBlob(image);
  if (image.mime === "image/png") return original;

  const bitmap = await createImageBitmap(original);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Sin contexto 2D para convertir la imagen.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo convertir."))),
      "image/png",
    );
  });
}

/**
 * ChatImage — una ilustración generada, con sus acciones.
 *
 * **Descargar va primero a propósito.** Solo se guardan las 24 últimas
 * imágenes en la base local, así que el archivo en Descargas es el único
 * respaldo que no caduca. Compartir y copiar son comodidad; descargar es la
 * red de seguridad.
 *
 * Copiar convierte a PNG antes de escribir: el portapapeles de los navegadores
 * no acepta otra cosa y al proveedor se le pide WebP. Antes se comprobaba
 * `mime === "image/png"` y el botón, sencillamente, no salía nunca.
 */
export function ChatImage({ image, onDeleted, onRegenerate }: ChatImageProps) {
  const { copy } = useCopyToClipboard();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const src = toDataUri(image.mime, image.dataB64);
  const canCopy =
    typeof window !== "undefined" &&
    typeof window.ClipboardItem !== "undefined" &&
    Boolean(navigator.clipboard?.write) &&
    typeof window.createImageBitmap === "function";

  const download = () => {
    const url = URL.createObjectURL(toBlob(image));
    const link = document.createElement("a");
    link.href = url;
    link.download = imageFileName(image.prompt, image.mime);
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Descargada.");
  };

  const share = async () => {
    const file = new File([toBlob(image)], imageFileName(image.prompt, image.mime), {
      type: image.mime,
    });
    if (canShare() && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch {
        // Cancelado o no permitido: se degrada a descargar, que siempre sirve.
      }
    }
    download();
  };

  const copyImage = async () => {
    try {
      // La promesa va DENTRO del ClipboardItem, no antes del `write`: Safari
      // exige que la escritura salga del propio gesto del usuario y un `await`
      // por delante ya la deja fuera.
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": toPngBlob(image) }),
      ]);
      setStatus("Copiada.");
    } catch {
      await copy(image.prompt);
      setStatus("Copiada la descripción.");
    }
  };

  return (
    <figure className="mt-3 max-w-[68ch]">
      <img
        src={src}
        alt={image.prompt.slice(0, 140)}
        loading="lazy"
        width={image.width || undefined}
        height={image.height || undefined}
        className="w-full rounded-xl border border-seam-light dark:border-seam-dark"
      />

      <figcaption className="-ml-2 mt-1 flex flex-wrap items-center gap-1">
        <Action onClick={download}>Descargar</Action>

        {canShare() && <Action onClick={() => void share()}>Compartir</Action>}

        {canCopy && <Action onClick={() => void copyImage()}>Copiar</Action>}

        {onRegenerate && <Action onClick={onRegenerate}>Regenerar</Action>}

        <Action
          danger={confirmDelete}
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            deleteImage(image.imageId);
            onDeleted(image.imageId);
          }}
          onBlur={() => setConfirmDelete(false)}
        >
          {confirmDelete ? "¿Seguro?" : "Borrar"}
        </Action>
      </figcaption>

      {status && (
        <p role="status" className="font-ui text-[11px] text-muted-light dark:text-muted-dark">
          {status}
        </p>
      )}
    </figure>
  );
}

function Action({
  onClick,
  onBlur,
  danger = false,
  children,
}: {
  onClick: () => void;
  onBlur?: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      onBlur={onBlur}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3",
        "font-ui text-xs font-medium",
        danger
          ? "text-red-700 dark:text-red-400"
          : "text-muted-light hover:text-reading-light dark:text-muted-dark dark:hover:text-reading-dark",
      )}
    >
      {children}
    </button>
  );
}

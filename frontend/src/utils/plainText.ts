/**
 * plainText — Markdown a texto plano para pegar.
 *
 * El caso de uso principal de la app termina en un pegado: el comentario va a
 * las notas de la reunión, a un mensaje, a un papel. Ahí los asteriscos y las
 * almohadillas sobran.
 *
 * Lo que NO hace, a propósito: no toca las comillas tipográficas ni los signos
 * de apertura españoles, no reordena nada y no traduce. El texto que se pega
 * tiene que ser el texto que se leyó.
 *
 * Tabla de casos (verificada a mano):
 *   "**Hola** _mundo_"          → "Hola mundo"
 *   "## Título\n\ntexto"        → "Título\n\ntexto"
 *   "> «Un comentario»"         → "«Un comentario»"
 *   "- uno\n- dos"              → "• uno\n• dos"
 *   "1. uno\n2. dos"            → "1. uno\n2. dos"
 *   "[wol](https://wol.jw.org)" → "wol"
 *   "`código`"                  → "código"
 */

import type { ChatSegment } from "@/utils/chatSegments";
import type { ChatSource } from "@/types/chat";

export function markdownToPlainText(md: string): string {
  let out = md ?? "";

  // 1. Vallas de código: se conserva el contenido, se quita la valla.
  out = out.replace(/^\s*```[^\n]*\n?/gm, "").replace(/^\s*```\s*$/gm, "");
  // 2. Código inline.
  out = out.replace(/`([^`]+)`/g, "$1");
  // 3. Enlaces e imágenes: queda el texto.
  out = out.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  // 4. Énfasis. **/__ antes que */_ para no dejar un asterisco suelto.
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/__([^_]+)__/g, "$1");
  out = out.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1");
  out = out.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1");
  // 5. Encabezados: el texto y una línea en blanco detrás.
  out = out.replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, "$1\n");
  // 6. Marca de cita. Las comillas que haya dentro se quedan.
  out = out.replace(/^\s{0,3}>\s?/gm, "");
  // 7. Viñetas → •. Las ordenadas conservan su número.
  out = out.replace(/^(\s*)[-*+]\s+/gm, "$1• ");
  out = out.replace(/^(\s*)(\d+)[.)]\s+/gm, "$1$2. ");
  // 8. Reglas horizontales.
  out = out.replace(/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/gm, "");
  // 9. Espaciado.
  out = out.replace(/[ \t]+$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}

/** Texto plano de una respuesta ya segmentada. */
export function segmentsToPlainText(segments: ChatSegment[]): string {
  return segments
    .map((segment) =>
      segment.kind === "quote" ? segment.plain : markdownToPlainText(segment.markdown),
    )
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

/** Una línea por fuente: "Isaías 58:12 — w21 mayo págs. 8-12". */
export function sourcesToPlainText(sources: ChatSource[]): string {
  return sources
    .map((source) => (source.citation ? `${source.label} — ${source.citation}` : source.label))
    .join("\n");
}

/** La conversación entera en Markdown, para descargar como .md. */
export function conversationToMarkdown(
  title: string,
  messages: {
    role: "user" | "assistant";
    content: string;
    sources: ChatSource[];
  }[],
): string {
  const parts: string[] = [`# ${title}`, ""];

  for (const message of messages) {
    parts.push(message.role === "user" ? "## Pregunta" : "## Respuesta");
    parts.push("");
    parts.push(message.content.trim());
    parts.push("");

    if (message.role === "assistant" && message.sources.length > 0) {
      parts.push("### Fuentes");
      parts.push("");
      for (const source of message.sources) {
        const citation = source.citation ? ` — ${source.citation}` : "";
        parts.push(source.url ? `- [${source.label}](${source.url})${citation}` : `- ${source.label}${citation}`);
      }
      parts.push("");
    }
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Nombre de fichero seguro a partir del título de la conversación. */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "conversacion"
  );
}

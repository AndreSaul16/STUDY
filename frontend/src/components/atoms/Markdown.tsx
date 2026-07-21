import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/utils/cn";

interface MarkdownProps {
  /** Texto en formato Markdown a renderizar. */
  children: string;
  className?: string;
}

/**
 * Markdown — renderiza texto Markdown con estilos coherentes con el tema.
 *
 * Usa react-markdown + remark-gfm (tablas, listas de tareas, tachado…).
 * SEGURIDAD: NO habilita HTML crudo (sin rehype-raw) — cualquier HTML en el
 * contenido se muestra como texto plano, no se interpreta.
 *
 * Pensado para respuestas del asistente (AIPanel / ChatPanel). Los mensajes
 * del usuario se siguen mostrando como texto plano.
 */

const components: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 first:mt-0 text-lg font-semibold">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 first:mt-0 text-base font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 first:mt-0 text-sm font-semibold">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 last:mb-0 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 last:mb-0 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-amber-700 underline underline-offset-2 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-seam-light pl-3 italic text-muted-light dark:border-seam-dark dark:text-muted-dark">
      {children}
    </blockquote>
  ),
  code: ({ className: codeClass, children }) => {
    const isBlock = /language-/.test(codeClass ?? "");
    if (isBlock) {
      return (
        <code className="block overflow-x-auto rounded-md bg-paper-200 p-3 font-mono text-xs dark:bg-ink-50">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-paper-200 px-1 py-0.5 font-mono text-[0.85em] dark:bg-ink-50">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="mb-3 last:mb-0">{children}</pre>,
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-seam-light px-2 py-1 text-left font-semibold dark:border-seam-dark">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-seam-light px-2 py-1 dark:border-seam-dark">
      {children}
    </td>
  ),
  hr: () => <hr className="my-3 border-seam-light dark:border-seam-dark" />,
};

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn("text-reading-light dark:text-reading-dark", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

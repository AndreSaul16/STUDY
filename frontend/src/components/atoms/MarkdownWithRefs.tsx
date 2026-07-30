import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/utils/cn";
import { linkifyChildren } from "@/utils/linkifyReferences";
import { useReferenceEngine } from "@/hooks/useReferenceEngine";

interface MarkdownWithRefsProps {
  children: string;
  className?: string;
}

/**
 * MarkdownWithRefs — el Markdown del chat, con las citas bíblicas tocables.
 *
 * Igual que `Markdown` pero envolviendo los hijos de los nodos de texto con
 * `linkifyChildren`. Se aplica en p, li, strong, em, blockquote y td, y NO en
 * `a` ni en `code`: un chip dentro de un enlace o de un bloque de código sería
 * un estorbo, no una ayuda.
 *
 * SEGURIDAD: sin `rehype-raw`, igual que `Markdown`. El HTML que venga en la
 * respuesta se muestra como texto, no se interpreta.
 */
export function MarkdownWithRefs({ children, className }: MarkdownWithRefsProps) {
  const { detectReferences, openReference } = useReferenceEngine();

  const components = useMemo<Components>(() => {
    const link = (nodes: React.ReactNode, key: string) =>
      linkifyChildren(nodes, detectReferences, (ref) => void openReference(ref), key);

    return {
      p: ({ children: c }) => (
        <p className="mb-3 leading-relaxed last:mb-0">{link(c, "p")}</p>
      ),
      h1: ({ children: c }) => (
        <h1 className="mb-2 mt-4 text-lg font-semibold first:mt-0">{c}</h1>
      ),
      h2: ({ children: c }) => (
        <h2 className="mb-2 mt-4 text-base font-semibold first:mt-0">{c}</h2>
      ),
      h3: ({ children: c }) => (
        <h3 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{c}</h3>
      ),
      ul: ({ children: c }) => (
        <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">{c}</ul>
      ),
      ol: ({ children: c }) => (
        <ol className="mb-3 list-decimal space-y-1.5 pl-5 last:mb-0">{c}</ol>
      ),
      li: ({ children: c }) => (
        <li className="leading-relaxed">{link(c, "li")}</li>
      ),
      strong: ({ children: c }) => (
        <strong className="font-semibold">{link(c, "strong")}</strong>
      ),
      em: ({ children: c }) => <em className="italic">{link(c, "em")}</em>,
      a: ({ href, children: c }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-amber-700 underline underline-offset-2 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
        >
          {c}
        </a>
      ),
      blockquote: ({ children: c }) => (
        <blockquote className="mb-3 border-l-2 border-amber-600/50 pl-3 text-reading-light dark:border-amber-500/50 dark:text-reading-dark">
          {link(c, "bq")}
        </blockquote>
      ),
      code: ({ className: codeClass, children: c }) => {
        const isBlock = /language-/.test(codeClass ?? "");
        if (isBlock) {
          return (
            <code className="block overflow-x-auto rounded-md bg-paper-200 p-3 font-mono text-xs dark:bg-ink-50">
              {c}
            </code>
          );
        }
        return (
          <code className="rounded bg-paper-200 px-1 py-0.5 font-mono text-[0.85em] dark:bg-ink-50">
            {c}
          </code>
        );
      },
      pre: ({ children: c }) => <pre className="mb-3 last:mb-0">{c}</pre>,
      table: ({ children: c }) => (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">{c}</table>
        </div>
      ),
      th: ({ children: c }) => (
        <th className="border border-seam-light px-2 py-1 text-left font-semibold dark:border-seam-dark">
          {c}
        </th>
      ),
      td: ({ children: c }) => (
        <td className="border border-seam-light px-2 py-1 dark:border-seam-dark">
          {link(c, "td")}
        </td>
      ),
      hr: () => <hr className="my-4 border-seam-light dark:border-seam-dark" />,
    };
  }, [detectReferences, openReference]);

  return (
    <div className={cn("text-reading-light dark:text-reading-dark", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

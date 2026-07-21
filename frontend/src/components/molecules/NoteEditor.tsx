import { useState } from "react";
import { cn } from "@/utils/cn";
import { Button } from "@/components/atoms/Button";
import { IconClose } from "@/components/atoms/Icons";

interface NoteEditorProps {
  /** Nota inicial (vacía si es nueva) */
  initialNote: string | null;
  onSave: (note: string | null) => void;
  onCancel: () => void;
  /** Texto seleccionado para contexto */
  selectedText: string;
}

/**
 * NoteEditor — editor inline para notas sobre anotaciones.
 * Textarea con guardado Cmd/Ctrl+Enter, cancelar Escape.
 */
export function NoteEditor({
  initialNote,
  onSave,
  onCancel,
  selectedText,
}: NoteEditorProps) {
  const [text, setText] = useState(initialNote ?? "");

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSave(text.trim() || null);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg",
        "bg-paper-50 dark:bg-ink-50",
        "ring-1 ring-seam-light dark:ring-seam-dark",
        "p-4",
      )}
    >
      {/* Contexto */}
      <blockquote
        className={cn(
          "border-l-2 border-amber-600/50 pl-3",
          "font-reading text-sm italic text-muted-light dark:text-muted-dark",
          "line-clamp-2",
        )}
      >
        {selectedText}
      </blockquote>

      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escribe tu nota… (⌘+Enter para guardar)"
        rows={3}
        className={cn(
          "w-full resize-none rounded-md",
          "bg-paper-100 dark:bg-ink-100",
          "ring-1 ring-seam-light dark:ring-seam-dark",
          "px-3 py-2",
          "font-ui text-sm text-reading-light dark:text-reading-dark",
          "placeholder:text-muted-light/60 dark:placeholder:text-muted-dark/60",
          "focus:outline-none focus:ring-2 focus:ring-amber-500",
        )}
      />

      <div className="flex items-center justify-between">
        <span className="font-ui text-[10px] uppercase tracking-wider text-muted-light dark:text-muted-dark">
          ⌘ + Enter
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <IconClose width={13} height={13} />
            Cancelar
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => onSave(text.trim() || null)}
          >
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}

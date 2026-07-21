/**
 * annotationsService — persistencia de anotaciones (marcas + notas) en SQLite.
 *
 * Traduce entre el modelo de dominio `Annotation` (frontend) y las tablas
 * `user_marks` / `notes`. El `id` de una anotación persistida es el `mark_id`.
 */

import { marksRepository } from "@/db/repositories/marksRepository";
import { notesRepository } from "@/db/repositories/notesRepository";
import type { Annotation, HighlightColor } from "@/types/domain";

/** Persiste una anotación (marca + nota opcional). Devuelve el markId generado. */
export function persistAnnotation(
  a: Omit<Annotation, "id" | "createdAt">,
  documentId: number,
  publicationKey = "legacy",
  blockContent = "",
): string {
  const startToken = blockContent.slice(0, a.startOffset).match(/\S+/g)?.length ?? 0;
  const tokenCount = a.selectedText.trim().match(/\S+/g)?.length ?? 0;
  const markId = marksRepository.create({
    documentId,
    publicationKey,
    blockId: a.blockId,
    color: a.color,
    startOffset: a.startOffset,
    endOffset: a.endOffset,
    selectedText: a.selectedText,
    startToken,
    endToken: startToken + tokenCount,
    tokenCount,
  });
  if (a.note != null && a.note !== "") {
    notesRepository.create({
      markId, documentId, publicationKey,
      blockId: a.blockId,
      content: a.note,
    });
  }
  return markId;
}

/** Carga todas las anotaciones de un documento desde SQLite. */
export function loadAnnotations(documentId: number, publicationKey = "legacy"): Annotation[] {
  const marks = marksRepository.getByDocument(publicationKey, documentId);
  return marks.map((m) => {
    const note = notesRepository.getByMarkId(m.mark_id);
    return {
      id: m.mark_id,
      blockId: m.block_id,
      startOffset: m.start_offset,
      endOffset: m.end_offset,
      selectedText: m.selected_text,
      color: m.color as HighlightColor,
      note: note ? note.content : null,
      createdAt: (m.created_at ?? 0) * 1000,
    };
  });
}

/** Crea, actualiza o borra la nota asociada a una marca según `note`. */
export function updateAnnotationNote(
  markId: string,
  note: string | null,
  documentId: number,
  blockId: number,
  publicationKey = "legacy",
): void {
  const existing = notesRepository.getByMarkId(markId);
  if (note != null && note !== "") {
    if (existing) {
      notesRepository.update(existing.note_id, { content: note });
    } else {
      notesRepository.create({ markId, documentId, publicationKey, blockId, content: note });
    }
  } else if (existing) {
    notesRepository.delete(existing.note_id);
  }
}

/** Actualiza el color de una marca. */
export function updateAnnotationColor(markId: string, color: HighlightColor): void {
  marksRepository.updateColor(markId, color);
}

/** Elimina una anotación (nota asociada + marca). */
export function deleteAnnotation(markId: string): void {
  const note = notesRepository.getByMarkId(markId);
  if (note) notesRepository.delete(note.note_id);
  marksRepository.delete(markId);
}

import type { Reference, ReferenceResolver, ResolvedReference } from "@/types/reference";
import { REFERENCE_TYPES, RESOLUTION_SOURCES } from "@/types/reference";
import { MOCK_FOOTNOTE_DB, MOCK_FALLBACK } from "@/data/mockResolvers";

/**
 * FootnoteResolver — resuelve notas del autor y notas al pie.
 */
export class FootnoteResolver implements ReferenceResolver {
  readonly type = REFERENCE_TYPES.FOOTNOTE;

  async resolve(ref: Reference): Promise<ResolvedReference> {
    const data = MOCK_FOOTNOTE_DB[ref.identifier] ?? MOCK_FALLBACK;

    return {
      reference: ref,
      title: data.title,
      body: data.body,
      resolvedAt: Date.now(),
      source: RESOLUTION_SOURCES.MOCK,
    };
  }
}

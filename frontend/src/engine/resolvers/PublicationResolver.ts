import type { Reference, ReferenceResolver, ResolvedReference } from "@/types/reference";
import { REFERENCE_TYPES, RESOLUTION_SOURCES } from "@/types/reference";
import { MOCK_PUBLICATION_DB, MOCK_FALLBACK } from "@/data/mockResolvers";

/**
 * PublicationResolver — resuelve referencias a publicaciones periódicas.
 */
export class PublicationResolver implements ReferenceResolver {
  readonly type = REFERENCE_TYPES.PUBLICATION;

  async resolve(ref: Reference): Promise<ResolvedReference> {
    const data = MOCK_PUBLICATION_DB[ref.identifier] ?? {
      ...MOCK_FALLBACK,
      subtitle: undefined,
    };

    return {
      reference: ref,
      title: data.title,
      body: data.body,
      subtitle: data.subtitle,
      resolvedAt: Date.now(),
      source: RESOLUTION_SOURCES.MOCK,
    };
  }
}

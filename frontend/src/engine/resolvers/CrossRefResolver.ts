import type { Reference, ReferenceResolver, ResolvedReference } from "@/types/reference";
import { REFERENCE_TYPES, RESOLUTION_SOURCES } from "@/types/reference";
import { MOCK_CROSSREF_DB, MOCK_FALLBACK } from "@/data/mockResolvers";

/**
 * CrossRefResolver — resuelve referencias cruzadas genéricas.
 */
export class CrossRefResolver implements ReferenceResolver {
  readonly type = REFERENCE_TYPES.CROSS_REFERENCE;

  async resolve(ref: Reference): Promise<ResolvedReference> {
    const data = MOCK_CROSSREF_DB[ref.identifier] ?? MOCK_FALLBACK;

    return {
      reference: ref,
      title: data.title,
      body: data.body,
      resolvedAt: Date.now(),
      source: RESOLUTION_SOURCES.MOCK,
    };
  }
}

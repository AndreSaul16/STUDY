import type { Reference, ReferenceResolver, ResolvedReference } from "@/types/reference";
import { REFERENCE_TYPES, RESOLUTION_SOURCES } from "@/types/reference";
import { MOCK_SCRIPTURE_DB, MOCK_FALLBACK } from "@/data/mockResolvers";

/**
 * ScriptureResolver — resuelve referencias bíblicas desde mock DB.
 *
 * Tubería lista para FastAPI: cuando se conecte el backend, basta
 * sustituir el lookup local por:
 *   const res = await fetch(`/api/references/${ref.identifier}`);
 *   return await res.json();
 */
export class ScriptureResolver implements ReferenceResolver {
  readonly type = REFERENCE_TYPES.SCRIPTURE;

  async resolve(ref: Reference): Promise<ResolvedReference> {
    const data = MOCK_SCRIPTURE_DB[ref.identifier] ?? MOCK_FALLBACK;

    return {
      reference: ref,
      title: data.title,
      body: data.body,
      resolvedAt: Date.now(),
      source: RESOLUTION_SOURCES.MOCK,
    };
  }
}

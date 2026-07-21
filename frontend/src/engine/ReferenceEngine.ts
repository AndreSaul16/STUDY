import type {
  CacheStats,
  DetectedReference,
  Reference,
  ReferenceEngineOptions,
  ReferenceParser,
  ReferenceResolver,
  ResolvedReference,
} from "@/types/reference";
import { RESOLUTION_SOURCES } from "@/types/reference";
import { LRUCache } from "@/engine/LRUCache";
import { createDefaultRegistry, ReferenceRegistry } from "@/engine/registry";

/**
 * ReferenceEngine — núcleo del motor de referencias.
 *
 * Responsabilidades:
 *  1. **Detectar** referencias en texto plano usando los parsers registrados.
 *  2. **Resolver** referencias a contenido expandido usando los resolvers registrados.
 *  3. **Cachear** resultados en una LRU para que la segunda pulsación sea instantánea.
 *  4. **Deduplicar** promesas en vuelo — si dos componentes piden la misma referencia
 *     simultáneamente, solo se hace una resolución.
 *
 * Arquitectura:
 *  - Patrón Strategy: cada ReferenceType tiene su propio parser y resolver.
 *  - Patrón Registry: el engine no conoce los tipos concretos; los obtiene del registry.
 *  - Open/Closed: añadir un nuevo tipo = registrar en el registry, sin tocar este código.
 *
 * Tubería para FastAPI:
 *  El método `resolveReference` hoy usa resolvers mock. Cuando se conecte el backend,
 *  los resolvers harán `fetch('/api/references/{identifier}')` en lugar de leer mock.
 *  El engine, la caché y el hook NO cambian.
 */
export class ReferenceEngine {
  private readonly cache: LRUCache<string, ResolvedReference>;
  private readonly registry: ReferenceRegistry;
  private readonly parsers: ReferenceParser[];
  /** Promesas en vuelo — evita resoluciones duplicadas concurrentes */
  private readonly inflight = new Map<string, Promise<ResolvedReference>>();

  constructor(options: ReferenceEngineOptions = {}) {
    this.cache = new LRUCache<string, ResolvedReference>(
      options.cacheCapacity ?? 128,
    );
    this.registry = options.parsers || options.resolvers
      ? this.buildCustomRegistry(options.parsers, options.resolvers)
      : createDefaultRegistry();
    this.parsers = options.parsers ?? this.registry.getAllParsers();
  }

  // ─── Detección ────────────────────────────────────────────────

  /**
   * Detecta todas las referencias en un texto.
   * Ejecuta todos los parsers registrados y mergea resultados,
   * resolviendo solapamientos (gana el match más largo).
   *
   * @param text Texto fuente a analizar
   * @returns Array de DetectedReference ordenado por posición
   */
  detect(text: string): DetectedReference[] {
    const all: DetectedReference[] = [];

    for (const parser of this.parsers) {
      const found = parser.parse(text);
      all.push(...found);
    }

    // Resolver solapamientos: ordenar por start, y si dos matches se solapan,
    // conservar el más largo (más específico)
    return this.resolveOverlaps(all);
  }

  /**
   * Detecta referencias en un texto y las devuelve deduplicadas por identifier.
   * Útil para alimentar el panel derecho con todas las refs de un capítulo.
   */
  detectUnique(text: string): DetectedReference[] {
    const detected = this.detect(text);
    const seen = new Set<string>();
    return detected.filter((d) => {
      if (seen.has(d.reference.identifier)) return false;
      seen.add(d.reference.identifier);
      return true;
    });
  }

  // ─── Resolución ───────────────────────────────────────────────

  /**
   * Resuelve una referencia a contenido expandido.
   *
   * Flujo cache-first:
   *  1. Si está en caché → devuelve instantáneo (source: cache)
   *  2. Si hay una promesa en vuelo → reutiliza (dedup concurrente)
   *  3. Si no → resuelve via resolver, cachea, devuelve (source: mock/api)
   *
   * @param ref Referencia a resolver
   * @returns ResolvedReference con contenido expandido
   */
  async resolveReference(ref: Reference): Promise<ResolvedReference> {
    // 1. Cache hit
    const cached = this.cache.get(ref.identifier);
    if (cached) {
      // Marcar como cache-hit (reutilizar el objeto pero actualizar source)
      return { ...cached, source: RESOLUTION_SOURCES.CACHE };
    }

    // 2. Promesa en vuelo — dedup
    const inflight = this.inflight.get(ref.identifier);
    if (inflight) {
      return inflight;
    }

    // 3. Resolver, cachear, devolver
    const promise = this.executeResolution(ref);
    this.inflight.set(ref.identifier, promise);

    try {
      const resolved = await promise;
      this.cache.set(ref.identifier, resolved);
      return resolved;
    } finally {
      this.inflight.delete(ref.identifier);
    }
  }

  /**
   * Precalienta la caché para una referencia sin bloquear al usuario.
   * Útil para prefetch al detectar referencias visibles.
   */
  async prefetch(ref: Reference): Promise<void> {
    if (this.cache.has(ref.identifier)) return;
    await this.resolveReference(ref);
  }

  /**
   * Precalienta múltiples referencias en paralelo.
   */
  async prefetchMany(refs: Reference[]): Promise<void> {
    await Promise.all(refs.map((r) => this.prefetch(r)));
  }

  // ─── Caché ────────────────────────────────────────────────────

  /** Estadísticas de la caché LRU. */
  getCacheStats(): CacheStats {
    return {
      size: this.cache.size,
      capacity: this.cache.maxCapacity,
      hits: this.cache.hits,
      misses: this.cache.misses,
      hitRate: this.cache.hitRate,
    };
  }

  /** ¿Está esta referencia en caché? */
  isCached(identifier: string): boolean {
    return this.cache.has(identifier);
  }

  /** Peek público — lee de caché sin actualizar LRU ni contadores. undefined si no está. */
  peekCache(identifier: string): ResolvedReference | undefined {
    return this.cache.peek(identifier);
  }

  /** Vacía la caché. */
  clearCache(): void {
    this.cache.clear();
  }

  // ─── Internos ─────────────────────────────────────────────────

  private async executeResolution(ref: Reference): Promise<ResolvedReference> {
    const resolver = this.registry.getResolver(ref.type);
    // El resolver hace fetch real al backend; la latencia es la de la red.
    return resolver.resolve(ref);
  }

  private resolveOverlaps(refs: DetectedReference[]): DetectedReference[] {
    if (refs.length === 0) return [];

    // Ordenar por start asc, luego por longitud desc (más largo primero)
    const sorted = [...refs].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return (b.end - b.start) - (a.end - a.start);
    });

    const out: DetectedReference[] = [];
    let lastEnd = -1;

    for (const ref of sorted) {
      if (ref.start >= lastEnd) {
        // No solapa — aceptar
        out.push(ref);
        lastEnd = ref.end;
      }
      // Si solapa, se descarta (ya tenemos uno que empezó antes o igual)
    }

    // Reordenar por posición para el consumidor
    return out.sort((a, b) => a.start - b.start);
  }

  private buildCustomRegistry(
    parsers?: ReferenceParser[],
    resolvers?: ReferenceResolver[],
  ): ReferenceRegistry {
    // Si el usuario pasa parsers/resolvers custom, construir registry a medida
    const registry = createDefaultRegistry();
    if (parsers) {
      for (const p of parsers) {
        registry.registerParser(p.type, p);
      }
    }
    if (resolvers) {
      for (const r of resolvers) {
        registry.registerResolver(r.type, r);
      }
    }
    return registry;
  }
}

// ─── Singleton para uso global ───────────────────────────────────

let _instance: ReferenceEngine | null = null;

/**
 * Devuelve la instancia singleton del ReferenceEngine.
 * El hook useReferenceEngine usa esta función.
 */
export function getReferenceEngine(): ReferenceEngine {
  if (!_instance) {
    _instance = new ReferenceEngine();
  }
  return _instance;
}

/** Resetea el singleton — útil para tests o reset de caché. */
export function resetReferenceEngine(): void {
  _instance = null;
}

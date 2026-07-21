import type { ReferenceParser, ReferenceResolver, ReferenceType } from "@/types/reference";
import { ScriptureParser } from "@/engine/parsers/ScriptureParser";
import { PublicationParser } from "@/engine/parsers/PublicationParser";
import { FootnoteParser } from "@/engine/parsers/FootnoteParser";
import { CrossRefParser } from "@/engine/parsers/CrossRefParser";
import { ScriptureResolver } from "@/engine/resolvers/ScriptureResolver";
import { PublicationResolver } from "@/engine/resolvers/PublicationResolver";
import { FootnoteResolver } from "@/engine/resolvers/FootnoteResolver";
import { CrossRefResolver } from "@/engine/resolvers/CrossRefResolver";

/**
 * Registry — Factory central de parsers y resolvers.
 *
 * Mapea cada `ReferenceType` a su implementación concreta de parser y resolver.
 * Añadir un nuevo tipo de fuente externa = registrar una nueva entrada aquí,
 * sin tocar el núcleo del engine (Open/Closed Principle).
 *
 * Uso:
 *   registry.registerParser(REFERENCE_TYPES.NEW_TYPE, new NewParser());
 *   registry.registerResolver(REFERENCE_TYPES.NEW_TYPE, new NewResolver());
 */

class ReferenceRegistry {
  private parsers = new Map<ReferenceType, ReferenceParser>();
  private resolvers = new Map<ReferenceType, ReferenceResolver>();

  /** Registra un parser para un tipo. Sobrescribe si ya existe. */
  registerParser(type: ReferenceType, parser: ReferenceParser): void {
    if (parser.type !== type) {
      throw new Error(
        `Parser type mismatch: registry key "${type}" vs parser.type "${parser.type}"`,
      );
    }
    this.parsers.set(type, parser);
  }

  /** Registra un resolver para un tipo. Sobrescribe si ya existe. */
  registerResolver(type: ReferenceType, resolver: ReferenceResolver): void {
    if (resolver.type !== type) {
      throw new Error(
        `Resolver type mismatch: registry key "${type}" vs resolver.type "${resolver.type}"`,
      );
    }
    this.resolvers.set(type, resolver);
  }

  /** Obtiene el parser de un tipo. Lanza si no está registrado. */
  getParser(type: ReferenceType): ReferenceParser {
    const p = this.parsers.get(type);
    if (!p) throw new Error(`No parser registered for type "${type}"`);
    return p;
  }

  /** Obtiene el resolver de un tipo. Lanza si no está registrado. */
  getResolver(type: ReferenceType): ReferenceResolver {
    const r = this.resolvers.get(type);
    if (!r) throw new Error(`No resolver registered for type "${type}"`);
    return r;
  }

  /** Todos los parsers registrados. */
  getAllParsers(): ReferenceParser[] {
    return [...this.parsers.values()];
  }

  /** ¿Hay un resolver para este tipo? */
  hasResolver(type: ReferenceType): boolean {
    return this.resolvers.has(type);
  }
}

/** Instancia singleton del registry con los defaults registrados. */
export function createDefaultRegistry(): ReferenceRegistry {
  const registry = new ReferenceRegistry();

  // Parsers
  registry.registerParser(
    "scripture" as ReferenceType,
    new ScriptureParser(),
  );
  registry.registerParser(
    "publication" as ReferenceType,
    new PublicationParser(),
  );
  registry.registerParser(
    "footnote" as ReferenceType,
    new FootnoteParser(),
  );
  registry.registerParser(
    "cross_reference" as ReferenceType,
    new CrossRefParser(),
  );

  // Resolvers
  registry.registerResolver(
    "scripture" as ReferenceType,
    new ScriptureResolver(),
  );
  registry.registerResolver(
    "publication" as ReferenceType,
    new PublicationResolver(),
  );
  registry.registerResolver(
    "footnote" as ReferenceType,
    new FootnoteResolver(),
  );
  registry.registerResolver(
    "cross_reference" as ReferenceType,
    new CrossRefResolver(),
  );

  return registry;
}

export { ReferenceRegistry };

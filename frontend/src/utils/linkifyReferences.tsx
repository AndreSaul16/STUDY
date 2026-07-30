import { Fragment, isValidElement, cloneElement, type ReactNode } from "react";
import { ReferenceChip } from "@/components/molecules/ReferenceCard";
import type { DetectedReference, Reference } from "@/types/reference";

/**
 * linkifyChildren — convierte las citas del texto en chips tocables.
 *
 * Reutiliza el motor que ya está en producción sobre el texto del lector
 * (`ScriptureParser` + `ReferenceEngine`): aquí NO se duplica ninguna regex,
 * solo se recorre el árbol que ya generó react-markdown y se parten los nodos
 * de texto en las posiciones que devuelve `detect`.
 *
 * Los nodos que no son cadenas se devuelven intactos, así que el markdown
 * (negritas, listas, enlaces) sigue funcionando igual.
 */
export function linkifyChildren(
  children: ReactNode,
  detect: (text: string) => DetectedReference[],
  onOpen: (ref: Reference) => void,
  keyPrefix = "ref",
): ReactNode {
  if (typeof children === "string") {
    return linkifyString(children, detect, onOpen, keyPrefix);
  }

  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <Fragment key={`${keyPrefix}-${i}`}>
        {linkifyChildren(child, detect, onOpen, `${keyPrefix}-${i}`)}
      </Fragment>
    ));
  }

  if (isValidElement(children)) {
    const element = children as React.ReactElement<{ children?: ReactNode }>;
    const inner = element.props.children;
    // Sin hijos que recorrer (una imagen, un <br/>): se deja tal cual.
    if (inner === undefined || inner === null) return children;
    return cloneElement(element, {
      children: linkifyChildren(inner, detect, onOpen, `${keyPrefix}-c`),
    });
  }

  return children;
}

function linkifyString(
  text: string,
  detect: (text: string) => DetectedReference[],
  onOpen: (ref: Reference) => void,
  keyPrefix: string,
): ReactNode {
  if (!text) return text;

  let detected: DetectedReference[];
  try {
    detected = detect(text);
  } catch {
    // Que el detector falle no puede dejar sin texto al usuario.
    return text;
  }

  if (detected.length === 0) return text;

  const ordered = [...detected].sort((a, b) => a.start - b.start);
  const nodes: ReactNode[] = [];
  let cursor = 0;

  ordered.forEach((match, i) => {
    // Solapamientos: nos quedamos con el primero y descartamos el resto.
    if (match.start < cursor) return;

    if (match.start > cursor) {
      nodes.push(text.slice(cursor, match.start));
    }
    nodes.push(
      <ReferenceChip
        key={`${keyPrefix}-${i}`}
        reference={match.reference}
        label={match.raw}
        onClick={() => onOpen(match.reference)}
      />,
    );
    cursor = match.end;
  });

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

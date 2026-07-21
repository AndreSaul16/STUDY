import type { SVGProps } from "react";

/**
 * Iconos inline SVG — sin librería de iconos.
 * Trazos finos (1.5), heredan currentColor.
 * Estilo editorial: minimal, geométrico.
 */

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconSearch(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

export function IconArrowLeft(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function IconArrowRight(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function IconArrowUp(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

export function IconArrowDown(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function IconStar(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3l2.5 6 6.5.5-5 4.5 1.5 6.5L12 17l-5.5 3.5L8 14 3 9.5 9.5 9z" />
    </svg>
  );
}

export function IconStarFilled(p: IconProps) {
  return (
    <svg {...base} fill="currentColor" stroke="none" {...p}>
      <path d="M12 3l2.5 6 6.5.5-5 4.5 1.5 6.5L12 17l-5.5 3.5L8 14 3 9.5 9.5 9z" />
    </svg>
  );
}

export function IconSun(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function IconMoon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function IconNote(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M5 3h11l4 4v14H5z" />
      <path d="M16 3v4h4M9 12h6M9 16h6" />
    </svg>
  );
}

export function IconHighlight(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M9 11l-4 4v3h3l4-4M9 11l5-5 4 4-5 5M9 11l4 4" />
    </svg>
  );
}

export function IconTrash(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </svg>
  );
}

export function IconBook(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z" />
      <path d="M20 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" />
    </svg>
  );
}

export function IconBookmark(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 3h12v18l-6-4-6 4z" />
    </svg>
  );
}

export function IconLink(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}

export function IconGlossary(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 5h16M4 12h16M4 19h10" />
      <path d="M18 17l2 2 4-4" transform="translate(-4)" />
    </svg>
  );
}

export function IconFootnote(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 3v8a4 4 0 0 0 4 4h2" />
      <path d="M18 3v8a4 4 0 0 1-4 4h-2" />
      <path d="M5 21h6M8 17v4" />
    </svg>
  );
}

export function IconChevronUp(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

export function IconChevronDown(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function IconGrip(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="9" cy="6" r="1" fill="currentColor" />
      <circle cx="15" cy="6" r="1" fill="currentColor" />
      <circle cx="9" cy="12" r="1" fill="currentColor" />
      <circle cx="15" cy="12" r="1" fill="currentColor" />
      <circle cx="9" cy="18" r="1" fill="currentColor" />
      <circle cx="15" cy="18" r="1" fill="currentColor" />
    </svg>
  );
}

/** Mapa de iconos por tipo de referencia — para ReferenceCard */
export const REFERENCE_ICONS = {
  scripture: IconBook,
  footnote: IconFootnote,
  link: IconLink,
  glossary: IconGlossary,
} as const;

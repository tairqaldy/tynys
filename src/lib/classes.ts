import type { ClassId, ClassIdx } from '../api/types';

export const CLASS_IDS: readonly ClassId[] = ['low', 'moderate', 'elevated', 'high'];
export const CLASS_LABEL = ['Low', 'Moderate', 'Elevated', 'High'] as const;
export const CLASS_LETTER = ['L', 'M', 'E', 'H'] as const;
export const CLASS_RANGE = ['≤ 5', '5–15', '15–25', '> 25'] as const;
export const IDX: readonly ClassIdx[] = [0, 1, 2, 3];

/** Fill colour of a class (CSS custom property, defined per theme in tokens.css). */
export const classFill = (i: number) => `var(--c-${CLASS_IDS[i]})`;
/** A darker/lighter tone of the class colour that passes AA as text on the page. */
export const classInk = (i: number) => `var(--c-${CLASS_IDS[i]}-ink)`;
/** Text colour for letters drawn on top of a class fill. */
export const classOn = (i: number) => `var(--c-${CLASS_IDS[i]}-on)`;
/** SVG pattern id overlaid on class fills so classes differ without colour. */
export const classPattern = (i: number) => `url(#pat-${CLASS_IDS[i]})`;

export function argmax(v: readonly number[]): number {
  let k = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[k]) k = i;
  return k;
}


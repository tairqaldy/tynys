/** The Tynys mark: a ring for the city air and two strokes of breath passing through it. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="brandmark" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <circle className="brandmark__ring" cx="14" cy="14" r="12" fill="none" strokeWidth="1.6" />
      <path className="brandmark__breath" d="M5.5 12.2c2.6-2.4 5.2-2.4 7.8 0s5.2 2.4 7.8 0" fill="none" strokeWidth="1.8" strokeLinecap="round" />
      <path className="brandmark__breath brandmark__breath--2" d="M8 17.2c2-1.8 4-1.8 6 0s4 1.8 6 0" fill="none" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

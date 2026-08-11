/**
 * The PaperMind mark.
 *
 * The product's whole claim is that every answer carries the sentence that proves
 * it, so the mark is that: a page with one line struck through in highlighter.
 * The page is drawn in `currentColor` (so it inherits the rail's ink or the
 * accent, wherever it sits) and the highlight band is the same `--hl` token the
 * evidence blocks use — the logo and the product's signature element are
 * literally the same colour.
 *
 * Deliberately not a gradient tile with a generic document glyph inside: that
 * lockup is the default every app ships with.
 */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`brandmark ${className}`.trim()}
      viewBox="0 0 28 28"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      {/* The page — taller than wide, so the silhouette reads as a sheet. Kept to a
          plain rounded rectangle: at 28px in the nav rail, a folded corner or a
          stack of rules collapses into noise. */}
      <rect x="5.4" y="2.6" width="17.2" height="22.8" rx="2.8" fill="none" stroke="currentColor" strokeWidth="1.9" />
      {/* Three lines of text… */}
      <path
        d="M9 8.2h9.2M9 21.2h5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity=".45"
      />
      {/* …and the middle one struck through in highlighter, with the line still
          legible on top of it. That pairing — the band UNDER the text, not instead
          of it — is what makes this a cited sentence rather than a coloured bar.
          Both stay inside the page edge; overshooting it read as a device. */}
      <rect x="7.6" y="12.2" width="12.8" height="4.4" rx="1.4" className="brandmark-hl" />
      <path d="M9 14.4h9.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity=".8" />
    </svg>
  );
}

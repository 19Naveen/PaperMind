/**
 * Route-level loading state.
 *
 * Shaped like the pages it stands in for — an eyebrow, a title, a stats strip
 * and a content grid — so the layout doesn't jump when the real content lands.
 * Fills come from `--inset` via `.skel`; a `--surface` fill is nearly the page
 * ground in dark mode and read as three empty voids.
 */
export default function Loading() {
  return (
    <main className="page" aria-busy="true" aria-label="Loading">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <div className="skel skel-line" style={{ width: 90 }} />
          <div className="skel skel-title mt-2" style={{ width: 280 }} />
          <div className="skel skel-line mt-2" style={{ width: 420, maxWidth: '100%' }} />
        </div>
      </div>

      <div className="card stats">
        {[0, 1, 2, 3].map((cell) => (
          <div key={cell} className="stat">
            <div className="skel skel-line" style={{ width: 74 }} />
            <div className="skel skel-title mt-2" style={{ width: 48 }} />
          </div>
        ))}
      </div>

      <div className="ws-grid mt-6">
        {[0, 1, 2].map((card) => (
          <div key={card} className="skel-card">
            <div className="skel skel-line" style={{ width: '55%' }} />
            <div className="skel skel-line mt-3" style={{ width: '85%' }} />
            <div className="skel skel-line mt-2" style={{ width: '70%' }} />
            <div className="skel skel-line mt-6" style={{ width: '40%' }} />
          </div>
        ))}
      </div>
    </main>
  );
}

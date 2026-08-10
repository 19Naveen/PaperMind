export default function Loading() {
  return (
    <main className="min-h-full bg-ground" aria-busy="true" aria-label="Loading page">
      <div className="border-b-2 border-rule px-4 py-5 sm:px-6">
        <div className="h-2.5 w-24 animate-pulse bg-rule-2" />
        <div className="mt-2 h-6 w-56 animate-pulse bg-rule-2" />
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="h-52 animate-pulse border border-rule bg-surface" />)}
      </div>
    </main>
  );
}

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col justify-center px-6">
      <div className="space-y-5">
        <div className="h-3 w-28 rounded-full bg-ink-100" />
        <div className="space-y-3">
          <div className="h-10 w-full max-w-xl rounded-full bg-ink-100" />
          <div className="h-10 w-full max-w-md rounded-full bg-ink-100" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="h-24 rounded-2xl border border-ink-100 bg-white/60" />
          <div className="h-24 rounded-2xl border border-ink-100 bg-white/60" />
          <div className="h-24 rounded-2xl border border-ink-100 bg-white/60" />
        </div>
      </div>
    </main>
  );
}

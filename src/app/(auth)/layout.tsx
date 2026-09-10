export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border bg-surface px-7 py-4">
        <div className="flex items-center gap-2 font-serif text-lg font-semibold text-ink">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          SDVC
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-7 py-12">
        {children}
      </main>
    </div>
  );
}

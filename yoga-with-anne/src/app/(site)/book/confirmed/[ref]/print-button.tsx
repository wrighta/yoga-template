"use client";

export function PrintButton({ children }: { children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => window.print()} className="underline underline-offset-4">
      {children}
    </button>
  );
}

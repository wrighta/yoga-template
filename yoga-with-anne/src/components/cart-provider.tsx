"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type CartCtx = {
  ids: number[];
  ready: boolean;
  toggle: (id: number) => void;
  remove: (id: number) => void;
  clear: () => void;
  has: (id: number) => boolean;
};

const Ctx = createContext<CartCtx | null>(null);
const KEY = "ya_cart_v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<number[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setIds(parsed.filter((n) => typeof n === "number"));
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const persist = (next: number[]) => {
    setIds(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const value: CartCtx = {
    ids,
    ready,
    toggle: (id) => persist(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]),
    remove: (id) => persist(ids.filter((x) => x !== id)),
    clear: () => persist([]),
    has: (id) => ids.includes(id),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart(): CartCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}

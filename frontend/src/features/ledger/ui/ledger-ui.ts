"use client";

import { useRef, useState } from "react";

import type { Currency } from "@/features/ledger/model/ledger-model";

export function formatMinorUnits(value: number, decimalPlaces: number): string {
  const sign = value < 0 ? "-" : "";
  const digits = Math.abs(value).toString().padStart(decimalPlaces + 1, "0");
  if (decimalPlaces === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -decimalPlaces)}.${digits.slice(-decimalPlaces)}`;
}

export function formatMoney(
  value: number,
  currency: Currency | undefined,
  fallbackCode = "",
): string {
  const amount = formatMinorUnits(value, currency?.decimalPlaces ?? 0);
  const code = currency?.code ?? fallbackCode;
  return code ? `${amount} ${code}` : amount;
}

export function localDateTime(rfc3339: string): string {
  const date = new Date(rfc3339);
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
  ].map((part) => part.toString().padStart(2, "0"));
  return `${parts[0]}-${parts[1]}-${parts[2]}T${parts[3]}:${parts[4]}`;
}

export function utcDateTime(local: string): string {
  return new Date(local).toISOString();
}

export function useLifecycleAction() {
  const active = useRef(new Set<string>());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<unknown>) {
    if (active.current.has(key)) return;
    active.current.add(key);
    setPending(new Set(active.current));
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ledger action failed");
    } finally {
      active.current.delete(key);
      setPending(new Set(active.current));
    }
  }

  return {
    error,
    isPending: (key: string) => pending.has(key),
    run,
  };
}

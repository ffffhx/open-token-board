"use client";

import { useEffect, useMemo, useState } from "react";

const DEFAULT_API_URL = "https://8-218-149-148.anyip.dev/token-board";

export type PrivateBenchmarkUser = {
  userId?: string;
  displayName?: string;
  githubLogin?: string;
  avatarUrl?: string;
};

export type PrivateBenchmarkAccessState = {
  allowed: boolean;
  authenticated: boolean | null;
  base: string;
  error: string | null;
  loading: boolean;
  user: PrivateBenchmarkUser | null;
};

type BenchmarkAccessResponse = {
  allowed?: boolean;
  authenticated?: boolean;
  user?: PrivateBenchmarkUser | null;
};

export function benchmarkApiBase(apiBaseUrl?: string): string {
  return (apiBaseUrl || process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

export function usePrivateBenchmarkAccess(apiBaseUrl?: string): PrivateBenchmarkAccessState {
  const base = useMemo(() => benchmarkApiBase(apiBaseUrl), [apiBaseUrl]);
  const [state, setState] = useState<Omit<PrivateBenchmarkAccessState, "base">>({
    allowed: false,
    authenticated: null,
    error: null,
    loading: true,
    user: null,
  });

  useEffect(() => {
    let active = true;

    setState((current) => ({ ...current, error: null, loading: true }));

    fetch(`${base}/api/benchmark/access`, { cache: "no-store", credentials: "include" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<BenchmarkAccessResponse>;
      })
      .then((payload) => {
        if (!active) return;
        setState({
          allowed: Boolean(payload.allowed),
          authenticated: Boolean(payload.authenticated),
          error: null,
          loading: false,
          user: payload.user ?? null,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          allowed: false,
          authenticated: null,
          error: error instanceof Error ? error.message : String(error),
          loading: false,
          user: null,
        });
      });

    return () => {
      active = false;
    };
  }, [base]);

  return { ...state, base };
}


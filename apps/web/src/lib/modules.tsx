// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

// Plan 12: which optional modules the company has switched on. Screens use
// useModules().isOn(key) to hide a switched-off module's menus, fields and
// buttons. Until the answer arrives (or when it fails) every module counts as
// on, so nothing flickers away for a company that has everything on.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MODULE_KEYS, type ModuleKey, type ModulesState } from "shared";
import { api } from "./api";
import { useAuth } from "./auth-context";

export type ModuleMap = Record<ModuleKey, boolean>;

export interface ModulesContextValue {
  modules: ModuleMap;
  shopType: ModulesState["shopType"];
  /** True when the module is on (or not known yet). */
  isOn: (key: ModuleKey) => boolean;
  loading: boolean;
  /** Reads the map from the API again. */
  refresh: () => Promise<void>;
  /** Uses an answer the API already gave (after switching a module). */
  setState: (state: ModulesState) => void;
}

/** Every module on: the answer while loading, on errors and outside the provider. */
export function allModulesOn(): ModuleMap {
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as ModuleMap;
}

/** A full map from a partial one; a missing key counts as on. */
export function fullModuleMap(partial: Partial<Record<ModuleKey, boolean>> | null | undefined): ModuleMap {
  const map = allModulesOn();
  for (const k of MODULE_KEYS) if (partial && partial[k] === false) map[k] = false;
  return map;
}

function contextValue(modules: ModuleMap, shopType: ModulesState["shopType"], loading: boolean, refresh: () => Promise<void>, setState: (s: ModulesState) => void): ModulesContextValue {
  return { modules, shopType, isOn: (key) => modules[key] !== false, loading, refresh, setState };
}

const noop = async () => {};
const DEFAULT_VALUE = contextValue(allModulesOn(), null, false, noop, () => {});

const ModulesContext = createContext<ModulesContextValue>(DEFAULT_VALUE);

/** Loads GET /modules once the user is known; again after login as someone else. */
export function ModulesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setStateRaw] = useState<{ modules: ModuleMap; shopType: ModulesState["shopType"] }>({ modules: allModulesOn(), shopType: null });
  const [loading, setLoading] = useState(true);
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    try {
      const s = await api.get<ModulesState>("/modules", { redirectOnUnauthorized: false });
      setStateRaw({ modules: fullModuleMap(s.modules), shopType: s.shopType ?? null });
    } catch {
      // Unknown: keep everything showing; the API still refuses switched-off actions.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api
      .get<ModulesState>("/modules", { redirectOnUnauthorized: false })
      .then((s) => {
        if (!cancelled) setStateRaw({ modules: fullModuleMap(s.modules), shopType: s.shopType ?? null });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setState = useCallback((s: ModulesState) => setStateRaw({ modules: fullModuleMap(s.modules), shopType: s.shopType ?? null }), []);
  const value = useMemo(() => contextValue(state.modules, state.shopType, loading, load, setState), [state, loading, load, setState]);
  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>;
}

/** The company's modules; outside the provider every module is on. */
export function useModules(): ModulesContextValue {
  return useContext(ModulesContext);
}

/** For tests and previews: a fixed map (missing keys on), no API calls. */
export function StaticModulesProvider({
  modules,
  shopType = null,
  onRefresh,
  onSetState,
  children,
}: {
  modules: Partial<Record<ModuleKey, boolean>>;
  shopType?: ModulesState["shopType"];
  onRefresh?: () => Promise<void>;
  onSetState?: (s: ModulesState) => void;
  children: ReactNode;
}) {
  const [state, setStateRaw] = useState<{ modules: ModuleMap; shopType: ModulesState["shopType"] }>(() => ({ modules: fullModuleMap(modules), shopType }));
  const setState = useCallback(
    (s: ModulesState) => {
      setStateRaw({ modules: fullModuleMap(s.modules), shopType: s.shopType ?? null });
      onSetState?.(s);
    },
    [onSetState],
  );
  const value = useMemo(() => contextValue(state.modules, state.shopType, false, onRefresh ?? noop, setState), [state, onRefresh, setState]);
  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>;
}

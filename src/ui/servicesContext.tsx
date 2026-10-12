import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { Services, TransportState } from '@/app/contracts';
import type { Project } from '@/model/types';
import type { ViewState, ViewStore } from './viewStore';

export interface AppContextValue {
  services: Services;
  view: ViewStore;
}

/** Provided once by App (AB-06); every hook below reads from it. */
export const AppContext = createContext<AppContextValue | null>(null);

function useAppContext(hook: string): AppContextValue {
  const value = useContext(AppContext);
  if (value === null) throw new Error(`${hook}() must be used inside <AppContext.Provider>.`);
  return value;
}

export function useServices(): Services {
  return useAppContext('useServices').services;
}

export function useViewStore(): ViewStore {
  return useAppContext('useViewStore').view;
}

/** Current view state; re-renders on every view change. */
export function useView(): ViewState {
  const view = useAppContext('useView').view;
  const subscribe = useCallback((onChange: () => void) => view.subscribe(onChange), [view]);
  const snapshot = useCallback(() => view.get(), [view]);
  return useSyncExternalStore(subscribe, snapshot);
}

/** Current project; re-renders on every store change (keyed on the store version). */
export function useProject(): Project {
  const { store } = useAppContext('useProject').services;
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  const snapshot = useCallback(() => store.version(), [store]);
  useSyncExternalStore(subscribe, snapshot);
  return store.get();
}

/** Current transport state; re-renders on every transport event. */
export function useTransportState(): TransportState {
  const { transport } = useAppContext('useTransportState').services;
  const subscribe = useCallback(
    (onChange: () => void) => transport.subscribe(onChange),
    [transport],
  );
  const snapshot = useCallback(() => transport.state(), [transport]);
  return useSyncExternalStore(subscribe, snapshot);
}

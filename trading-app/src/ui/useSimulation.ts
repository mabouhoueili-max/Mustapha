// Owns the running Simulation: loads/saves it on the phone, ticks it on a timer
// while the app is open, and re-renders the screens after every change.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { DEFAULT_SETTINGS, Settings, Simulation } from '../engine/simulation';
import { Side } from '../engine/types';

const STORAGE_KEY = 'tradesim/state/v1';
const SAVE_EVERY_MS = 5000;

export interface SimController {
  sim: Simulation | null;
  version: number;
  running: boolean;
  error: string | null;
  start: () => void;
  pause: () => void;
  reset: (settings: Settings) => void;
  setAutoTrade: (on: boolean) => void;
  manualOrder: (symbol: string, side: Side, quantity: number) => { ok: boolean; message: string };
}

export function useSimulation(): SimController {
  const simRef = useRef<Simulation | null>(null);
  const inFlight = useRef(false);
  const lastSave = useRef(0);
  const [version, setVersion] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const save = useCallback(async () => {
    if (!simRef.current) return;
    lastSave.current = Date.now();
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(simRef.current.toState()));
    } catch {
      // storage full or unavailable: keep running, try again next time
    }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => (raw ? Simulation.fromState(JSON.parse(raw)) : new Simulation(DEFAULT_SETTINGS)))
      .catch(() => new Simulation(DEFAULT_SETTINGS))
      .then((sim) => {
        simRef.current = sim;
        bump();
      });
  }, [bump]);

  const tick = useCallback(async () => {
    const sim = simRef.current;
    if (!sim || inFlight.current) return; // a slow live poll is still running
    inFlight.current = true;
    try {
      const live = sim.settings.mode === 'live';
      if (live && !sim.warmedUp) await sim.warmUp();
      const result = await sim.step();
      if (live && Object.keys(result.snapshot.prices).length === 0) {
        const reasons = Object.values(sim.market.live?.lastErrors ?? {});
        setRunning(false);
        setError(`Couldn't get any live prices${reasons.length ? ` (${reasons[0]})` : ''}. ` +
          'Check your internet connection, or switch to Sim mode in Settings.');
      } else {
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      bump();
      if (Date.now() - lastSave.current > SAVE_EVERY_MS) save();
    }
  }, [bump, save]);

  const intervalSec = simRef.current?.settings.intervalSec;
  useEffect(() => {
    if (!running || !intervalSec) return;
    tick();
    const id = setInterval(() => {
      if (AppState.currentState === 'active') tick();
    }, intervalSec * 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick(); // catch up straight away on return
      else save();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [running, intervalSec, tick, save]);

  return {
    sim: simRef.current,
    version,
    running,
    error,
    start: () => {
      setError(null);
      setRunning(true);
    },
    pause: () => {
      setRunning(false);
      save();
    },
    reset: (settings) => {
      setRunning(false);
      setError(null);
      simRef.current = new Simulation(settings);
      save();
      bump();
    },
    setAutoTrade: (on) => {
      const sim = simRef.current;
      if (!sim) return;
      sim.trader.enabled = on;
      sim.settings.autoTrade = on;
      sim.addLog('trader', sim.market.tick, on ? 'auto-trading switched on' : 'auto-trading switched off');
      save();
      bump();
    },
    manualOrder: (symbol, side, quantity) => {
      const sim = simRef.current;
      if (!sim) return { ok: false, message: 'Still loading.' };
      const r = sim.manualOrder(symbol, side, quantity);
      save();
      bump();
      return r;
    },
  };
}

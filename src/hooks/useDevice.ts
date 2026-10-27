'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { MessageKey, Vars } from '@/i18n';
import { NejeError, NejeSession, toHex, type NejeErrorCode, type SessionSnapshot, type Transport } from '@/lib/protocol';
import { SimulatorTransport } from '@/lib/transport/simulator';
import { BridgeTransport, getTestBridge } from '@/lib/transport/testBridge';
import { WebSerialTransport } from '@/lib/transport/webSerial';

export type ConnectionKind = 'serial' | 'simulator';

export interface Notice {
  readonly key: MessageKey;
  readonly vars?: Vars;
}

const ERROR_KEYS: Record<NejeErrorCode, MessageKey> = {
  NO_RESPONSE: 'errorNoResponse',
  BUSY: 'errorBusy',
  TIMEOUT: 'errorTimeout',
  ABORTED: 'progressCancelled',
  DISCONNECTED: 'errorDisconnected',
  NOT_READY: 'errorDisconnected',
  OUT_OF_BOUNDS: 'errorGeneric',
};

export const errorKeyFor = (code: NejeErrorCode): MessageKey => ERROR_KEYS[code];

export const errorNotice = (error: unknown): Notice =>
  error instanceof NejeError
    ? { key: ERROR_KEYS[error.code], vars: { message: error.message } }
    : { key: 'errorGeneric', vars: { message: error instanceof Error ? error.message : String(error) } };

const TRAFFIC_LINES = 200;
const noSubscribe = () => () => {};
const noSnapshot = () => null;

async function openTransport(kind: ConnectionKind): Promise<Transport> {
  if (kind === 'simulator') return new SimulatorTransport();
  const bridge = getTestBridge();
  if (bridge) return new BridgeTransport(bridge);
  return WebSerialTransport.request();
}

export interface Device {
  readonly snapshot: SessionSnapshot | null;
  readonly kind: ConnectionKind | null;
  readonly error: Notice | null;
  readonly traffic: readonly string[];
  /** Line speed of the current connection, `null` while disconnected. */
  readonly baudRate: number | null;
  /** `afterConnect` runs once the device identified itself, e.g. a motion self-test. */
  connect(kind: ConnectionKind, afterConnect?: (session: NejeSession) => Promise<void>): Promise<void>;
  disconnect(): Promise<void>;
  /** Runs a session command, turning failures into a user-facing notice. */
  run(action: (session: NejeSession) => Promise<void>): Promise<boolean>;
  clearError(): void;
}

export function useDevice({ logTraffic }: { readonly logTraffic: boolean }): Device {
  const [session, setSession] = useState<NejeSession | null>(null);
  const [kind, setKind] = useState<ConnectionKind | null>(null);
  const [error, setError] = useState<Notice | null>(null);
  const [traffic, setTraffic] = useState<string[]>([]);

  const snapshot = useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.getSnapshot ?? noSnapshot, noSnapshot);

  useEffect(() => {
    if (!session || !logTraffic) return;
    return session.onTraffic((direction, bytes) =>
      setTraffic((lines) => [...lines.slice(-(TRAFFIC_LINES - 1)), `${direction === 'tx' ? '→' : '←'} ${toHex(bytes)}`]),
    );
  }, [session, logTraffic]);

  const connect = useCallback(async (next: ConnectionKind, afterConnect?: (session: NejeSession) => Promise<void>) => {
    setError(null);
    let transport: Transport;
    try {
      transport = await openTransport(next);
    } catch (e) {
      // NotFoundError = the user closed the port picker, nothing to report
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) setError({ key: 'errorPortOpen' });
      return;
    }
    const created = new NejeSession(transport);
    // A pulled cable closes the link from the device side.
    const unsubscribe = created.subscribe(() => {
      const s = created.getSnapshot();
      if (s.link !== 'closed') return;
      unsubscribe();
      if (s.closeReason === 'DISCONNECTED') {
        setError({ key: 'errorDisconnected' });
        setSession((current) => (current === created ? null : current));
        setKind(null);
      }
    });
    setSession(created);
    setKind(next);
    setTraffic([]);
    try {
      await created.connect();
    } catch (e) {
      await created.close();
      setSession(null);
      setKind(null);
      setError(errorNotice(e));
      return;
    }
    try {
      await afterConnect?.(created);
    } catch (e) {
      setError(errorNotice(e));
    }
  }, []);

  const disconnect = useCallback(async () => {
    await session?.close();
    setSession(null);
    setKind(null);
  }, [session]);

  const run = useCallback(
    async (action: (s: NejeSession) => Promise<void>) => {
      if (!session) return false;
      try {
        await action(session);
        return true;
      } catch (e) {
        if (!(e instanceof NejeError && e.code === 'ABORTED')) setError(errorNotice(e));
        return false;
      }
    },
    [session],
  );

  const clearError = useCallback(() => setError(null), []);

  return { snapshot, kind, error, traffic, baudRate: session?.baudRate ?? null, connect, disconnect, run, clearError };
}

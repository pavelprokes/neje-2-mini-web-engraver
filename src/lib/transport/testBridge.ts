import { DEFAULT_LINE_BAUD, type Bytes, type Transport } from '@/lib/protocol';

/**
 * Test seam for end-to-end tests against real hardware. Browsers do not let automation pick a
 * Web Serial port, so Playwright installs this bridge and relays bytes to the serial port from
 * Node. When present, "Connect engraver" uses it instead of Web Serial. Never set in production.
 */
export interface NejeTestBridge {
  write(bytes: number[]): Promise<void>;
  close(): Promise<void>;
  /** Assigned by the app; called by the test runner with bytes from the device. */
  onData?: (bytes: number[]) => void;
  onClose?: () => void;
}

declare global {
  interface Window {
    __NEJE_TEST_BRIDGE__?: NejeTestBridge;
  }
}

export const getTestBridge = (): NejeTestBridge | undefined => (typeof window === 'undefined' ? undefined : window.__NEJE_TEST_BRIDGE__);

export class BridgeTransport implements Transport {
  /** The Node side opens the real port at the default speed. */
  readonly baudRate = DEFAULT_LINE_BAUD;

  constructor(private readonly bridge: NejeTestBridge) {}

  open(onData: (chunk: Uint8Array) => void, onClose: () => void): void {
    this.bridge.onData = (bytes) => onData(Uint8Array.from(bytes));
    this.bridge.onClose = onClose;
  }

  write(data: Bytes): Promise<void> {
    return this.bridge.write(Array.from(data));
  }

  close(): Promise<void> {
    return this.bridge.close();
  }
}

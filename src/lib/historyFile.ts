/**
 * History export/import as one self-contained JSON file (images embedded as data URLs), so jobs
 * can move between browsers and computers. Imported files are untrusted: every field is checked
 * and settings go through `parseJobSettings`.
 */
import { parseJobSettings, type JobSettings } from '@/lib/job';

export const HISTORY_FORMAT = 'neje-web-engraver-history';
export const HISTORY_FILE_VERSION = 1;
/** Refuse absurdly large files before parsing them. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

export interface PortableEntry {
  readonly name: string;
  readonly createdAt: number;
  readonly asset: Blob;
  readonly thumbnail: Blob;
  readonly settings: JobSettings;
}

export class HistoryFileError extends Error {
  override readonly name = 'HistoryFileError';
}

async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

const DATA_URL = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/;

function fromDataUrl(value: unknown): Blob {
  const match = typeof value === 'string' ? DATA_URL.exec(value) : null;
  if (!match) throw new HistoryFileError('entry image is not an image data URL');
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

export async function serializeHistory(entries: readonly PortableEntry[]): Promise<string> {
  const items = [];
  for (const e of entries) {
    items.push({ name: e.name, createdAt: e.createdAt, settings: e.settings, asset: await toDataUrl(e.asset), thumbnail: await toDataUrl(e.thumbnail) });
  }
  return JSON.stringify({ format: HISTORY_FORMAT, version: HISTORY_FILE_VERSION, exportedAt: Date.now(), entries: items });
}

export function parseHistoryFile(text: string): PortableEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HistoryFileError('not a JSON file');
  }
  const root = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  if (root.format !== HISTORY_FORMAT) throw new HistoryFileError('not a history export');
  if (typeof root.version !== 'number' || root.version > HISTORY_FILE_VERSION) throw new HistoryFileError('made by a newer version of the app');
  if (!Array.isArray(root.entries)) throw new HistoryFileError('no entries');
  return root.entries.map((raw: unknown) => {
    const e = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
      name: typeof e.name === 'string' && e.name.trim() ? e.name.slice(0, 200) : 'image',
      createdAt: typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : Date.now(),
      settings: parseJobSettings(e.settings),
      asset: fromDataUrl(e.asset),
      thumbnail: fromDataUrl(e.thumbnail),
    };
  });
}

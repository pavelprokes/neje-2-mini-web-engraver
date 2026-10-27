import { describe, expect, it } from 'vitest';
import { HISTORY_FORMAT, HistoryFileError, parseHistoryFile, serializeHistory } from './historyFile';
import { DEFAULT_JOB_SETTINGS } from './job';

const png = (bytes: number[]) => new Blob([Uint8Array.from(bytes)], { type: 'image/png' });

describe('history file', () => {
  it('round-trips entries with their images and settings', async () => {
    const entries = [
      { name: 'logo.svg', createdAt: 1700000000000, asset: new Blob(['<svg/>'], { type: 'image/svg+xml' }), thumbnail: png([1, 2, 3]), settings: { ...DEFAULT_JOB_SETTINGS, power: 55 } },
      { name: 'photo.png', createdAt: 1700000001000, asset: png(Array.from({ length: 70_000 }, (_, i) => i % 256)), thumbnail: png([9]), settings: DEFAULT_JOB_SETTINGS },
    ];
    const { entries: back } = parseHistoryFile(await serializeHistory(entries));
    expect(back.map((e) => [e.name, e.createdAt, e.settings.power])).toEqual([
      ['logo.svg', 1700000000000, 55],
      ['photo.png', 1700000001000, DEFAULT_JOB_SETTINGS.power],
    ]);
    expect(await back[0]!.asset.text()).toBe('<svg/>');
    expect(back[0]!.asset.type).toBe('image/svg+xml');
    expect(new Uint8Array(await back[1]!.asset.arrayBuffer())).toEqual(new Uint8Array(await entries[1]!.asset.arrayBuffer()));
  });

  it('rejects files that are not history exports', () => {
    expect(() => parseHistoryFile('nope')).toThrow(HistoryFileError);
    expect(() => parseHistoryFile('{"format":"other"}')).toThrow(HistoryFileError);
    expect(() => parseHistoryFile(JSON.stringify({ format: HISTORY_FORMAT, version: 99, entries: [] }))).toThrow(/newer/);
  });

  it('treats imported content as untrusted', () => {
    const file = (entry: object) => JSON.stringify({ format: HISTORY_FORMAT, version: 1, entries: [entry] });
    const ok = { asset: 'data:image/png;base64,AQID', thumbnail: 'data:image/png;base64,AQ==' };
    // only image data URLs, never scripts or remote URLs
    expect(() => parseHistoryFile(file({ ...ok, asset: 'data:text/html;base64,PHNjcmlwdD4=' }))).toThrow(HistoryFileError);
    expect(() => parseHistoryFile(file({ ...ok, asset: 'https://example.com/x.png' }))).toThrow(HistoryFileError);
    // bad settings are repaired, a missing name gets a default
    const [entry] = parseHistoryFile(file({ ...ok, settings: { power: 9000, widthMm: 'x' } })).entries;
    expect(entry!.settings.power).toBe(100);
    expect(entry!.settings.widthMm).toBe(DEFAULT_JOB_SETTINGS.widthMm);
    expect(entry!.name).toBe('image');
  });
});

describe('history file robustness', () => {
  it('exports files picked by name with an empty type as images, so they import again', async () => {
    const svg = new Blob(['<svg/>']); // type '' as for some dropped files
    const json = await serializeHistory([{ name: 'logo.svg', createdAt: 1, asset: svg, thumbnail: png([1]), settings: DEFAULT_JOB_SETTINGS }]);
    expect(parseHistoryFile(json).entries[0]!.asset.type).toBe('image/svg+xml');
  });

  it('skips unreadable entries instead of rejecting the whole backup', () => {
    const ok = { asset: 'data:image/png;base64,AQID', thumbnail: 'data:image/png;base64,AQ==' };
    const json = JSON.stringify({ format: HISTORY_FORMAT, version: 1, entries: [ok, { ...ok, asset: 'nope' }, ok] });
    const parsed = parseHistoryFile(json);
    expect([parsed.entries.length, parsed.skipped]).toEqual([2, 1]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPending, deliverFile, deliveryMethod, isIOS, pendingFile, sharePending, type DeliveryEnv } from './deliverFile';

const base: DeliveryEnv = { canShareFiles: true, ios: true, standalone: true, anchorDownload: true };

describe('deliveryMethod', () => {
  it('shares on an iPhone/iPad home-screen app that can share files', () => {
    expect(deliveryMethod(base)).toBe('share');
  });
  it('downloads when the device cannot share files, even on iOS standalone', () => {
    expect(deliveryMethod({ ...base, canShareFiles: false })).toBe('download');
  });
  it('downloads in iOS Safari (not standalone): the download works there', () => {
    expect(deliveryMethod({ ...base, standalone: false })).toBe('download');
  });
  it('downloads on Android / desktop standalone apps', () => {
    expect(deliveryMethod({ ...base, ios: false })).toBe('download');
    expect(deliveryMethod({ ...base, ios: false, standalone: false })).toBe('download');
  });
  it('shares when the browser has no <a download> at all and can share files', () => {
    expect(deliveryMethod({ canShareFiles: true, ios: false, standalone: false, anchorDownload: false })).toBe('share');
    expect(deliveryMethod({ canShareFiles: false, ios: false, standalone: false, anchorDownload: false })).toBe('download');
  });
});

describe('isIOS', () => {
  it('knows iPhone, iPad and iPadOS reporting a Mac with touch', () => {
    expect(isIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5)).toBe(true);
    expect(isIOS('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'iPad', 5)).toBe(true);
    expect(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true);
    expect(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false);
    expect(isIOS('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Linux armv8l', 5)).toBe(false);
  });
});

describe('deliverFile', () => {
  const clicks: string[] = [];
  function device(opts: { ios: boolean; standalone: boolean; canShare: boolean; share?: (d: ShareData) => Promise<void> }) {
    clicks.length = 0;
    vi.stubGlobal('navigator', {
      userAgent: opts.ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' : 'Mozilla/5.0 (X11; Linux x86_64)',
      platform: opts.ios ? 'iPhone' : 'Linux x86_64', maxTouchPoints: opts.ios ? 5 : 0,
      standalone: opts.standalone,
      canShare: (d: ShareData) => opts.canShare && !!d.files?.length,
      share: opts.share ?? (async () => undefined),
    });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), setTimeout: () => 0 });
    vi.stubGlobal('HTMLAnchorElement', Object.assign(function Anchor() {}, { prototype: { download: '' } }));
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
    vi.stubGlobal('document', {
      createElement: () => ({ style: {}, click() { clicks.push((this as unknown as { download: string }).download); } }),
      body: { appendChild: () => undefined, removeChild: () => undefined },
    });
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    clearPending();
  });

  it('downloads on a desktop browser', async () => {
    const share = vi.fn(async () => undefined);
    device({ ios: false, standalone: false, canShare: true, share });
    expect(await deliverFile('a.csv', 'x', 'text/csv')).toBe('downloaded');
    expect(clicks).toEqual(['a.csv']);
    expect(share).not.toHaveBeenCalled();
  });

  it('opens the share sheet with the file on an iPhone home-screen app', async () => {
    const share = vi.fn(async (_d: ShareData) => undefined);
    device({ ios: true, standalone: true, canShare: true, share });
    expect(await deliverFile('b.xlsx', new Uint8Array([1, 2]), 'application/x')).toBe('shared');
    expect(clicks).toEqual([]);
    const sent = share.mock.calls[0]![0];
    expect(sent.files?.[0]?.name).toBe('b.xlsx');
  });

  it('a cancelled share is not an error and does not download', async () => {
    device({ ios: true, standalone: true, canShare: true, share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } });
    expect(await deliverFile('c.csv', 'x', 'text/csv')).toBe('cancelled');
    expect(clicks).toEqual([]);
  });

  it('a share refused for an expired tap waits in the prompt; its button shares it', async () => {
    let n = 0;
    device({ ios: true, standalone: true, canShare: true, share: async () => { n += 1; if (n === 1) throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } });
    expect(await deliverFile('d.csv', 'x', 'text/csv')).toBe('pending');
    expect(pendingFile()?.name).toBe('d.csv');
    expect(await sharePending()).toBe('shared');
    expect(pendingFile()).toBeNull();
    expect(clicks).toEqual([]);
  });

  it('iPhone home-screen app that cannot share files keeps the normal download', async () => {
    device({ ios: true, standalone: true, canShare: false });
    expect(await deliverFile('e.csv', 'x', 'text/csv')).toBe('downloaded');
    expect(clicks).toEqual(['e.csv']);
  });
});

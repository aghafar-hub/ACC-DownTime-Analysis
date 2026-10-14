// Getting a made file (Excel, CSV) to the person. Normally that is the browser's download (files.ts downloadFile).
// An iPhone or iPad running the app from the home screen (standalone PWA) has no reliable download: the anchor
// download opens the file in a viewer with no way back, or does nothing. There the share sheet is offered instead
// (navigator.share with the File: 'Save to Files', Mail, Teams ...), when the browser says it can share files.
// The decision is the pure deliveryMethod(); deliverFile() reads the device and does it.
//
// Sharing needs a fresh tap (user activation). Making a big workbook can take longer than the browser keeps the tap
// alive; then the share is refused with NotAllowedError and the file waits in a small 'Your file is ready · Share'
// prompt (SharePrompt.tsx), whose button is the new tap.
import { t } from '../i18n/t';
import { downloadFile } from './files';

export type DeliveryMethod = 'share' | 'download';
export type DeliverResult = 'downloaded' | 'shared' | 'cancelled' | 'pending' | 'failed';

export interface DeliveryEnv {
  /** navigator.canShare({ files: [file] }) said yes */
  canShareFiles: boolean;
  /** an iPhone, iPod or iPad (iPadOS reports a Mac with touch) */
  ios: boolean;
  /** launched from the home screen (display-mode: standalone, or navigator.standalone) */
  standalone: boolean;
  /** the browser supports <a download> at all */
  anchorDownload: boolean;
}

/** Share only when the device can share files AND the normal download is not reliable there. */
export function deliveryMethod(env: DeliveryEnv): DeliveryMethod {
  if (!env.canShareFiles) return 'download';
  const downloadUnreliable = !env.anchorDownload || (env.ios && env.standalone);
  return downloadUnreliable ? 'share' : 'download';
}

/** iPhone / iPod / iPad, including iPadOS that reports itself as a Mac. */
export function isIOS(ua: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

type ShareNavigator = Navigator & { standalone?: boolean; canShare?: (data?: ShareData) => boolean };

function readEnv(file: File | null): DeliveryEnv {
  const nav = navigator as ShareNavigator;
  let canShareFiles = false;
  try {
    canShareFiles = !!file && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] });
  } catch {
    canShareFiles = false;
  }
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true;
  return {
    canShareFiles,
    ios: isIOS(nav.userAgent ?? '', nav.platform ?? '', nav.maxTouchPoints ?? 0),
    standalone,
    anchorDownload: typeof HTMLAnchorElement !== 'undefined' && 'download' in HTMLAnchorElement.prototype,
  };
}

// ---------------------------------------------------------------- the waiting file (share needs a new tap)

let pending: File | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribePending(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export const pendingFile = (): File | null => pending;
export function clearPending(): void {
  pending = null;
  emit();
}

async function share(file: File): Promise<DeliverResult> {
  try {
    await navigator.share({ files: [file], title: file.name });
    return 'shared';
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'AbortError') return 'cancelled';
    if (name === 'NotAllowedError') {
      pending = file;
      emit();
      return 'pending';
    }
    return 'failed';
  }
}

/** Shares the waiting file from the prompt's button (a fresh tap). */
export async function sharePending(): Promise<DeliverResult> {
  const file = pending;
  if (!file) return 'failed';
  pending = null;
  emit();
  return share(file);
}

/**
 * Hands a file to the person: the share sheet where downloads are unreliable (iOS home-screen app) and sharing
 * files works, otherwise the normal download. A refused or failed share falls back to the download only when the
 * download is reliable there; otherwise the file waits for a tap in the share prompt.
 */
export async function deliverFile(name: string, data: Uint8Array | string, mime: string): Promise<DeliverResult> {
  let file: File | null = null;
  try {
    file = typeof File === 'function' ? new File([data as BlobPart], name, { type: mime }) : null;
  } catch {
    file = null;
  }
  const env = readEnv(file);
  if (file && deliveryMethod(env) === 'share') {
    const r = await share(file);
    if (r !== 'failed') return r;
    if (!(env.ios && env.standalone) && env.anchorDownload) return downloadFile(name, data, mime) ? 'downloaded' : 'failed';
    pending = file;
    emit();
    return 'pending';
  }
  return downloadFile(name, data, mime) ? 'downloaded' : 'failed';
}

/** The note under an export button for each way the file reached (or did not reach) the person. */
export function deliveredText(r: DeliverResult, downloaded: string, name: string): string {
  switch (r) {
    case 'downloaded': return downloaded;
    case 'shared': return t('{name} shared.', { name });
    case 'cancelled': return t('Sharing cancelled. Press the button again to get the file.');
    case 'pending': return t('{name} is ready. Tap Share to save or send it.', { name });
    default: return t('The browser did not start the download. Try again.');
  }
}

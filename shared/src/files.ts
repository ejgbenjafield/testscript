export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'application/pdf',
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Work out a file's real type from its first bytes. Returns null when the
 * content isn't one of the supported formats, whatever its name says.
 */
export function sniffMimeType(bytes: Uint8Array): AllowedMimeType | null {
  const b = bytes;
  const at = (offset: number, sig: number[]) => sig.every((v, i) => b[offset + i] === v);
  const ascii = (offset: number, text: string) =>
    at(offset, Array.from(text).map((c) => c.charCodeAt(0)));

  if (b.length >= 8 && at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (b.length >= 3 && at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (b.length >= 6 && (ascii(0, 'GIF87a') || ascii(0, 'GIF89a'))) return 'image/gif';
  if (b.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (b.length >= 12 && ascii(4, 'ftyp')) return 'video/mp4';
  if (b.length >= 5 && ascii(0, '%PDF-')) return 'application/pdf';
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

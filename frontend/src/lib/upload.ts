import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  formatBytes,
  type Attachment,
  type AttachmentEntityType,
} from '@testscript/shared';
import { api } from './api';

export const ACCEPT = ALLOWED_MIME_TYPES.join(',');

/** Check a file in the browser first, so obvious problems show without waiting for an upload. */
export function checkFile(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is ${formatBytes(file.size)}. Files can be up to 50 MB.`;
  if (file.type && !(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return `${file.name} isn't a supported type. Use PNG, JPG, GIF, WebP, MP4 or PDF.`;
  }
  return null;
}

export async function uploadFile(entityType: AttachmentEntityType, entityId: string, file: File) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const form = new FormData();
  form.set('entityType', entityType);
  form.set('entityId', entityId);
  form.set('file', file, file.name);
  return api.upload<Attachment>('/attachments', form);
}

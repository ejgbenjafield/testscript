import crypto from 'crypto';
import path from 'path';
import { Router, type Request } from 'express';
import multer from 'multer';
import {
  MAX_UPLOAD_BYTES,
  can,
  listAttachmentsSchema,
  sniffMimeType,
  uploadAttachmentSchema,
  type Attachment,
  type AttachmentEntityType,
} from '@testscript/shared';
import { config } from '../config';
import { isUuid, one, query } from '../db';
import { audit, currentUser, requireResource } from '../authz';
import { badRequest, conflict, forbidden, HttpError, notFound, parse } from '../errors';
import { iso } from '../pagination';
import { storage } from '../storage';

const DOWNLOAD_TTL_SECONDS = 60 * 60;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function sign(id: string, exp: number) {
  return crypto.createHmac('sha256', config.signingSecret).update(`${id}.${exp}`).digest('base64url');
}

/** A link to the file that works for an hour, so it can be used in <img> and <video> tags. */
export function downloadUrl(id: string) {
  const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS;
  return `/v1/attachments/${id}/content?exp=${exp}&sig=${sign(id, exp)}`;
}

function mapAttachment(r: any): Attachment {
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    url: downloadUrl(r.id),
    uploader: r.uploader_id ? { id: r.uploader_id, name: r.uploader_name ?? null } : null,
    createdAt: iso(r.created_at)!,
  };
}

const ATTACHMENT_SQL = `
  SELECT a.*, COALESCE(u.name, u.email) AS uploader_name
    FROM attachments a LEFT JOIN users u ON u.id = a.uploader_id`;

export async function attachmentsFor(entityType: AttachmentEntityType, ids: string[]) {
  const byEntity = new Map<string, Attachment[]>();
  if (ids.length === 0) return byEntity;
  const rows = await query(
    `${ATTACHMENT_SQL} WHERE a.entity_type = $1 AND a.entity_id = ANY($2::uuid[]) AND a.deleted_at IS NULL
      ORDER BY a.created_at`,
    [entityType, ids],
  );
  for (const r of rows) {
    const list = byEntity.get(r.entity_id) ?? [];
    list.push(mapAttachment(r));
    byEntity.set(r.entity_id, list);
  }
  return byEntity;
}

/** Check the caller may add or view files on the given step or run result. */
async function requireEntity(req: Request, entityType: AttachmentEntityType, entityId: string, write: boolean) {
  if (entityType === 'step') {
    return requireResource(req, 'step', entityId, write ? 'editContent' : 'read');
  }
  const rr = await requireResource(req, 'runResult', entityId, write ? 'uploadResultFiles' : 'read');
  if (write && rr.run_status !== 'in_progress') throw conflict('This run has finished, so files can no longer be added');
  return rr;
}

function safeFilename(name: string) {
  const base = path.basename(name || 'file').normalize('NFKC');
  const cleaned = base.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150);
  return cleaned || 'file';
}

/** Public: serves a file when the signed link is valid. Mounted before the auth middleware. */
export const attachmentContentRouter = Router();

attachmentContentRouter.get('/attachments/:attachmentId/content', async (req, res) => {
  const id = req.params.attachmentId;
  const exp = Number(req.query.exp);
  const sig = String(req.query.sig || '');
  if (!isUuid(id) || !Number.isFinite(exp)) throw notFound('Attachment');
  const expected = sign(id, exp);
  const valid =
    sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) throw notFound('Attachment');
  if (exp < Date.now() / 1000) throw new HttpError(410, 'link_expired', 'This link has expired. Reload the page.');

  const row = await one('SELECT * FROM attachments WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!row) throw notFound('Attachment');
  const stream = await storage.stream(row.storage_key).catch(() => null);
  if (!stream) throw notFound('Attachment');

  const disposition = req.query.download === '1' ? 'attachment' : 'inline';
  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('Content-Length', String(row.size_bytes));
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  stream.on('error', (err) => {
    console.error('[attachments] stream failed', err);
    res.destroy(err);
  });
  stream.pipe(res);
});

export const attachmentsRouter = Router();

/**
 * Upload one file (multipart field `file`) to a step or run result.
 * The content is checked against its declared type before it is stored.
 */
attachmentsRouter.post('/attachments', upload.single('file'), async (req, res) => {
  const user = currentUser(req);
  const { entityType, entityId } = parse(uploadAttachmentSchema, req.body);
  const entity = await requireEntity(req, entityType, entityId, true);
  const file = req.file;
  if (!file || file.size === 0) throw badRequest('Choose a file to upload');

  const actual = sniffMimeType(file.buffer.subarray(0, 64));
  if (!actual) {
    throw new HttpError(415, 'unsupported_type', 'Only PNG, JPG, GIF, WebP, MP4 and PDF files can be uploaded');
  }
  const declared = file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;
  if (declared && declared !== 'application/octet-stream' && declared !== actual) {
    throw new HttpError(415, 'type_mismatch', `This file says it is ${declared} but its contents are ${actual}`);
  }

  const id = crypto.randomUUID();
  const filename = safeFilename(file.originalname);
  // Phase 2: virus scanning hooks in here, before the file is marked available.
  const key = `${entity.org_id}/${entityType}/${entityId}/${id}-${filename}`;
  await storage.put(key, file.buffer, actual);

  try {
    await one(
      `INSERT INTO attachments (id, org_id, entity_type, entity_id, uploader_id, filename, storage_key, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, entity.org_id, entityType, entityId, user.id, filename, key, actual, file.size],
    );
  } catch (err) {
    await storage.delete(key).catch(() => undefined);
    throw err;
  }
  await audit(req, { orgId: entity.org_id, action: 'attachment.created', entityType: 'attachment', entityId: id, diff: { entityType, entityId, filename, mimeType: actual, sizeBytes: file.size } });
  const row = await one(`${ATTACHMENT_SQL} WHERE a.id = $1`, [id]);
  res.status(201).json(mapAttachment(row));
});

attachmentsRouter.get('/attachments', async (req, res) => {
  const { entityType, entityId } = parse(listAttachmentsSchema, req.query);
  await requireEntity(req, entityType, entityId, false);
  const files = await attachmentsFor(entityType, [entityId]);
  res.json({ data: files.get(entityId) ?? [], nextCursor: null });
});

attachmentsRouter.delete('/attachments/:attachmentId', async (req, res) => {
  const user = currentUser(req);
  const a = await requireResource(req, 'attachment', req.params.attachmentId, 'read');
  // Step files belong to the test case, so preparers manage them. Run-result
  // files can be removed by whoever added them, or a preparer.
  const canDelete =
    can(a.roles, 'editContent') ||
    (a.entity_type === 'run_result' && can(a.roles, 'uploadResultFiles') && a.uploader_id === user.id);
  if (!canDelete) throw forbidden();
  const row = await one(
    'UPDATE attachments SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING storage_key',
    [a.id],
  );
  if (row) await storage.delete(row.storage_key).catch((err) => console.error('[attachments] delete failed', err));
  await audit(req, { orgId: a.org_id, action: 'attachment.deleted', entityType: 'attachment', entityId: a.id });
  res.status(204).end();
});

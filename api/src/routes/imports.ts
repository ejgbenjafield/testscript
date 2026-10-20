import { Router } from 'express';
import multer from 'multer';
import { parseImport, type ImportResult } from '@testscript/shared';
import { one, query, tx } from '../db';
import { audit, currentUser, requireResource } from '../authz';
import { badRequest, HttpError } from '../errors';

/** Upload a CSV of test cases (UAT, Regression or SIT template) into a test area. */
export const importsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

importsRouter.post('/suites/:suiteId/import', upload.single('file'), async (req, res) => {
  const user = currentUser(req);
  // With the upload middleware in front, Express's types lose the route's
  // parameter names, so read the id explicitly.
  const { suiteId } = req.params as Record<string, string>;
  const s = await requireResource(req, 'suite', suiteId, 'editContent');
  const preview = req.query.preview === 'true';
  if (!req.file || req.file.size === 0) throw badRequest('Choose a CSV file to upload');
  if (req.file.size > 5 * 1024 * 1024) throw new HttpError(413, 'file_too_large', 'CSV files can be up to 5 MB');

  const parsed = parseImport(req.file.buffer.toString('utf8'));
  if (parsed.error) throw new HttpError(422, 'unreadable_file', parsed.error);

  // Test cases already in this test area (matched by their ID, e.g. REPORT1) are skipped,
  // so uploading the same file twice doesn't create duplicates.
  const refs = parsed.cases.map((c) => c.ref?.toLowerCase()).filter((r): r is string => Boolean(r));
  const existing = new Set(
    refs.length
      ? (
          await query(
            'SELECT lower(ref) AS ref FROM test_cases WHERE suite_id = $1 AND deleted_at IS NULL AND lower(ref) = ANY($2::text[])',
            [s.id, refs],
          )
        ).map((r) => r.ref as string)
      : [],
  );
  const isExisting = (ref: string | null) => Boolean(ref && existing.has(ref.toLowerCase()));

  const summary = (created: number): ImportResult => ({
    format: parsed.format!,
    preview,
    created,
    skipped: parsed.cases.filter((c) => isExisting(c.ref)).length,
    warnings: parsed.warnings,
    testCases: parsed.cases.map((c) => ({
      ref: c.ref,
      name: c.name,
      stepCount: c.steps.length,
      alreadyExists: isExisting(c.ref),
    })),
  });

  if (preview) return void res.json(summary(0));

  const toCreate = parsed.cases.filter((c) => !isExisting(c.ref));
  await tx(async (db) => {
    await db.query('SELECT 1 FROM suites WHERE id = $1 FOR UPDATE', [s.id]);
    const next = await one('SELECT COALESCE(max(position) + 1, 0) AS pos FROM test_cases WHERE suite_id = $1 AND deleted_at IS NULL', [s.id], db);
    let position = Number(next.pos);
    for (const c of toCreate) {
      const tc = await one(
        `INSERT INTO test_cases (org_id, suite_id, ref, name, description, precondition, system, import_via, import_definition, position, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [s.org_id, s.id, c.ref, c.name, c.description, c.precondition, c.system, c.importVia, c.importDefinition, position++, user.id],
        db,
      );
      if (c.steps.length) {
        await db.query(
          `INSERT INTO steps (org_id, test_case_id, position, ref, action, details, expected_result)
           SELECT $1, $2, ord - 1, ref, action, details, expected
             FROM unnest($3::text[], $4::text[], $5::text[], $6::text[]) WITH ORDINALITY AS t(ref, action, details, expected, ord)`,
          [
            s.org_id, tc.id, c.steps.map((x) => x.ref), c.steps.map((x) => x.action),
            c.steps.map((x) => x.details), c.steps.map((x) => x.expectedResult),
          ],
        );
      }
    }
    await db.query('UPDATE suites SET updated_at = now() WHERE id = $1', [s.id]);
    await audit(
      req,
      {
        orgId: s.org_id,
        action: 'test_case.imported',
        entityType: 'suite',
        entityId: s.id,
        diff: { file: req.file!.originalname, format: parsed.format, created: toCreate.length, skipped: parsed.cases.length - toCreate.length },
      },
      db,
    );
  });
  res.status(201).json(summary(toCreate.length));
});

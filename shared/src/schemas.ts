import { z } from 'zod';
import { ROLES } from './roles';
import { ALLOWED_MIME_TYPES } from './files';
import { STEP_RESULTS } from './status';

const name = z.string().trim().min(1, 'Required').max(200);
const description = z.string().max(10_000).optional().nullable();
const uuid = z.string().uuid();

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers and hyphens');

export const RESERVED_SLUGS = [
  'v1', 'api', 'login', 'logout', 'callback', 'invite', 'invitations', 'new', 'settings',
  'admin', 'assets', 'healthz', 'static', 'app', 'www', 'orgs',
];

export const devLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(120).optional(),
});

export const createOrgSchema = z.object({
  name,
  slug: slugSchema.refine((s) => !RESERVED_SLUGS.includes(s), 'That address is reserved').optional(),
});
export const updateOrgSchema = z.object({
  name: name.optional(),
  slug: slugSchema.refine((s) => !RESERVED_SLUGS.includes(s), 'That address is reserved').optional(),
});

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES).refine((r) => r !== 'owner', 'Invite as admin, then transfer ownership'),
});
export const updateMemberSchema = z.object({ role: z.enum(ROLES) });

export const createProjectSchema = z.object({ name, description });
export const updateProjectSchema = createProjectSchema.partial();

export const createSuiteSchema = z.object({ name, description });
export const updateSuiteSchema = createSuiteSchema.partial();

export const stepInputSchema = z.object({
  action: z.string().trim().min(1, 'Required').max(10_000),
  expectedResult: z.string().max(10_000).optional().nullable(),
});

export const createTestCaseSchema = z.object({
  name,
  description,
  steps: z.array(stepInputSchema).max(200).optional(),
});
export const updateTestCaseSchema = z.object({ name: name.optional(), description });

export const createStepSchema = stepInputSchema.extend({
  /** Insert at this 0-based position; appended when omitted. */
  position: z.number().int().min(0).optional(),
});
export const updateStepSchema = stepInputSchema.partial();

export const reorderSchema = z.object({ ids: z.array(uuid).min(1).max(1000) });

export const startRunSchema = z.object({
  name: z.string().trim().max(200).optional(),
  testCaseIds: z.array(uuid).optional(),
});
export const updateRunSchema = z.object({ status: z.enum(['completed', 'abandoned']) });

export const recordResultSchema = z.object({
  testCaseId: uuid,
  stepId: uuid,
  result: z.enum(STEP_RESULTS),
  notes: z.string().max(10_000).optional().nullable(),
});

export const ATTACHMENT_ENTITY_TYPES = ['step', 'run_result'] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

export const uploadAttachmentSchema = z.object({
  entityType: z.enum(ATTACHMENT_ENTITY_TYPES),
  entityId: uuid,
});
export const listAttachmentsSchema = uploadAttachmentSchema;
export const mimeTypeSchema = z.enum(ALLOWED_MIME_TYPES);

export const paginationSchema = z.object({
  after: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateSuiteInput = z.infer<typeof createSuiteSchema>;
export type CreateTestCaseInput = z.infer<typeof createTestCaseSchema>;
export type StepInput = z.infer<typeof stepInputSchema>;
export type RecordResultInput = z.infer<typeof recordResultSchema>;

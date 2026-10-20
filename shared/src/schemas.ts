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

/** An empty list of roles means Viewer (read-only). */
const rolesSchema = z.array(z.enum(ROLES)).max(ROLES.length).transform((r) => [...new Set(r)]);

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  roles: rolesSchema.refine((r) => !r.includes('owner'), 'Invite as admin, then make them an owner'),
  /** Projects they'll be able to see. Admins see every project anyway. */
  projectIds: z.array(z.string().uuid()).max(500).default([]),
});
export const updateMemberSchema = z.object({ roles: rolesSchema });
export const memberProjectsSchema = z.object({ projectIds: z.array(z.string().uuid()).max(500) });

export const createProjectSchema = z.object({ name, description });
export const updateProjectSchema = createProjectSchema.partial();

/** A test area (a "suite" in the code) takes its name from the organisation's list of areas. */
export const createSuiteSchema = z.object({ areaId: uuid, description });
export const updateSuiteSchema = createSuiteSchema.partial();

export const createAreaSchema = z.object({ name: z.string().trim().min(1, 'Required').max(120) });
export const updateAreaSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(120).optional(),
  /** Archived areas disappear from the dropdown; test areas already using them keep them. */
  archived: z.boolean().optional(),
});

const longText = z.string().max(10_000).optional().nullable();
const shortText = z.string().trim().max(500).optional().nullable();

export const stepInputSchema = z.object({
  /** The Question (UAT) or Test Description (SIT): what the tester checks or does. */
  action: z.string().trim().min(1, 'Required').max(10_000),
  details: longText,
  expectedResult: longText,
});

/** Test case fields from the UAT, Regression and SIT templates. All optional except the name. */
const testCaseFields = {
  ref: z.string().trim().max(100).optional().nullable(),
  description,
  precondition: longText,
  system: shortText,
  importVia: shortText,
  importDefinition: shortText,
};
export const TEST_CASE_FIELD_KEYS = ['description', 'precondition', 'system', 'importVia', 'importDefinition'] as const;
export type TestCaseFieldKey = (typeof TEST_CASE_FIELD_KEYS)[number];
export const TEST_CASE_FIELD_LABELS: Record<TestCaseFieldKey, string> = {
  description: 'Description',
  precondition: 'Pre-condition',
  system: 'System',
  importVia: 'Import via',
  importDefinition: 'Import definition',
};

export const createTestCaseSchema = z.object({
  name,
  ...testCaseFields,
  steps: z.array(stepInputSchema).max(200).optional(),
});
export const updateTestCaseSchema = z.object({ name: name.optional(), ...testCaseFields });

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

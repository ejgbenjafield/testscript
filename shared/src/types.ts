import type { Role } from './roles';
import type { RunStats, RunStatus, StepResult } from './status';
import type { AttachmentEntityType } from './schemas';

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface AuthConfig {
  mode: 'dev' | 'auth0';
  auth0?: { domain: string; clientId: string; audience: string };
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  role: Role;
}

export interface Me {
  user: User;
  orgs: OrgSummary[];
}

export interface Org {
  id: string;
  slug: string;
  name: string;
  role: Role;
  plan: string;
  seatCount: number;
  createdAt: string;
}

export interface Member {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: Role;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
  /** Only returned once, when the invitation is created. */
  inviteUrl?: string;
  emailSent?: boolean;
}

export interface InvitationPreview {
  orgName: string;
  orgSlug: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  expired: boolean;
  accepted: boolean;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  suiteCount: number;
  testCaseCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Suite {
  id: string;
  projectId: string;
  projectName?: string;
  name: string;
  description: string | null;
  testCaseCount: number;
  lastRun: RunSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface Step {
  id: string;
  testCaseId: string;
  position: number;
  action: string;
  expectedResult: string | null;
  attachmentCount?: number;
}

export interface TestCase {
  id: string;
  suiteId: string;
  name: string;
  description: string | null;
  position: number;
  stepCount: number;
  steps?: Step[];
  createdAt: string;
  updatedAt: string;
}

export interface RunSummary {
  id: string;
  suiteId: string;
  name: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  startedBy: { id: string; name: string | null; email: string } | null;
  stats: RunStats;
}

export interface SnapshotStep {
  id: string;
  position: number;
  action: string;
  expectedResult: string | null;
}

export interface RunTestCase {
  testCaseId: string;
  position: number;
  name: string;
  description: string | null;
  steps: SnapshotStep[];
}

export interface Attachment {
  id: string;
  entityType: AttachmentEntityType;
  entityId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  uploader: { id: string; name: string | null } | null;
  createdAt: string;
}

export interface RunResult {
  id: string;
  testCaseId: string;
  stepId: string;
  result: StepResult;
  notes: string | null;
  recordedAt: string;
  recordedBy: { id: string; name: string | null; email: string } | null;
  attachments: Attachment[];
}

export interface RunDetail extends RunSummary {
  suiteName: string;
  projectId: string;
  projectName: string;
  testCases: RunTestCase[];
  results: RunResult[];
}

export interface DashboardProject {
  id: string;
  name: string;
  description: string | null;
  suiteCount: number;
  testCaseCount: number;
  lastRunAt: string | null;
  /** Pass rates of the last 7 finished runs, oldest first. */
  trend: Array<{ runId: string; passRate: number | null; finishedAt: string }>;
}

export interface Dashboard {
  totals: {
    projects: number;
    suites: number;
    testCases: number;
    runsLast30Days: number;
    passRateLast30Days: number | null;
  };
  projects: DashboardProject[];
  activeRuns: Array<RunSummary & { suiteName: string; projectName: string }>;
  recentRuns: Array<RunSummary & { suiteName: string; projectName: string }>;
}

export interface SearchHit {
  testCaseId: string;
  testCaseName: string;
  suiteId: string;
  suiteName: string;
  projectId: string;
  projectName: string;
  /** Step text that matched, when the match was in a step. */
  matchedStep: string | null;
}

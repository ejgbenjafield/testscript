import { describe, expect, it } from 'vitest';
import {
  can,
  computeRunStats,
  describeRoles,
  sniffMimeType,
  testCaseStatus,
  createOrgSchema,
} from './index';

describe('roles', () => {
  it('combines roles', () => {
    expect(can(['tester'], 'runTests')).toBe(true);
    expect(can(['tester'], 'editContent')).toBe(false);
    expect(can(['preparer'], 'editContent')).toBe(true);
    expect(can(['preparer'], 'runTests')).toBe(true);
    expect(can(['preparer'], 'manageProjects')).toBe(false);
    expect(can(['admin'], 'manageProjects')).toBe(true);
    expect(can(['admin'], 'seeAllProjects')).toBe(true);
    expect(can(['admin'], 'transferOwnership')).toBe(false);
    expect(can(['owner'], 'transferOwnership')).toBe(true);
    expect(can([], 'read')).toBe(true);
    expect(can([], 'runTests')).toBe(false);
    expect(can(null, 'read')).toBe(false);
  });
  it('describes roles', () => {
    expect(describeRoles([])).toBe('Viewer');
    expect(describeRoles(['tester', 'preparer'])).toBe('Preparer, Tester');
  });
});

describe('testCaseStatus', () => {
  const steps = ['a', 'b', 'c'];
  it('is untested with no results', () => expect(testCaseStatus(steps, {})).toBe('untested'));
  it('is in progress with some results', () =>
    expect(testCaseStatus(steps, { a: 'pass' })).toBe('in_progress'));
  it('fails as soon as one step fails', () =>
    expect(testCaseStatus(steps, { b: 'fail' })).toBe('fail'));
  it('passes when all pass or skip', () =>
    expect(testCaseStatus(steps, { a: 'pass', b: 'skip', c: 'pass' })).toBe('pass'));
  it('is skip when every step is skipped', () =>
    expect(testCaseStatus(steps, { a: 'skip', b: 'skip', c: 'skip' })).toBe('skip'));
  it('accepts a Map', () =>
    expect(testCaseStatus(['a'], new Map([['a', 'pass' as const]]))).toBe('pass'));
});

describe('computeRunStats', () => {
  it('counts and excludes skips from pass rate', () => {
    const s = computeRunStats(5, ['pass', 'pass', 'fail', 'skip']);
    expect(s).toMatchObject({ total: 5, passed: 2, failed: 1, skipped: 1, untested: 1 });
    expect(s.passRate).toBeCloseTo(2 / 3);
  });
  it('has a null pass rate when nothing decided', () => {
    expect(computeRunStats(3, ['skip']).passRate).toBeNull();
  });
});

describe('sniffMimeType', () => {
  const bytes = (...xs: number[]) => new Uint8Array(xs);
  const text = (s: string) => new TextEncoder().encode(s);
  it('detects formats', () => {
    expect(sniffMimeType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffMimeType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffMimeType(text('GIF89a....'))).toBe('image/gif');
    expect(sniffMimeType(text('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMimeType(text('\0\0\0\x18ftypmp42'))).toBe('video/mp4');
    expect(sniffMimeType(text('%PDF-1.7'))).toBe('application/pdf');
  });
  it('rejects anything else', () => {
    expect(sniffMimeType(text('<html><script>'))).toBeNull();
    expect(sniffMimeType(bytes())).toBeNull();
  });
});

describe('schemas', () => {
  it('rejects reserved and malformed slugs', () => {
    expect(createOrgSchema.safeParse({ name: 'A', slug: 'settings' }).success).toBe(false);
    expect(createOrgSchema.safeParse({ name: 'A', slug: 'Bad Slug' }).success).toBe(false);
    expect(createOrgSchema.safeParse({ name: 'A', slug: 'acme-qa' }).success).toBe(true);
  });
});

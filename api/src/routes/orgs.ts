import crypto from 'crypto';
import { Router, type Request } from 'express';
import {
  createOrgSchema,
  hasRole,
  inviteSchema,
  paginationSchema,
  updateMemberSchema,
  updateOrgSchema,
  ROLE_LABELS,
  type Invitation,
  type InvitationPreview,
  type Member,
  type Org,
  type Role,
} from '@testscript/shared';
import { config } from '../config';
import { Db, one, query, tx } from '../db';
import { audit, changed, currentUser, requireOrg } from '../authz';
import { badRequest, conflict, forbidden, HttpError, notFound, parse } from '../errors';
import { escapeHtml, sendEmail } from '../email';
import { iso, toPage } from '../pagination';

export const orgsRouter = Router();

const INVITE_TTL_DAYS = 7;
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

function slugify(name: string) {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s.length >= 2 ? s : `org-${crypto.randomBytes(3).toString('hex')}`;
}

async function uniqueSlug(base: string, db: Db) {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await one('SELECT 1 FROM organisations WHERE slug = $1', [candidate], db);
    if (!taken) return candidate;
  }
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

async function syncSeatCount(orgId: string, db: Db) {
  await db.query(
    `UPDATE billing_accounts SET seat_count = (SELECT count(*) FROM org_members WHERE org_id = $1) WHERE org_id = $1`,
    [orgId],
  );
}

async function loadOrg(orgId: string, role: Role): Promise<Org> {
  const row = await one(
    `SELECT o.id, o.slug, o.name, o.created_at, b.plan, b.seat_count
       FROM organisations o LEFT JOIN billing_accounts b ON b.org_id = o.id WHERE o.id = $1`,
    [orgId],
  );
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    role,
    plan: row.plan ?? 'free',
    seatCount: row.seat_count ?? 1,
    createdAt: iso(row.created_at)!,
  };
}

function appUrl(req: Request) {
  if (config.appUrl) return config.appUrl;
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol;
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
  return `${proto}://${host}`;
}

// Organisations ------------------------------------------------------------------

orgsRouter.post('/orgs', async (req, res) => {
  const user = currentUser(req);
  const input = parse(createOrgSchema, req.body);
  const org = await tx(async (db) => {
    let slug = input.slug;
    if (slug) {
      if (await one('SELECT 1 FROM organisations WHERE slug = $1', [slug], db)) {
        throw conflict('That address is already taken');
      }
    } else {
      slug = await uniqueSlug(slugify(input.name), db);
    }
    const created = await one(
      'INSERT INTO organisations (slug, name) VALUES ($1, $2) RETURNING id',
      [slug, input.name],
      db,
    );
    await db.query(`INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [created.id, user.id]);
    await db.query(`INSERT INTO billing_accounts (org_id, plan, seat_count) VALUES ($1, 'free', 1)`, [created.id]);
    await audit(req, { orgId: created.id, action: 'org.created', entityType: 'organisation', entityId: created.id, diff: { name: input.name, slug } }, db);
    return created;
  });
  res.status(201).json(await loadOrg(org.id, 'owner'));
});

orgsRouter.get('/orgs/:orgId', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'viewer');
  res.json(await loadOrg(org.id, org.role));
});

orgsRouter.patch('/orgs/:orgId', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'admin');
  const input = parse(updateOrgSchema, req.body);
  if (input.slug && input.slug !== org.slug) {
    const taken = await one('SELECT 1 FROM organisations WHERE slug = $1 AND id <> $2', [input.slug, org.id]);
    if (taken) throw conflict('That address is already taken');
  }
  await tx(async (db) => {
    await db.query(
      `UPDATE organisations SET name = COALESCE($2, name), slug = COALESCE($3, slug), updated_at = now() WHERE id = $1`,
      [org.id, input.name ?? null, input.slug ?? null],
    );
    await audit(req, { orgId: org.id, action: 'org.updated', entityType: 'organisation', entityId: org.id, diff: changed(org, input) }, db);
  });
  res.json(await loadOrg(org.id, org.role));
});

// Members ---------------------------------------------------------------------

function mapMember(r: any): Member {
  return {
    userId: r.id,
    email: r.email,
    name: r.name,
    avatarUrl: r.avatar_url,
    role: r.role,
    joinedAt: iso(r.joined_at)!,
  };
}

orgsRouter.get('/orgs/:orgId/members', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'viewer');
  const { after, limit } = parse(paginationSchema, req.query);
  const rows = await query(
    `SELECT u.id, u.email, u.name, u.avatar_url, m.role, m.joined_at
       FROM org_members m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1
        AND ($2::uuid IS NULL OR (m.joined_at, u.id) > (SELECT joined_at, user_id FROM org_members WHERE org_id = $1 AND user_id = $2))
      ORDER BY m.joined_at, u.id
      LIMIT $3`,
    [org.id, after ?? null, limit + 1],
  );
  res.json(toPage(rows, limit, mapMember));
});

async function ownerCount(orgId: string, db: Db) {
  const r = await one<{ n: string }>(`SELECT count(*) AS n FROM org_members WHERE org_id = $1 AND role = 'owner'`, [orgId], db);
  return Number(r!.n);
}

orgsRouter.patch('/orgs/:orgId/members/:userId', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'admin');
  const { role } = parse(updateMemberSchema, req.body);
  const member = await tx(async (db) => {
    const target = await one(
      'SELECT m.role FROM org_members m WHERE m.org_id = $1 AND m.user_id = $2 FOR UPDATE',
      [org.id, req.params.userId],
      db,
    );
    if (!target) throw notFound('Member');
    const touchesOwner = role === 'owner' || target.role === 'owner';
    if (touchesOwner && org.role !== 'owner') throw forbidden('Only an owner can change ownership');
    if (target.role === 'owner' && role !== 'owner' && (await ownerCount(org.id, db)) <= 1) {
      throw badRequest('An organisation needs at least one owner. Make someone else an owner first.');
    }
    await db.query('UPDATE org_members SET role = $3 WHERE org_id = $1 AND user_id = $2', [org.id, req.params.userId, role]);
    await audit(req, { orgId: org.id, action: 'member.role_changed', entityType: 'user', entityId: req.params.userId, diff: { role: { from: target.role, to: role } } }, db);
    return one(
      `SELECT u.id, u.email, u.name, u.avatar_url, m.role, m.joined_at FROM org_members m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = $1 AND m.user_id = $2`,
      [org.id, req.params.userId],
      db,
    );
  });
  res.json(mapMember(member));
});

orgsRouter.delete('/orgs/:orgId/members/:userId', async (req, res) => {
  const user = currentUser(req);
  const leaving = req.params.userId === user.id;
  const org = await requireOrg(req, req.params.orgId, leaving ? 'viewer' : 'admin');
  await tx(async (db) => {
    const target = await one('SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2 FOR UPDATE', [org.id, req.params.userId], db);
    if (!target) throw notFound('Member');
    if (target.role === 'owner') {
      if (!leaving && org.role !== 'owner') throw forbidden('Only an owner can remove an owner');
      if ((await ownerCount(org.id, db)) <= 1) {
        throw badRequest('An organisation needs at least one owner. Make someone else an owner first.');
      }
    }
    await db.query('DELETE FROM org_members WHERE org_id = $1 AND user_id = $2', [org.id, req.params.userId]);
    await syncSeatCount(org.id, db);
    await audit(req, { orgId: org.id, action: leaving ? 'member.left' : 'member.removed', entityType: 'user', entityId: req.params.userId, diff: { role: target.role } }, db);
  });
  res.status(204).end();
});

// Invitations -----------------------------------------------------------------

function mapInvitation(r: any): Invitation {
  return {
    id: r.id,
    email: r.email,
    role: r.role,
    invitedBy: r.invited_by_name ?? null,
    expiresAt: iso(r.expires_at)!,
    createdAt: iso(r.created_at)!,
  };
}

orgsRouter.post('/orgs/:orgId/members/invite', async (req, res) => {
  const user = currentUser(req);
  const org = await requireOrg(req, req.params.orgId, 'admin');
  const input = parse(inviteSchema, req.body);
  if (hasRole(input.role, 'admin') && !hasRole(org.role, 'admin')) throw forbidden();

  const alreadyMember = await one(
    `SELECT 1 FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 AND lower(u.email) = $2`,
    [org.id, input.email],
  );
  if (alreadyMember) throw conflict(`${input.email} is already a member`);

  const token = crypto.randomBytes(32).toString('base64url');
  const invitation = await tx(async (db) => {
    // A fresh invite replaces any earlier pending one for the same address.
    await db.query(
      `UPDATE invitations SET revoked_at = now()
        WHERE org_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [org.id, input.email],
    );
    const row = await one(
      `INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '${INVITE_TTL_DAYS} days')
       RETURNING id, email, role, expires_at, created_at`,
      [org.id, input.email, input.role, hashToken(token), user.id],
      db,
    );
    await audit(req, { orgId: org.id, action: 'member.invited', entityType: 'invitation', entityId: row.id, diff: { email: input.email, role: input.role } }, db);
    return row;
  });

  const inviteUrl = `${appUrl(req)}/invite/${token}`;
  const inviter = user.name || user.email;
  const emailSent = await sendEmail(
    input.email,
    `${inviter} invited you to ${org.name} on TestScript`,
    `${inviter} invited you to join ${org.name} on TestScript as ${ROLE_LABELS[input.role as Role]}.\n\nAccept: ${inviteUrl}\n\nThis link expires in ${INVITE_TTL_DAYS} days.`,
    `<p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(org.name)}</strong> on TestScript as ${ROLE_LABELS[input.role as Role]}.</p>
     <p><a href="${inviteUrl}">Accept the invitation</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>`,
  );

  res.status(201).json({ ...mapInvitation({ ...invitation, invited_by_name: inviter }), inviteUrl, emailSent });
});

orgsRouter.get('/orgs/:orgId/invitations', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'admin');
  const rows = await query(
    `SELECT i.id, i.email, i.role, i.expires_at, i.created_at, COALESCE(u.name, u.email) AS invited_by_name
       FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.org_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
      ORDER BY i.created_at DESC`,
    [org.id],
  );
  res.json({ data: rows.map(mapInvitation), nextCursor: null });
});

orgsRouter.delete('/orgs/:orgId/invitations/:id', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'admin');
  const row = await one(
    `UPDATE invitations SET revoked_at = now()
      WHERE id::text = $2 AND org_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
    [org.id, req.params.id],
  );
  if (!row) throw notFound('Invitation');
  await audit(req, { orgId: org.id, action: 'invitation.revoked', entityType: 'invitation', entityId: row.id });
  res.status(204).end();
});

async function findInvitation(token: string, db?: Db) {
  return one(
    `SELECT i.*, o.name AS org_name, o.slug AS org_slug, COALESCE(u.name, u.email) AS invited_by_name
       FROM invitations i JOIN organisations o ON o.id = i.org_id
       LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.token_hash = $1 AND i.revoked_at IS NULL`,
    [hashToken(token)],
    db,
  );
}

orgsRouter.get('/invitations/:token', async (req, res) => {
  const inv = await findInvitation(req.params.token);
  if (!inv) throw notFound('Invitation');
  const body: InvitationPreview = {
    orgName: inv.org_name,
    orgSlug: inv.org_slug,
    email: inv.email,
    role: inv.role,
    invitedBy: inv.invited_by_name,
    expired: new Date(inv.expires_at) < new Date(),
    accepted: Boolean(inv.accepted_at),
  };
  res.json(body);
});

orgsRouter.post('/invitations/:token/accept', async (req, res) => {
  const user = currentUser(req);
  const result = await tx(async (db) => {
    const inv = await findInvitation(req.params.token, db);
    if (!inv) throw notFound('Invitation');
    await db.query('SELECT 1 FROM invitations WHERE id = $1 FOR UPDATE', [inv.id]);
    if (inv.accepted_at) {
      if (inv.accepted_by === user.id) return { slug: inv.org_slug, id: inv.org_id };
      throw new HttpError(410, 'invitation_used', 'This invitation has already been used');
    }
    if (new Date(inv.expires_at) < new Date()) {
      throw new HttpError(410, 'invitation_expired', 'This invitation has expired. Ask for a new one.');
    }
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
      throw forbidden(`This invitation is for ${inv.email}. Sign in with that address to accept it.`);
    }
    if (config.authMode === 'auth0' && !user.emailVerified) {
      throw forbidden('Verify your email address first, then try again.');
    }
    const existing = await one('SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2', [inv.org_id, user.id], db);
    if (!existing) {
      await db.query('INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, $3)', [inv.org_id, user.id, inv.role]);
      await syncSeatCount(inv.org_id, db);
    }
    await db.query('UPDATE invitations SET accepted_at = now(), accepted_by = $2 WHERE id = $1', [inv.id, user.id]);
    await audit(req, { orgId: inv.org_id, action: 'member.joined', entityType: 'user', entityId: user.id, diff: { role: inv.role, invitationId: inv.id } }, db);
    return { slug: inv.org_slug, id: inv.org_id };
  });
  res.json({ orgId: result.id, orgSlug: result.slug });
});

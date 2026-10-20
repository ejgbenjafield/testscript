import { Router } from 'express';
import { devLoginSchema, type AuthConfig, type Me } from '@testscript/shared';
import { config } from '../config';
import { query } from '../db';
import { forbidden, parse } from '../errors';
import { signDevToken } from '../middleware/auth';
import { currentUser } from '../authz';

/** Routes that work without a token. */
export const publicAuthRouter = Router();

publicAuthRouter.get('/auth/config', (_req, res) => {
  const body: AuthConfig =
    config.authMode === 'auth0'
      ? {
          mode: 'auth0',
          auth0: { domain: config.auth0.domain, clientId: config.auth0.clientId, audience: config.auth0.audience },
        }
      : { mode: 'dev' };
  res.json({ ...body, devLoginEnabled: config.allowDevLogin });
});

publicAuthRouter.post('/auth/dev-login', async (req, res) => {
  if (!config.allowDevLogin) {
    throw forbidden(
      config.authMode === 'auth0'
        ? 'Dev login is off because Auth0 is configured'
        : 'Dev login is disabled in published apps. Set up Auth0, or set ALLOW_DEV_LOGIN=true for a private preview.',
    );
  }
  const { email, name } = parse(devLoginSchema, req.body);
  res.json({ accessToken: await signDevToken(email, name), expiresIn: 7 * 24 * 3600 });
});

export const meRouter = Router();

meRouter.get('/me', async (req, res) => {
  const user = currentUser(req);
  const orgs = await query(
    `SELECT o.id, o.slug, o.name, m.roles FROM org_members m
       JOIN organisations o ON o.id = m.org_id
      WHERE m.user_id = $1 ORDER BY o.name`,
    [user.id],
  );
  const body: Me = {
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    orgs,
  };
  res.json(body);
});

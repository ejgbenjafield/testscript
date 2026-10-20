import type { NextFunction, Request, Response } from 'express';
import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config';
import { one } from '../db';
import { unauthorized } from '../errors';

const DEV_ISSUER = 'testscript-dev';
const devKey = new TextEncoder().encode(config.signingSecret);

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function auth0Jwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`https://${config.auth0.domain}/.well-known/jwks.json`));
  return jwks;
}

export async function signDevToken(email: string, name?: string) {
  return new SignJWT({ email, name: name || email.split('@')[0], email_verified: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(DEV_ISSUER)
    .setSubject(`dev|${email}`)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(devKey);
}

interface Identity {
  authId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
}

async function verify(token: string): Promise<Identity> {
  let payload: JWTPayload;
  if (config.authMode === 'auth0') {
    ({ payload } = await jwtVerify(token, auth0Jwks(), {
      issuer: `https://${config.auth0.domain}/`,
      audience: config.auth0.audience,
      algorithms: ['RS256'],
    }));
    const ns = config.auth0.claimNamespace;
    const email = (payload[`${ns}email`] ?? payload.email) as string | undefined;
    if (!payload.sub || !email) {
      throw unauthorized('Your login has no email address. Add the post-login Action described in the README.');
    }
    return {
      authId: payload.sub,
      email: email.toLowerCase(),
      name: ((payload[`${ns}name`] ?? payload.name) as string | undefined) ?? null,
      avatarUrl: ((payload[`${ns}picture`] ?? payload.picture) as string | undefined) ?? null,
      emailVerified: Boolean(payload[`${ns}email_verified`] ?? payload.email_verified),
    };
  }
  if (!config.allowDevLogin) throw unauthorized('Dev login is disabled here');
  ({ payload } = await jwtVerify(token, devKey, { issuer: DEV_ISSUER, algorithms: ['HS256'] }));
  return {
    authId: payload.sub!,
    email: String(payload.email).toLowerCase(),
    name: (payload.name as string) ?? null,
    avatarUrl: null,
    emailVerified: true,
  };
}

async function upsertUser(identity: Identity) {
  const existing = await one<{ id: string; email: string; name: string | null; avatar_url: string | null }>(
    'SELECT id, email, name, avatar_url FROM users WHERE auth0_id = $1',
    [identity.authId],
  );
  if (!existing) {
    const created = await one<{ id: string }>(
      `INSERT INTO users (auth0_id, email, name, avatar_url) VALUES ($1, $2, $3, $4)
       ON CONFLICT (auth0_id) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [identity.authId, identity.email, identity.name, identity.avatarUrl],
    );
    return created!.id;
  }
  const name = identity.name ?? existing.name;
  const avatar = identity.avatarUrl ?? existing.avatar_url;
  if (existing.email !== identity.email || existing.name !== name || existing.avatar_url !== avatar) {
    await one('UPDATE users SET email = $2, name = $3, avatar_url = $4, updated_at = now() WHERE id = $1', [
      existing.id,
      identity.email,
      name,
      avatar,
    ]);
  }
  return existing.id;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return next(unauthorized());
  try {
    const identity = await verify(match[1]);
    const id = await upsertUser(identity);
    req.user = { id, ...identity };
    next();
  } catch (err: any) {
    if (err?.status) return next(err);
    next(unauthorized('Your session has expired. Please sign in again.'));
  }
}

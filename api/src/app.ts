import fs from 'fs';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import { config } from './config';
import { pool } from './db';
import { errorHandler, notFoundHandler } from './errors';
import { requireAuth } from './middleware/auth';
import { meRouter, publicAuthRouter } from './routes/auth';
import { orgsRouter } from './routes/orgs';
import { contentRouter } from './routes/content';
import { runsRouter } from './routes/runs';
import { attachmentContentRouter, attachmentsRouter } from './routes/attachments';
import { dashboardRouter } from './routes/dashboard';

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  const auth0Origin = config.auth0.domain ? `https://${config.auth0.domain}` : null;
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'", ...(auth0Origin ? [auth0Origin] : [])],
          frameSrc: ["'self'", ...(auth0Origin ? [auth0Origin] : [])],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'", ...(auth0Origin ? [auth0Origin] : [])],
          frameAncestors: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );

  if (config.corsOrigins.length) {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && config.corsOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
        if (req.method === 'OPTIONS') return void res.status(204).end();
      }
      next();
    });
  }

  app.get('/healthz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(publicAuthRouter);
  api.use(attachmentContentRouter);
  api.use(requireAuth);
  api.use(meRouter, orgsRouter, contentRouter, runsRouter, attachmentsRouter, dashboardRouter);
  api.use(notFoundHandler);
  app.use('/v1', api);

  // In production the same server hands out the built website.
  const indexHtml = path.join(config.webDistDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(
      '/assets',
      express.static(path.join(config.webDistDir, 'assets'), { immutable: true, maxAge: '1y' }),
      notFoundHandler,
    );
    app.use(express.static(config.webDistDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!v1\/|healthz).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  } else if (!config.isTest) {
    app.get('/', (_req, res) => {
      res.type('text').send('TestScript API is running. The website is served by Vite in development (port 5173).');
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

import type { Role } from '@testscript/shared';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        authId: string;
        email: string;
        name: string | null;
        avatarUrl: string | null;
        emailVerified: boolean;
      };
      /** Set by org-scoped routes once the caller's membership is known. */
      org?: { id: string; slug: string; name: string; role: Role };
    }
  }
}

export {};

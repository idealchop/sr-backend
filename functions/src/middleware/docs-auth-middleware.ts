import { createHash } from "crypto";
import { Request, Response, NextFunction } from "express";
import { auth } from "../config/firebase-admin";

const DOCS_COOKIE = "sr_docs_auth";

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function docsSessionToken(): string | null {
  const configured = process.env.DOCS_ADMIN_TOKEN?.trim();
  if (!configured) return null;
  return createHash("sha256").update(configured).digest("hex").slice(0, 32);
}

function hasValidDocsSession(req: Request): boolean {
  const expected = docsSessionToken();
  if (!expected) return false;
  return parseCookies(req)[DOCS_COOKIE] === expected;
}

function grantDocsSession(res: Response): void {
  const value = docsSessionToken();
  if (!value) return;
  res.setHeader(
    "Set-Cookie",
    `${DOCS_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
  );
}

function readDocsAdminToken(req: Request): string | undefined {
  const fromQuery = typeof req.query.token === "string" ? req.query.token : undefined;
  const fromHeader = req.header("x-docs-admin-token");
  if (fromQuery?.trim()) return fromQuery.trim();
  if (fromHeader?.trim()) return fromHeader.trim();
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const bearer = authHeader.slice("Bearer ".length).trim();
    if (bearer && bearer !== "MOCK_TOKEN") return bearer;
  }
  return undefined;
}

/**
 * Gates `/docs` and `/docs.json`.
 * Query `?token=` sets a session cookie so Swagger static assets (CSS/JS) load without 401.
 * @param {Request} req Express request.
 * @param {Response} res Express response.
 * @param {NextFunction} next Express next handler.
 */
export const validateDocsAdminToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (hasValidDocsSession(req)) {
    return next();
  }

  const configuredToken = process.env.DOCS_ADMIN_TOKEN?.trim();

  if (configuredToken) {
    const provided = readDocsAdminToken(req);
    if (provided && provided === configuredToken) {
      grantDocsSession(res);
      return next();
    }
  }

  const isEmulator = !!process.env.FUNCTIONS_EMULATOR;
  if (isEmulator && req.headers.authorization === "Bearer MOCK_TOKEN") {
    grantDocsSession(res);
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).send(`
      <html>
        <body style="font-family:sans-serif;padding:2rem;max-width:40rem">
          <h2>401 – Unauthorized</h2>
          <p>Open docs with your admin token
          (see <code>DOCS_ADMIN_TOKEN</code> in <code>functions/.env</code>):</p>
          <ul>
            <li><code>/docs?token=your_token</code></li>
            <li>Header <code>x-docs-admin-token: your_token</code></li>
          </ul>
          <p>Or use a Firebase ID token with <code>admin: true</code> custom claim:</p>
          <p><code>Authorization: Bearer &lt;firebase-id-token&gt;</code></p>
        </body>
      </html>
    `);
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    const decoded = await auth.verifyIdToken(idToken);
    if (!decoded.admin) {
      res.status(403).send(`
        <html>
          <body style="font-family:sans-serif;padding:2rem">
            <h2>403 – Forbidden</h2>
            <p>Your account does not have the <code>admin</code>
            custom claim required to view API docs.</p>
          </body>
        </html>
      `);
      return;
    }
    (req as any).docsUser = decoded;
    grantDocsSession(res);
    next();
  } catch {
    res.status(401).send(`
      <html>
        <body style="font-family:sans-serif;padding:2rem">
          <h2>401 – Invalid Token</h2>
          <p>Use <code>?token=</code> matching <code>DOCS_ADMIN_TOKEN</code>,
          or a valid Firebase ID token.</p>
        </body>
      </html>
    `);
  }
};

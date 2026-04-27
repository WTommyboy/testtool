import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { db } from "./db";
import { validateAgentToken } from "./agent/agent-tokens";

type SessionUser = {
  login: string;
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

type GithubTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GithubUserResponse = {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
};

type OAuthState = {
  nonce: string;
  returnTo: string;
  iat: number;
};

const sessionCookieName = "uat_session";
const oauthStateCookieName = "uat_oauth_state";
const sevenDaysSeconds = 7 * 24 * 60 * 60;

const parseBooleanEnv = (value: string | undefined): boolean | null => {
  if (value === undefined) return null;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const env = (key: string): string => process.env[key]?.trim() ?? "";

export const isAuthConfigured = (): boolean => Boolean(
  env("GITHUB_CLIENT_ID")
  && env("GITHUB_CLIENT_SECRET")
  && (env("SESSION_SECRET") || process.env.NODE_ENV !== "production")
);

export const isAuthRequired = (): boolean => {
  const explicit = parseBooleanEnv(process.env.AUTH_REQUIRED ?? process.env.REQUIRE_AUTH);
  if (explicit !== null) return explicit;
  return isAuthConfigured();
};

const getSessionSecret = (): string => {
  return env("SESSION_SECRET")
    || env("AGENT_BOOTSTRAP_SECRET")
    || env("MAC_AGENT_BOOTSTRAP_TOKEN")
    || (process.env.NODE_ENV === "production" ? "" : "dev-session-secret");
};

const hashToken = (token: string): string => {
  return createHmac("sha256", getSessionSecret()).update(token).digest("hex");
};

const signValue = (payload: string): string => {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
};

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

const parseCookies = (req: Request): Record<string, string> => {
  const raw = req.header("cookie") ?? "";
  const cookies: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join("="));
  }
  return cookies;
};

const appendCookie = (
  res: Response,
  name: string,
  value: string,
  options: { maxAgeSeconds: number; httpOnly?: boolean }
): void => {
  const secure = process.env.NODE_ENV === "production";
  const sameSite = secure ? "None" : "Lax";
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${options.maxAgeSeconds}`,
    `SameSite=${sameSite}`
  ];
  if (options.httpOnly ?? true) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
};

const clearCookie = (res: Response, name: string): void => {
  appendCookie(res, name, "", { maxAgeSeconds: 0 });
};

export const getAllowedAppOrigins = (): string[] => {
  const extraOrigins = env("CORS_ORIGINS")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const configured = [
    env("APP_ORIGIN"),
    env("WEB_ORIGIN"),
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
    "https://testtool-eight.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...extraOrigins
  ].filter(Boolean);
  return [...new Set(configured)];
};

const defaultReturnTo = (): string => getAllowedAppOrigins()[0] ?? "http://localhost:5173";

const sanitizeReturnTo = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) return defaultReturnTo();
  try {
    const parsed = new URL(value);
    if (getAllowedAppOrigins().includes(parsed.origin)) return parsed.toString();
  } catch {
    // Fall through to default.
  }
  return defaultReturnTo();
};

const createOAuthState = (returnTo: string): string => {
  const payload: OAuthState = {
    nonce: randomBytes(16).toString("base64url"),
    returnTo,
    iat: Date.now()
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signValue(encoded)}`;
};

const parseOAuthState = (state: string): OAuthState | null => {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature || !safeEqual(signature, signValue(encoded))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthState;
    if (!parsed.nonce || !parsed.returnTo || !parsed.iat) return null;
    if (Date.now() - parsed.iat > 10 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
};

const getCallbackUrl = (req: Request): string => {
  if (env("GITHUB_OAUTH_CALLBACK_URL")) return env("GITHUB_OAUTH_CALLBACK_URL");
  const protocol = req.header("x-forwarded-proto") ?? req.protocol;
  const host = req.header("x-forwarded-host") ?? req.header("host");
  return `${protocol}://${host}/api/auth/github/callback`;
};

const allowedGithubLogins = (): string[] => {
  const raw = env("GITHUB_ALLOWED_LOGINS") || "WTommyboy";
  return raw.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
};

const exchangeGithubCode = async (req: Request, code: string): Promise<string> => {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "uat-tool"
    },
    body: JSON.stringify({
      client_id: env("GITHUB_CLIENT_ID"),
      client_secret: env("GITHUB_CLIENT_SECRET"),
      code,
      redirect_uri: getCallbackUrl(req)
    })
  });
  const body = await response.json() as GithubTokenResponse;
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || "GITHUB_TOKEN_EXCHANGE_FAILED");
  }
  return body.access_token;
};

const fetchGithubUser = async (accessToken: string): Promise<GithubUserResponse> => {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${accessToken}`,
      "User-Agent": "uat-tool"
    }
  });
  if (!response.ok) throw new Error(`GITHUB_USER_FETCH_FAILED_${response.status}`);
  return response.json() as Promise<GithubUserResponse>;
};

const createSession = (user: GithubUserResponse): string => {
  const token = `uatsess_${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sevenDaysSeconds * 1000);
  db.prepare(
    `
      INSERT INTO user_sessions (
        id, github_login, github_id, github_name, avatar_url,
        session_token_hash, created_at, expires_at
      )
      VALUES (@id, @github_login, @github_id, @github_name, @avatar_url, @session_token_hash, @created_at, @expires_at)
    `
  ).run({
    id: randomUUID(),
    github_login: user.login,
    github_id: String(user.id),
    github_name: user.name ?? null,
    avatar_url: user.avatar_url ?? null,
    session_token_hash: hashToken(token),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString()
  });
  return token;
};

export const getSessionUser = (req: Request): SessionUser | null => {
  const token = parseCookies(req)[sessionCookieName];
  if (!token) return null;
  const row = db.prepare(
    `
      SELECT github_login, github_id, github_name, avatar_url
      FROM user_sessions
      WHERE session_token_hash = ?
        AND revoked_at IS NULL
        AND expires_at > ?
    `
  ).get(hashToken(token), new Date().toISOString()) as {
    github_login: string;
    github_id: string;
    github_name: string | null;
    avatar_url: string | null;
  } | undefined;
  if (!row) return null;
  return {
    login: row.github_login,
    id: row.github_id,
    name: row.github_name,
    avatarUrl: row.avatar_url
  };
};

const revokeSession = (req: Request): void => {
  const token = parseCookies(req)[sessionCookieName];
  if (!token) return;
  db.prepare("UPDATE user_sessions SET revoked_at = ? WHERE session_token_hash = ? AND revoked_at IS NULL")
    .run(new Date().toISOString(), hashToken(token));
};

const readBearerToken = (req: Request): string => {
  const authHeader = req.header("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
};

export const hasValidAgentBearer = (req: Request): boolean => {
  const token = readBearerToken(req);
  return Boolean(token && validateAgentToken(token));
};

const unauthenticated = (res: Response): Response => {
  return res.status(401).json({
    error: "UNAUTHENTICATED",
    authRequired: isAuthRequired(),
    loginUrl: "/api/auth/github/start"
  });
};

export const requireUser = (req: Request, res: Response, next: NextFunction): void | Response => {
  if (!isAuthRequired()) return next();
  const user = getSessionUser(req);
  if (!user) return unauthenticated(res);
  return next();
};

export const requireUserOrAgent = (req: Request, res: Response, next: NextFunction): void | Response => {
  if (!isAuthRequired()) return next();
  if (hasValidAgentBearer(req)) return next();
  const user = getSessionUser(req);
  if (!user) return unauthenticated(res);
  return next();
};

export const requireAuthConfigured = (_req: Request, res: Response, next: NextFunction): void | Response => {
  if (!isAuthConfigured()) {
    return res.status(503).json({
      error: "AUTH_NOT_CONFIGURED",
      message: "GitHub OAuth env vars are not configured."
    });
  }
  return next();
};

export const authRouter = Router();

authRouter.get("/me", (req, res) => {
  const user = getSessionUser(req);
  if (user) {
    return res.json({
      authenticated: true,
      authRequired: isAuthRequired(),
      user
    });
  }
  if (isAuthRequired()) return unauthenticated(res);
  return res.json({
    authenticated: true,
    authRequired: false,
    user: null
  });
});

authRouter.get("/github/start", requireAuthConfigured, (req, res) => {
  const returnTo = sanitizeReturnTo(req.query.returnTo);
  const state = createOAuthState(returnTo);
  appendCookie(res, oauthStateCookieName, state, { maxAgeSeconds: 10 * 60 });

  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", env("GITHUB_CLIENT_ID"));
  authUrl.searchParams.set("redirect_uri", getCallbackUrl(req));
  authUrl.searchParams.set("scope", "read:user");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("allow_signup", "false");
  return res.redirect(authUrl.toString());
});

authRouter.get("/github/callback", requireAuthConfigured, async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const expectedState = parseCookies(req)[oauthStateCookieName] ?? "";
  const parsedState = state && expectedState && safeEqual(state, expectedState) ? parseOAuthState(state) : null;
  clearCookie(res, oauthStateCookieName);

  if (!code || !parsedState) {
    return res.status(400).json({ error: "INVALID_OAUTH_CALLBACK" });
  }

  try {
    const accessToken = await exchangeGithubCode(req, code);
    const githubUser = await fetchGithubUser(accessToken);
    if (!allowedGithubLogins().includes(githubUser.login.toLowerCase())) {
      return res.status(403).json({
        error: "GITHUB_LOGIN_NOT_ALLOWED",
        login: githubUser.login
      });
    }

    const sessionToken = createSession(githubUser);
    appendCookie(res, sessionCookieName, sessionToken, { maxAgeSeconds: sevenDaysSeconds });
    return res.redirect(parsedState.returnTo);
  } catch (error) {
    return res.status(502).json({
      error: "GITHUB_OAUTH_FAILED",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

authRouter.post("/logout", (req, res) => {
  revokeSession(req);
  clearCookie(res, sessionCookieName);
  return res.json({ ok: true });
});

export const getAuthDiagnostics = (): Record<string, unknown> => {
  const origins = getAllowedAppOrigins();
  return {
    authConfigured: isAuthConfigured(),
    authRequired: isAuthRequired(),
    allowedOriginsHash: createHash("sha256").update(origins.join("|")).digest("hex").slice(0, 12),
    allowedGithubLogins: allowedGithubLogins()
  };
};

// ---------------------------------------------------------------------------
// NextAuth credentials login for the eval harness.
//
// Mirrors the flow used by the earlier tunnelmole smoke tests: fetch the CSRF
// token from /api/auth/csrf, POST credentials to /api/auth/callback/credentials
// with the cookie + form body, then follow the Set-Cookie headers back to pick
// up the session token. Returns a Cookie header string we can thread through
// subsequent /api/convert requests.
// ---------------------------------------------------------------------------

interface Cookie {
  name: string;
  value: string;
}

const DEFAULT_EMAIL = "admin@bicep.dev";
const DEFAULT_PASSWORD = "admin";

/** Parse one Set-Cookie header into {name, value}. */
function parseSetCookie(header: string): Cookie | null {
  const first = header.split(";")[0];
  const eq = first.indexOf("=");
  if (eq < 0) return null;
  return { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() };
}

/** Collect Set-Cookie headers from a fetch Response into a cookie jar. */
function harvestCookies(res: Response, jar: Map<string, string>): void {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const c = parseSetCookie(line);
    if (c) jar.set(c.name, c.value);
  }
}

/** Serialise a cookie jar into a single `Cookie:` request header value. */
function serializeCookies(jar: Map<string, string>): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export interface LoginResult {
  cookie: string;
  baseUrl: string;
}

/**
 * Perform a credentials login and return a Cookie header ready to pass to
 * /api/convert. Throws on auth failure so the runner aborts loudly.
 */
export async function login(opts: {
  baseUrl: string;
  email?: string;
  password?: string;
}): Promise<LoginResult> {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const email = opts.email ?? DEFAULT_EMAIL;
  const password = opts.password ?? DEFAULT_PASSWORD;
  const jar = new Map<string, string>();

  // 1. CSRF token
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`, {
    headers: { Accept: "application/json" },
  });
  if (!csrfRes.ok) {
    throw new Error(`CSRF fetch failed: ${csrfRes.status} ${csrfRes.statusText}`);
  }
  harvestCookies(csrfRes, jar);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  if (!csrfToken) throw new Error("No csrfToken in /api/auth/csrf response");

  // 2. Credentials callback (don't auto-follow — the redirect drops cookies)
  const body = new URLSearchParams({
    email,
    password,
    csrfToken,
    callbackUrl: `${baseUrl}/`,
    json: "true",
  });
  const cbRes = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Cookie: serializeCookies(jar),
    },
    body,
  });
  harvestCookies(cbRes, jar);

  // 3. Sanity-check via /api/auth/session
  const sessRes = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: serializeCookies(jar), Accept: "application/json" },
  });
  harvestCookies(sessRes, jar);
  if (!sessRes.ok) {
    throw new Error(
      `Session check failed: ${sessRes.status} ${sessRes.statusText}`,
    );
  }
  const session = (await sessRes.json()) as { user?: { email?: string } };
  if (!session?.user?.email) {
    throw new Error(
      `Login appeared to succeed but /api/auth/session returned no user (tried ${email}). Check AUTH_SECRET + credentials in the running app.`,
    );
  }

  return { cookie: serializeCookies(jar), baseUrl };
}

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type TokenBoardIdentity = {
  userId: string;
  displayName: string;
  team?: string;
  githubId?: number;
  githubLogin?: string;
  avatarUrl?: string;
};

export type GitHubUserProfile = {
  id?: number;
  login?: string;
  name?: string | null;
  avatar_url?: string;
};

type SignedTokenPayload = {
  purpose: "agent" | "oauth-state" | "web";
  exp: number;
  iat: number;
  nonce?: string;
  returnTo?: string;
  identity?: TokenBoardIdentity;
};

export function createWebSessionToken(identity: TokenBoardIdentity, secret: string, ttlSeconds: number) {
  return signPayload({ purpose: "web", identity }, secret, ttlSeconds);
}

export function createAgentSessionToken(identity: TokenBoardIdentity, secret: string, ttlSeconds: number) {
  return signPayload({ purpose: "agent", identity }, secret, ttlSeconds);
}

export function createOAuthState(returnTo: string, secret: string, ttlSeconds: number) {
  return signPayload(
    {
      purpose: "oauth-state",
      returnTo,
      nonce: randomBytes(16).toString("hex"),
    },
    secret,
    ttlSeconds
  );
}

export function verifyWebSessionToken(token: string, secret: string) {
  return verifySignedPayload(token, secret, "web")?.identity;
}

export function verifyAgentSessionToken(token: string, secret: string) {
  return verifySignedPayload(token, secret, "agent")?.identity;
}

export function verifyOAuthState(token: string, secret: string) {
  return verifySignedPayload(token, secret, "oauth-state");
}

export function identityFromGitHubUser(profile: GitHubUserProfile): TokenBoardIdentity {
  const githubId = typeof profile.id === "number" ? profile.id : 0;
  const githubLogin = sanitizeText(profile.login, 80);
  const displayName = sanitizeText(profile.name, 80) || githubLogin || `github-${githubId}`;

  return {
    userId: githubId > 0 ? `github:${githubId}` : `github:${githubLogin}`,
    displayName,
    team: "GitHub",
    githubId,
    githubLogin,
    avatarUrl: sanitizeText(profile.avatar_url, 240) || undefined,
  };
}

export function isGithubIdentityAllowed(identity: TokenBoardIdentity, allowedLogins: string[]) {
  if (!allowedLogins.length) {
    return true;
  }

  const login = identity.githubLogin?.toLowerCase() || "";
  return allowedLogins.map((item) => item.toLowerCase()).includes(login);
}

export function parseCookieHeader(header: string | undefined) {
  const cookies = new Map<string, string>();

  for (const item of (header || "").split(";")) {
    const [name, ...rest] = item.trim().split("=");
    if (name && rest.length) {
      cookies.set(name, decodeURIComponent(rest.join("=")));
    }
  }

  return cookies;
}

export function sanitizeReturnTo(value: string | null, allowedOrigins: string[], fallback: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return fallback;
  }

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    if (allowedOrigins.includes(url.origin)) {
      return url.toString();
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function signPayload(
  value: Omit<SignedTokenPayload, "exp" | "iat">,
  secret: string,
  ttlSeconds: number
) {
  const now = Math.floor(Date.now() / 1000);
  const payload: SignedTokenPayload = {
    ...value,
    iat: now,
    exp: now + ttlSeconds,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = hmac(encoded, secret);

  return `${encoded}.${signature}`;
}

function verifySignedPayload(token: string, secret: string, purpose: SignedTokenPayload["purpose"]) {
  const [encoded, signature] = token.split(".");

  try {
    if (!encoded || !signature || !timingSafeStringEqual(signature, hmac(encoded, secret))) {
      return undefined;
    }

    const payload = JSON.parse(base64UrlDecode(encoded)) as SignedTokenPayload;

    if (payload.purpose !== purpose || payload.exp < Math.floor(Date.now() / 1000)) {
      return undefined;
    }

    return payload;
  } catch {
    return undefined;
  }
}

function hmac(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sanitizeText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

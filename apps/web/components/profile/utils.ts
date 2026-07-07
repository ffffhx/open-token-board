import type { TokenLeaderboardUser } from "@open-token-board/core";

export function normalizeProfileLogin(value: string | null | undefined) {
  const text = (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!text) {
    return "";
  }

  const withoutGithubUrl = text.replace(/^https?:\/\/(?:www\.)?github\.com\//, "").split(/[/?#]/)[0] || text;
  const candidate = withoutGithubUrl
    .replace(/^@+/, "")
    .replace(/^github:/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39);

  return /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(candidate) ? candidate : "";
}

export function profileLoginForUser(user: Pick<TokenLeaderboardUser, "displayName" | "userId">) {
  return normalizeProfileLogin(user.userId) || normalizeProfileLogin(user.displayName);
}

export function profileHrefForUser(user: Pick<TokenLeaderboardUser, "displayName" | "userId">) {
  const login = profileLoginForUser(user);
  return login ? `/u?login=${encodeURIComponent(login)}` : "/u";
}


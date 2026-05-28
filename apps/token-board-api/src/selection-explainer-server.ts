import http from "node:http";

import {
  isGithubIdentityAllowed,
  parseCookieHeader,
  verifyWebSessionToken,
  type TokenBoardIdentity,
} from "@open-token-board/core/auth";
import {
  explainSelectionWithKimi,
  parseSelectionExplainPayload,
  SelectionExplainServiceError,
} from "@open-token-board/core/selection-explainer";

const DEFAULT_PORT = 8791;
const DEFAULT_OWNER_GITHUB_LOGINS = ["ffffhx"];
const MAX_BODY_BYTES = 16 * 1024;
const SESSION_COOKIE_NAME =
  process.env.SELECTION_EXPLAIN_SESSION_COOKIE_NAME || "token_board_session";

const host = process.env.SELECTION_EXPLAIN_HOST || "127.0.0.1";
const port = Number(process.env.SELECTION_EXPLAIN_PORT || DEFAULT_PORT);

function parseAllowedGithubLogins() {
  const configured =
    process.env.SELECTION_EXPLAIN_ALLOWED_GITHUB_LOGINS ||
    process.env.TOKEN_BOARD_ALLOWED_GITHUB_LOGINS ||
    "";
  const logins = configured
    .split(",")
    .map((login) => login.trim())
    .filter(Boolean);

  return logins.length ? logins : DEFAULT_OWNER_GITHUB_LOGINS;
}

function parseAllowedOrigins() {
  const configured = process.env.SELECTION_EXPLAIN_ALLOWED_ORIGINS?.trim();

  if (!configured) {
    return ["*"];
  }

  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins();
const allowedGithubLogins = parseAllowedGithubLogins();

function getCorsOrigin(request: http.IncomingMessage) {
  const origin = request.headers.origin;

  if (!origin) {
    return "*";
  }

  if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    return origin;
  }

  return "";
}

function writeJson(
  response: http.ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
  corsOrigin = "*"
) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": corsOrigin,
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  });
  response.end(JSON.stringify(payload));
}

function authSecret() {
  return (
    process.env.SELECTION_EXPLAIN_AUTH_SECRET ||
    process.env.TOKEN_BOARD_AUTH_SECRET ||
    "dev-only-token-board-auth-secret"
  );
}

function authenticateSelectionRequest(request: http.IncomingMessage):
  | {
      identity: TokenBoardIdentity;
      ok: true;
    }
  | {
      error: string;
      ok: false;
      status: number;
    } {
  const token = parseCookieHeader(request.headers.cookie).get(SESSION_COOKIE_NAME) || "";
  const identity = token ? verifyWebSessionToken(token, authSecret()) : undefined;

  if (!identity) {
    return {
      error: "请先用作者 GitHub 账号登录后再使用 AI 解释。",
      ok: false,
      status: 401,
    };
  }

  if (!isGithubIdentityAllowed(identity, allowedGithubLogins)) {
    return {
      error: "当前 GitHub 账号不在选词 AI 解释白名单中。",
      ok: false,
      status: 403,
    };
  }

  return {
    identity,
    ok: true,
  };
}

function readJsonBody(request: http.IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        reject(new Error("请求体过大。"));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("请求体必须是 JSON。"));
      }
    });

    request.on("error", reject);
  });
}

async function handleExplainSelection(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  corsOrigin: string
) {
  const auth = authenticateSelectionRequest(request);

  if (!auth.ok) {
    writeJson(
      response,
      auth.status,
      {
        error: auth.error,
      },
      corsOrigin
    );
    return;
  }

  let body: unknown;

  try {
    body = await readJsonBody(request);
  } catch (error) {
    writeJson(
      response,
      400,
      {
        error: error instanceof Error ? error.message : "请求体不正确。",
      },
      corsOrigin
    );
    return;
  }

  const parsed = parseSelectionExplainPayload(body);

  if (!parsed.ok) {
    writeJson(
      response,
      400,
      {
        error: parsed.error,
      },
      corsOrigin
    );
    return;
  }

  try {
    const explanation = await explainSelectionWithKimi(parsed.data);

    writeJson(
      response,
      200,
      {
        explanation,
      },
      corsOrigin
    );
  } catch (error) {
    if (error instanceof SelectionExplainServiceError) {
      writeJson(
        response,
        error.status,
        {
          code: error.code,
          error: error.message,
        },
        corsOrigin
      );
      return;
    }

    writeJson(
      response,
      500,
      {
        error: "AI 解释暂时不可用，请稍后再试。",
      },
      corsOrigin
    );
  }
}

const server = http.createServer(async (request, response) => {
  const corsOrigin = getCorsOrigin(request);

  if (!corsOrigin) {
    writeJson(
      response,
      403,
      {
        error: "当前来源不允许访问选词解释服务。",
      }
    );
    return;
  }

  if (request.method === "OPTIONS") {
    writeJson(response, 204, {}, corsOrigin);
    return;
  }

  const url = new URL(
    request.url || "/",
    `http://${request.headers.host || `${host}:${port}`}`
  );

  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(
      response,
      200,
      {
        authRequired: true,
        allowedGithubLogins,
        keyConfigured: Boolean(process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY),
        ok: true,
      },
      corsOrigin
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/explain-selection") {
    await handleExplainSelection(request, response, corsOrigin);
    return;
  }

  writeJson(
    response,
    404,
    {
      error: "Not found",
    },
    corsOrigin
  );
});

server.listen(port, host, () => {
  console.log(`Selection explainer server listening on http://${host}:${port}`);
});

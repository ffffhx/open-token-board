import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

import { getAvailablePort } from "./harness";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

export type StaticServer = {
  close: () => Promise<void>;
  port: number;
  url: string;
};

export async function startStaticServer(rootDir: string, port = 0): Promise<StaticServer> {
  const actualPort = port || (await getAvailablePort());
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
      const filePath = await resolveStaticPath(rootDir, requestUrl.pathname);
      const body = await fs.readFile(filePath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(error instanceof NotFoundError ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(error instanceof Error ? error.message : "Static server error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(actualPort, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    close: () => closeServer(server),
  };
}

async function resolveStaticPath(rootDir: string, pathname: string) {
  const decoded = decodeURIComponent(pathname);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const candidate = path.join(rootDir, normalized);
  const safeRoot = path.resolve(rootDir);
  const safeCandidate = path.resolve(candidate);

  if (!safeCandidate.startsWith(safeRoot)) {
    throw new NotFoundError("Not found");
  }

  const stat = await fs.stat(safeCandidate).catch(() => null);
  if (stat?.isDirectory()) {
    return path.join(safeCandidate, "index.html");
  }
  if (stat?.isFile()) {
    return safeCandidate;
  }

  const routeIndex = path.join(safeCandidate, "index.html");
  if (await exists(routeIndex)) {
    return routeIndex;
  }

  throw new NotFoundError("Not found");
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

class NotFoundError extends Error {}

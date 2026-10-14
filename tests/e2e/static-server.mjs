#!/usr/bin/env node
/**
 * Minimal static server for the Next.js `output: "export"` build, used only by Playwright.
 * Mimics GitHub Pages closely enough for E2E: `trailingSlash: true` directories resolve to
 * `index.html`, a directory requested without the slash gets a 301 to the slashed URL, query
 * strings are ignored (deep links like `/reservas/sesion/?id=` refresh to the same file), and
 * unknown paths return `404.html` with status 404. No dependencies beyond node:*.
 *
 * Usage: node tests/e2e/static-server.mjs <root-dir> <port>
 */
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, resolve, sep } from "node:path"

const [rootArg, portArg] = process.argv.slice(2)
if (!rootArg || !portArg) {
  console.error("Usage: node tests/e2e/static-server.mjs <root-dir> <port>")
  process.exit(1)
}
const ROOT = resolve(rootArg)
const PORT = Number(portArg)

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
}

async function fileAt(path) {
  try {
    const info = await stat(path)
    return info.isFile() ? info : null
  } catch {
    return null
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function send(res, status, path, size, method) {
  res.writeHead(status, {
    "content-type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
    "content-length": size,
    "cache-control": "no-store",
  })
  if (method === "HEAD") return res.end()
  createReadStream(path).pipe(res)
}

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET"
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }).end()
    return
  }
  const url = new URL(req.url ?? "/", "http://localhost")
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    res.writeHead(400).end()
    return
  }
  const target = resolve(join(ROOT, pathname))
  // Never serve outside the export directory.
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    res.writeHead(403).end()
    return
  }

  if (await isDirectory(target)) {
    if (!pathname.endsWith("/")) {
      res.writeHead(301, { location: `${url.pathname}/${url.search}` }).end()
      return
    }
    const index = join(target, "index.html")
    const info = await fileAt(index)
    if (info) return send(res, 200, index, info.size, method)
  } else {
    const info = await fileAt(target)
    if (info) return send(res, 200, target, info.size, method)
  }

  const notFound = join(ROOT, "404.html")
  const info = await fileAt(notFound)
  if (info) return send(res, 404, notFound, info.size, method)
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found")
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`static-server: ${ROOT} on http://127.0.0.1:${PORT}`)
})

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)))

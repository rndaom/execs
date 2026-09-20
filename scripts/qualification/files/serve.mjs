import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const root = path.resolve(process.argv[2]);
const config = JSON.parse(readFileSync(path.join(repo, "apps/desktop/src-tauri/tauri.conf.json")));
const csp = config.app.security.csp;
if (typeof csp !== "string" || !csp.includes("default-src 'self'")) {
  throw new Error("Expected the actual product CSP string");
}
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
    "Content-Security-Policy": csp,
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(response);
}).listen(8765, "127.0.0.1", () => console.log("Native qualification production fixture: 8765"));

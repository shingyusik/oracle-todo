const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function createUiServer({ uiPath, apiPort }) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/todo-engine/")) {
        await proxyApi(request, response, url, apiPort);
        return;
      }
      await serveStatic(uiPath, url.pathname, response);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error.message);
    }
  });
}

async function serveStatic(uiPath, pathname, response) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const requested = path.normalize(path.join(uiPath, relativePath));
  const root = path.normalize(uiPath + path.sep);
  const filePath = requested.startsWith(root) ? requested : path.join(uiPath, "index.html");

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, { "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream" });
    response.end(content);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const content = await fs.readFile(path.join(uiPath, "index.html"));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(content);
  }
}

function proxyApi(request, response, url, apiPort) {
  return new Promise((resolve, reject) => {
    const apiPath = `${url.pathname.replace(/^\/todo-engine/, "")}${url.search}`;
    const proxy = http.request(
      {
        hostname: "127.0.0.1",
        port: apiPort,
        path: apiPath,
        method: request.method,
        headers: request.headers,
      },
      (apiResponse) => {
        response.writeHead(apiResponse.statusCode || 502, apiResponse.headers);
        apiResponse.pipe(response);
        apiResponse.on("end", resolve);
      },
    );
    proxy.on("error", reject);
    request.pipe(proxy);
  });
}

module.exports = { createUiServer };

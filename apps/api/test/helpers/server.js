import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { fakeSmtpServer } from "./fakeSmtp.js";

const apiDir = fileURLToPath(new URL("../..", import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// Starts the real API (in-memory store) with a fake SMTP server and returns helpers.
export async function startApi(extraEnv = {}) {
  const smtp = await fakeSmtpServer();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}/api`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(port),
      MONGODB_URI: "",
      JWT_SECRET: "e2e-test-secret-e2e-test-secret-123456",
      NODE_ENV: "test",
      CLIENT_URL: "http://localhost:4410",
      LLM_PROVIDER: "rules",
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(smtp.port),
      EMAIL_FROM: "TalentOS <no-reply@example.com>",
      ADMIN_EMAILS: "",
      DEFAULT_ROLE: "",
      AUTH_RATE_LIMIT: "1000",
      API_RATE_LIMIT: "10000",
      ...extraEnv
    },
    stdio: "ignore"
  });

  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // A client with its own cookie jar.
  function client() {
    let cookie = "";
    const api = async (method, path, body) => {
      const headers = { "content-type": "application/json" };
      if (cookie) headers.cookie = cookie;
      const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie && /auth_token=/.test(setCookie)) {
        const value = setCookie.split(";")[0];
        cookie = /auth_token=;/.test(value) ? "" : value;
      }
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, data, res };
    };
    // Raw request: send bytes (Buffer) and get the raw response bytes back.
    api.raw = async (method, path, body, headers = {}) => {
      const requestHeaders = { ...headers };
      if (cookie) requestHeaders.cookie = cookie;
      const res = await fetch(`${base}${path}`, { method, headers: requestHeaders, body });
      const bytes = Buffer.from(await res.arrayBuffer());
      let data = null;
      try { data = JSON.parse(bytes.toString("utf8")); } catch { /* binary */ }
      return { status: res.status, data, bytes, res };
    };
    api.upload = (path, buffer, filename = "resume.pdf") =>
      api.raw("POST", path, buffer, { "content-type": "application/octet-stream", "x-filename": encodeURIComponent(filename) });
    api.get = (path) => api("GET", path);
    api.post = (path, body = {}) => api("POST", path, body);
    api.put = (path, body = {}) => api("PUT", path, body);
    api.patch = (path, body = {}) => api("PATCH", path, body);
    api.delete = (path) => api("DELETE", path);
    return api;
  }

  return {
    base,
    smtp,
    client,
    async stop() {
      child.kill();
      smtp.server.close();
    }
  };
}

// Waits until the fake SMTP server has received a message, then returns it decoded.
export async function nextMail(smtp, { clear = false } = {}) {
  for (let i = 0; i < 40 && !smtp.received.data; i += 1) await new Promise((r) => setTimeout(r, 100));
  const raw = smtp.received.data || "";
  if (clear) smtp.received.data = "";
  return raw.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
}

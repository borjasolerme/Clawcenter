import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { request } from "node:http";

const port = 3050;
const url = `http://127.0.0.1:${port}`;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function waitForServer(getServerOutput, timeoutMs = 30_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = request(url, { method: "GET", timeout: 1000 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve(undefined);
        else retry();
      });
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
      req.end();
    };

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for Next.js\n\n${getServerOutput()}`));
      }
      else setTimeout(check, 500);
    };

    check();
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `${command} exited ${code}`));
    });
  });
}

const server = spawn("npx", ["next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
  stdio: ["ignore", "pipe", "pipe"],
});
let serverStdout = "";
let serverStderr = "";
server.stdout.on("data", (chunk) => (serverStdout += chunk));
server.stderr.on("data", (chunk) => (serverStderr += chunk));

try {
  await waitForServer(() => [serverStdout, serverStderr].filter(Boolean).join("\n"));
  if (!existsSync(chromePath)) {
    throw new Error(`Chrome not found at ${chromePath}`);
  }
  const { stdout } = await run(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--user-data-dir=/tmp/clawcenter-smoke",
    "--dump-dom",
    url,
  ]);
  for (const text of ["Clawcenter", "Agents org chart", "Schedules", "Activity"]) {
    if (!stdout.includes(text)) throw new Error(`Rendered page missing text: ${text}`);
  }
  console.log("Browser smoke test passed");
} finally {
  server.kill("SIGTERM");
}

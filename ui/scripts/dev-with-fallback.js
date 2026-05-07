const net = require("net");
const { spawn } = require("child_process");

const host = process.env.DEV_HOST || "127.0.0.1";
const startPort = Number(process.env.DEV_PORT || 3000);
const maxAttempts = Number(process.env.DEV_PORT_MAX_ATTEMPTS || 20);

function isPortAvailable(port, hostname) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, hostname);
  });
}

async function findAvailablePort() {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = startPort + offset;
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(candidate, host);
    if (available) {
      return candidate;
    }
  }

  return null;
}

async function main() {
  const port = await findAvailablePort();

  if (port === null) {
    console.error(
      `[dev-with-fallback] No available port found from ${startPort} to ${
        startPort + maxAttempts - 1
      } on ${host}.`
    );
    process.exit(1);
  }

  if (port !== startPort) {
    console.log(
      `[dev-with-fallback] Port ${startPort} is in use. Falling back to ${port}.`
    );
  } else {
    console.log(`[dev-with-fallback] Using port ${port}.`);
  }

  const nextBin = require.resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "dev", "-H", host, "-p", String(port)], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error("[dev-with-fallback] Failed to start dev server:", error);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Local-only smoke check for the built Native Core dummy pipeline through the
 * localhost MotionFrame WebSocket bridge.
 *
 * Runs the built `lvk-tracker-core` executable in dummy/noop mode, pipes its
 * stdout MotionFrame JSON into `tools/motion-ws-bridge.mjs`, connects a
 * dependency-free WebSocket client to `ws://127.0.0.1:45731/motion`, and
 * validates a bounded number of received native MotionFrame JSON messages.
 *
 * Usage:
 *   node tools/check-native-dummy-pipeline-ws-smoke.mjs [path-to-lvk-tracker-core]
 */
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNativeMotionFrameJson } from "../packages/motion-protocol/src/motion-frame-validation.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const HOST = "127.0.0.1";
const PORT = 45731;
const PATH = "/motion";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const TIMEOUT_MS = 10000;
const REQUIRED_FRAME_COUNT = 3;

const fail = (message) => {
  console.error(`Native dummy pipeline WebSocket smoke failed: ${message}`);
  process.exit(1);
};

const resolveExecutable = () => {
  const provided = process.argv[2];
  if (provided) {
    return provided;
  }

  const candidates = [
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "Debug",
      "lvk-tracker-core.exe",
    ),
    join(
      repoRoot,
      "native",
      "tracker-core",
      "build",
      "Release",
      "lvk-tracker-core.exe",
    ),
    join(repoRoot, "native", "tracker-core", "build", "lvk-tracker-core.exe"),
    join(repoRoot, "native", "tracker-core", "build", "lvk-tracker-core"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const createWebSocketAccept = (key) => {
  return crypto.createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
};

const decodeTextFrame = (buffer) => {
  if (buffer.length < 2) {
    return null;
  }

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const fin = (firstByte & 0x80) === 0x80;
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) === 0x80;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (!fin) {
    fail("received fragmented WebSocket frame");
  }

  if (opcode !== 0x1) {
    fail(`received non-text WebSocket frame opcode ${opcode}`);
  }

  if (masked) {
    fail("received masked server WebSocket frame");
  }

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }

    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }

    const longPayloadLength = buffer.readBigUInt64BE(offset);
    if (longPayloadLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail("received WebSocket frame payload that is too large");
    }

    payloadLength = Number(longPayloadLength);
    offset += 8;
  }

  const frameLength = offset + payloadLength;
  if (buffer.length < frameLength) {
    return null;
  }

  return {
    text: buffer.subarray(offset, frameLength).toString("utf8"),
    remaining: buffer.subarray(frameLength),
  };
};

const runSmokeCheck = async (executablePath) => {
  const bridgeChild = spawn(process.execPath, ["tools/motion-ws-bridge.mjs"], {
    cwd: repoRoot,
    stdio: ["pipe", "ignore", "pipe"],
  });

  const trackerChild = spawn(
    executablePath,
    [
      "--camera-source",
      "dummy",
      "--face-detector",
      "noop",
      "--continuous",
      "--realtime",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  trackerChild.stdout.pipe(bridgeChild.stdin);

  let activeSocket = null;
  let bridgeStderr = "";
  let trackerStderr = "";
  let settled = false;
  let retryTimer = null;
  let handshakeComplete = false;
  let connected = false;
  let received = Buffer.alloc(0);
  let validFrameCount = 0;
  const webSocketKey = crypto.randomBytes(16).toString("base64");

  const clearRetryTimer = () => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const destroyActiveSocket = () => {
    if (activeSocket !== null) {
      activeSocket.destroy();
      activeSocket = null;
    }
  };

  const killAndWait = async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    await new Promise((resolve) => {
      const finishExit = () => {
        clearTimeout(killTimer);
        resolve();
      };

      child.once("exit", finishExit);
      child.kill();

      const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 1000);
      killTimer.unref();
    });
  };

  const cleanup = async () => {
    clearRetryTimer();
    destroyActiveSocket();

    if (!trackerChild.stdin?.destroyed) {
      trackerChild.stdin?.end?.();
    }

    await killAndWait(trackerChild);

    if (!bridgeChild.stdin.destroyed) {
      bridgeChild.stdin.end();
    }

    await killAndWait(bridgeChild);
  };

  try {
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        clearRetryTimer();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const timer = setTimeout(() => {
        finish(
          new Error(
            `timed out after ${TIMEOUT_MS}ms waiting for ${REQUIRED_FRAME_COUNT} valid native MotionFrame messages ` +
              `(received ${validFrameCount})`,
          ),
        );
      }, TIMEOUT_MS);

      const connect = () => {
        if (settled) {
          return;
        }

        connected = false;
        destroyActiveSocket();

        const socket = new net.Socket();
        activeSocket = socket;

        socket.on("error", (error) => {
          if (!connected && error.code === "ECONNREFUSED") {
            socket.destroy();
            if (activeSocket === socket) {
              activeSocket = null;
            }
            retryTimer = setTimeout(connect, 50);
            retryTimer.unref();
            return;
          }

          finish(new Error(`socket error: ${error.message}`));
        });

        socket.on("data", (chunk) => {
          try {
            received = Buffer.concat([received, chunk]);

            if (!handshakeComplete) {
              const headerEnd = received.indexOf("\r\n\r\n");
              if (headerEnd === -1) {
                return;
              }

              const headers = received.subarray(0, headerEnd).toString("utf8");
              if (!headers.startsWith("HTTP/1.1 101 ")) {
                fail(
                  `invalid WebSocket handshake status: ${headers.split("\r\n")[0]}`,
                );
              }

              const acceptHeader = headers
                .split("\r\n")
                .find((line) =>
                  line.toLowerCase().startsWith("sec-websocket-accept:"),
                );
              const expectedAccept = createWebSocketAccept(webSocketKey);
              const actualAccept = acceptHeader
                ?.slice(acceptHeader.indexOf(":") + 1)
                .trim();

              if (actualAccept !== expectedAccept) {
                fail(
                  "invalid Sec-WebSocket-Accept header in handshake response",
                );
              }

              handshakeComplete = true;
              received = received.subarray(headerEnd + 4);
            }

            for (;;) {
              const decoded = decodeTextFrame(received);
              if (decoded === null) {
                break;
              }

              received = decoded.remaining;

              const frame = parseNativeMotionFrameJson(decoded.text);
              if (frame === null) {
                fail(
                  `received invalid native MotionFrame JSON: ${decoded.text}`,
                );
              }

              validFrameCount += 1;
              if (validFrameCount >= REQUIRED_FRAME_COUNT) {
                finish();
                return;
              }
            }
          } catch (error) {
            finish(error);
          }
        });

        socket.on("connect", () => {
          connected = true;
          socket.write(
            `GET ${PATH} HTTP/1.1\r\n` +
              `Host: ${HOST}:${PORT}\r\n` +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Key: ${webSocketKey}\r\n` +
              "Sec-WebSocket-Version: 13\r\n" +
              "\r\n",
          );
        });

        socket.connect(PORT, HOST);
      };

      bridgeChild.stderr.setEncoding("utf8");
      bridgeChild.stderr.on("data", (chunk) => {
        bridgeStderr += chunk;
        if (chunk.includes("EADDRINUSE")) {
          finish(new Error(`port ${PORT} is already in use`));
        }
      });

      trackerChild.stderr.setEncoding("utf8");
      trackerChild.stderr.on("data", (chunk) => {
        trackerStderr += chunk;
      });

      bridgeChild.on("error", (error) => {
        finish(
          new Error(`could not start MotionFrame bridge: ${error.message}`),
        );
      });

      trackerChild.on("error", (error) => {
        finish(
          new Error(`could not start ${executablePath}: ${error.message}`),
        );
      });

      bridgeChild.on("exit", (code, signal) => {
        if (!settled) {
          finish(
            new Error(
              `MotionFrame bridge exited before check completed (code ${code}, signal ${signal})` +
                (bridgeStderr ? `; stderr: ${bridgeStderr.trim()}` : ""),
            ),
          );
        }
      });

      trackerChild.on("exit", (code, signal) => {
        if (!settled && validFrameCount < REQUIRED_FRAME_COUNT) {
          finish(
            new Error(
              `${executablePath} exited before ${REQUIRED_FRAME_COUNT} valid frames were received ` +
                `(code ${code}, signal ${signal}, received ${validFrameCount})` +
                (trackerStderr ? `; stderr: ${trackerStderr.trim()}` : ""),
            ),
          );
        }
      });

      connect();
    });
  } finally {
    await cleanup();
  }
};

const executablePath = resolveExecutable();

if (!executablePath) {
  fail(
    "native tracker executable not found. " +
      "Build it first with: cmake -S native/tracker-core -B native/tracker-core/build && " +
      "cmake --build native/tracker-core/build, or pass the binary path as the first argument.",
  );
}

try {
  await runSmokeCheck(executablePath);
  console.log(
    `Native dummy pipeline WebSocket smoke passed: received ${REQUIRED_FRAME_COUNT} valid native MotionFrame messages through ws://${HOST}:${PORT}${PATH}.`,
  );
} catch (error) {
  console.error(
    `Native dummy pipeline WebSocket smoke failed: ${error.message}`,
  );
  process.exit(1);
}

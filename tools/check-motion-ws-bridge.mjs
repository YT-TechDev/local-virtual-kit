#!/usr/bin/env node
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";
import { parseNativeMotionFrameJson } from "../packages/motion-protocol/src/motion-frame-validation.js";

const HOST = "127.0.0.1";
const PORT = 45731;
const PATH = "/motion";
const TIMEOUT_MS = 5000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const validNativeMotionFrame = {
  schemaVersion: 1,
  timestampMs: Date.now(),
  source: "native",
  tracking: {
    status: "tracking",
    confidence: 1,
  },
  face: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { pitch: 0, yaw: 0, roll: 0 },
  },
  eyes: {
    leftOpen: 1,
    rightOpen: 1,
    gaze: { x: 0, y: 0 },
  },
  mouth: {
    open: 0,
    smile: 0,
  },
};

const fail = (message) => {
  throw new Error(
    `MotionFrame WebSocket bridge smoke check failed: ${message}`,
  );
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

const runSmokeCheck = async () => {
  const child = spawn(process.execPath, ["tools/motion-ws-bridge.mjs"], {
    stdio: ["pipe", "ignore", "pipe"],
  });
  let activeSocket = null;
  let stderr = "";
  let settled = false;
  let retryTimer = null;
  let shutdownTimer = null;
  let handshakeComplete = false;
  let connected = false;
  let received = Buffer.alloc(0);
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

  const waitForChildExit = async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    await new Promise((resolve) => {
      const finish = () => {
        if (shutdownTimer !== null) {
          clearTimeout(shutdownTimer);
          shutdownTimer = null;
        }
        resolve();
      };

      child.once("exit", finish);

      if (child.exitCode !== null || child.signalCode !== null) {
        finish();
        return;
      }

      shutdownTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 500);
      shutdownTimer.unref();
    });
  };

  const cleanup = async () => {
    clearRetryTimer();
    destroyActiveSocket();

    if (!child.stdin.destroyed) {
      child.stdin.end();
    }

    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGINT");
    }

    await waitForChildExit();
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
            `MotionFrame WebSocket bridge smoke check failed: timed out after ${TIMEOUT_MS}ms`,
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

          finish(
            new Error(
              `MotionFrame WebSocket bridge smoke check failed: socket error: ${error.message}`,
            ),
          );
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
              child.stdin.write(`${JSON.stringify(validNativeMotionFrame)}\n`);
            }

            const decoded = decodeTextFrame(received);
            if (decoded === null) {
              return;
            }

            const frame = parseNativeMotionFrameJson(decoded.text);
            if (frame === null) {
              fail(`received invalid native MotionFrame JSON: ${decoded.text}`);
            }

            finish();
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

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (chunk.includes("EADDRINUSE")) {
          finish(
            new Error(
              `MotionFrame WebSocket bridge smoke check failed: port ${PORT} is already in use`,
            ),
          );
        }
      });

      child.on("error", (error) => {
        finish(
          new Error(
            `MotionFrame WebSocket bridge smoke check failed: could not start bridge: ${error.message}`,
          ),
        );
      });

      child.on("exit", (code, signal) => {
        if (!settled) {
          finish(
            new Error(
              `MotionFrame WebSocket bridge smoke check failed: bridge exited before check completed (code ${code}, signal ${signal})${stderr ? `; stderr: ${stderr.trim()}` : ""}`,
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

try {
  await runSmokeCheck();
  console.log("MotionFrame WebSocket bridge smoke check passed.");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

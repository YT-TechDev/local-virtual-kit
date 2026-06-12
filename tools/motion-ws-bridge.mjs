#!/usr/bin/env node
import crypto from "node:crypto";
import net from "node:net";
import readline from "node:readline";
// Import the source JS validator so this development bridge can run directly with
// `node tools/motion-ws-bridge.mjs` before @lvk/motion-protocol/dist exists.
import { parseNativeMotionFrameJson } from "../packages/motion-protocol/src/motion-frame-validation.js";

const HOST = "127.0.0.1";
const PORT = 45731;
const PATH = "/motion";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const clients = new Set();
let latestFrameText = null;
let latestTimestampMs = -Infinity;

const parseMotionFrameLine = (line) => {
  if (line.trim() === "") {
    return null;
  }

  return parseNativeMotionFrameJson(line);
};

const createWebSocketAccept = (key) => {
  return crypto.createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
};

const parseHttpRequest = (data) => {
  const request = data.toString("utf8");
  const headerEnd = request.indexOf("\r\n\r\n");

  if (headerEnd === -1) {
    return null;
  }

  const lines = request.slice(0, headerEnd).split("\r\n");
  const [method, path] = lines[0].split(" ");
  const headers = new Map();

  for (const line of lines.slice(1)) {
    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    headers.set(
      line.slice(0, separatorIndex).trim().toLowerCase(),
      line.slice(separatorIndex + 1).trim(),
    );
  }

  return { method, path, headers };
};

const writeHttpResponse = (socket, status, body) => {
  socket.end(
    `HTTP/1.1 ${status}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "\r\n" +
      body,
  );
};

const encodeTextFrame = (message) => {
  const payload = Buffer.from(message, "utf8");
  const length = payload.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }

  if (length <= 0xffff) {
    const header = Buffer.allocUnsafe(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.allocUnsafe(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
};

const closeClient = (socket) => {
  clients.delete(socket);
  socket.destroy();
};

const sendToClient = (socket, message) => {
  if (socket.destroyed) {
    clients.delete(socket);
    return;
  }

  socket.write(encodeTextFrame(message), (error) => {
    if (error) {
      closeClient(socket);
    }
  });
};

const broadcast = (message) => {
  for (const client of clients) {
    sendToClient(client, message);
  }
};

const acceptClient = (socket, key) => {
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${createWebSocketAccept(key)}\r\n` +
      "\r\n",
  );

  clients.add(socket);
  console.error(`[motion-ws-bridge] client connected (${clients.size})`);

  socket.on("data", () => {
    closeClient(socket);
  });
  socket.on("close", () => {
    clients.delete(socket);
    console.error(`[motion-ws-bridge] client disconnected (${clients.size})`);
  });
  socket.on("error", () => closeClient(socket));

  if (latestFrameText !== null) {
    sendToClient(socket, latestFrameText);
  }
};

const server = net.createServer((socket) => {
  socket.once("data", (data) => {
    const request = parseHttpRequest(data);

    if (request === null) {
      writeHttpResponse(socket, "400 Bad Request", "Bad Request\n");
      return;
    }

    const upgradeHeader = request.headers.get("upgrade")?.toLowerCase();
    const connectionHeader =
      request.headers.get("connection")?.toLowerCase() ?? "";
    const websocketKey = request.headers.get("sec-websocket-key");

    if (request.method !== "GET" || request.path !== PATH) {
      writeHttpResponse(socket, "404 Not Found", "Not Found\n");
      return;
    }

    if (
      upgradeHeader !== "websocket" ||
      !connectionHeader.includes("upgrade") ||
      !websocketKey
    ) {
      writeHttpResponse(socket, "426 Upgrade Required", "Upgrade Required\n");
      return;
    }

    acceptClient(socket, websocketKey);
  });
});

server.on("error", (error) => {
  console.error(`[motion-ws-bridge] server error: ${error.message}`);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.error(
    `[motion-ws-bridge] development server listening on ws://${HOST}:${PORT}${PATH}`,
  );
});

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

input.on("line", (line) => {
  const frame = parseMotionFrameLine(line);

  if (frame === null || frame.timestampMs <= latestTimestampMs) {
    return;
  }

  latestTimestampMs = frame.timestampMs;
  latestFrameText = JSON.stringify(frame);
  broadcast(latestFrameText);
});

input.on("close", () => {
  console.error(
    "[motion-ws-bridge] stdin ended; keeping server alive with the latest valid frame",
  );
});

process.on("SIGINT", () => {
  console.error("[motion-ws-bridge] shutting down");
  for (const client of clients) {
    client.end();
  }
  server.close(() => process.exit(0));
});

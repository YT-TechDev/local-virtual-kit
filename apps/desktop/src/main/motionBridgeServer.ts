import { createHash } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'

const HOST = '127.0.0.1'
const PORT = 45731
const PATH = '/motion'
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

let server: Server | null = null
const clients = new Set<Socket>()
let latestFrameText: string | null = null
let latestTimestampMs = -Infinity

function parseFrameLine(line: string): { timestampMs: number; text: string } | null {
  if (!line.trim()) return null
  try {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const ts = (parsed as Record<string, unknown>).timestampMs
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return null
    return { timestampMs: ts, text: JSON.stringify(parsed) }
  } catch {
    return null
  }
}

function createWsAccept(key: string): string {
  return createHash('sha1').update(`${key}${WS_GUID}`).digest('base64')
}

function encodeTextFrame(message: string): Buffer {
  const payload = Buffer.from(message, 'utf8')
  const len = payload.length
  if (len < 126) {
    return Buffer.concat([Buffer.from([0x81, len]), payload])
  }
  if (len <= 0xffff) {
    const hdr = Buffer.allocUnsafe(4)
    hdr[0] = 0x81
    hdr[1] = 126
    hdr.writeUInt16BE(len, 2)
    return Buffer.concat([hdr, payload])
  }
  const hdr = Buffer.allocUnsafe(10)
  hdr[0] = 0x81
  hdr[1] = 127
  hdr.writeBigUInt64BE(BigInt(len), 2)
  return Buffer.concat([hdr, payload])
}

function closeClient(socket: Socket): void {
  clients.delete(socket)
  socket.destroy()
}

function sendToClient(socket: Socket, message: string): void {
  if (socket.destroyed) {
    clients.delete(socket)
    return
  }
  socket.write(encodeTextFrame(message), (err) => {
    if (err) closeClient(socket)
  })
}

function broadcast(message: string): void {
  for (const client of clients) {
    sendToClient(client, message)
  }
}

function parseHttpRequest(
  data: Buffer
): { method: string; path: string; headers: Map<string, string> } | null {
  const text = data.toString('utf8')
  const end = text.indexOf('\r\n\r\n')
  if (end === -1) return null
  const lines = text.slice(0, end).split('\r\n')
  const parts = lines[0].split(' ')
  const headers = new Map<string, string>()
  for (const line of lines.slice(1)) {
    const sep = line.indexOf(':')
    if (sep !== -1) headers.set(line.slice(0, sep).trim().toLowerCase(), line.slice(sep + 1).trim())
  }
  return { method: parts[0], path: parts[1], headers }
}

function writeHttpError(socket: Socket, status: string, body: string): void {
  socket.end(
    `HTTP/1.1 ${status}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      '\r\n' +
      body
  )
}

function acceptWsClient(socket: Socket, key: string): void {
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${createWsAccept(key)}\r\n` +
      '\r\n'
  )
  clients.add(socket)
  socket.on('data', () => closeClient(socket))
  socket.on('close', () => clients.delete(socket))
  socket.on('error', () => closeClient(socket))
  if (latestFrameText !== null) {
    sendToClient(socket, latestFrameText)
  }
}

export function startMotionBridgeServer(onError?: (error: Error) => void): void {
  if (server !== null) return

  const newServer = createServer((socket) => {
    socket.once('data', (data) => {
      const req = parseHttpRequest(data)
      if (req === null) {
        writeHttpError(socket, '400 Bad Request', 'Bad Request\n')
        return
      }
      const upgrade = req.headers.get('upgrade')?.toLowerCase()
      const connection = req.headers.get('connection')?.toLowerCase() ?? ''
      const wsKey = req.headers.get('sec-websocket-key')
      if (req.method !== 'GET' || req.path !== PATH) {
        writeHttpError(socket, '404 Not Found', 'Not Found\n')
        return
      }
      if (!upgrade?.includes('websocket') || !connection.includes('upgrade') || !wsKey) {
        writeHttpError(socket, '426 Upgrade Required', 'Upgrade Required\n')
        return
      }
      acceptWsClient(socket, wsKey)
    })
  })

  newServer.on('error', (error) => {
    onError?.(error)
  })

  newServer.listen(PORT, HOST)
  server = newServer
  latestFrameText = null
  latestTimestampMs = -Infinity
}

export function stopMotionBridgeServer(): void {
  if (server === null) return
  for (const client of clients) {
    client.destroy()
  }
  clients.clear()
  server.close()
  server = null
  latestFrameText = null
  latestTimestampMs = -Infinity
}

export function publishMotionFrameLine(line: string): boolean {
  const parsed = parseFrameLine(line)
  if (parsed === null || parsed.timestampMs <= latestTimestampMs) return false
  latestTimestampMs = parsed.timestampMs
  latestFrameText = parsed.text
  broadcast(parsed.text)
  return true
}

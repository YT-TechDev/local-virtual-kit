import { useEffect, useRef, useState } from 'react'
import type { MotionFrame, TrackingStatus } from '@lvk/motion-protocol'

const NATIVE_MOTION_WS_URL = 'ws://127.0.0.1:45731/motion'
const RECONNECT_DELAY_MS = 1000

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value)
}

const isTrackingStatus = (value: unknown): value is TrackingStatus => {
  return value === 'not_started' || value === 'tracking' || value === 'lost'
}

const isVector2 = (value: unknown): value is { x: number; y: number } => {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
}

const isVector3 = (value: unknown): value is { x: number; y: number; z: number } => {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z)
}

const isEulerRotation = (value: unknown): value is { pitch: number; yaw: number; roll: number } => {
  return (
    isRecord(value) &&
    isFiniteNumber(value.pitch) &&
    isFiniteNumber(value.yaw) &&
    isFiniteNumber(value.roll)
  )
}

const isMotionFrame = (value: unknown): value is MotionFrame => {
  if (!isRecord(value)) {
    return false
  }

  if (value.schemaVersion !== 1 || value.source !== 'native' || !isFiniteNumber(value.timestampMs)) {
    return false
  }

  if (!isRecord(value.tracking) || !isTrackingStatus(value.tracking.status)) {
    return false
  }

  if (!isFiniteNumber(value.tracking.confidence)) {
    return false
  }

  if (!isRecord(value.face) || !isVector3(value.face.position) || !isEulerRotation(value.face.rotation)) {
    return false
  }

  if (!isRecord(value.eyes) || !isFiniteNumber(value.eyes.leftOpen) || !isFiniteNumber(value.eyes.rightOpen)) {
    return false
  }

  if (!isVector2(value.eyes.gaze)) {
    return false
  }

  if (!isRecord(value.mouth) || !isFiniteNumber(value.mouth.open) || !isFiniteNumber(value.mouth.smile)) {
    return false
  }

  return true
}

const parseMotionFrame = (data: unknown): MotionFrame | null => {
  if (typeof data !== 'string') {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(data)
    return isMotionFrame(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function useNativeMotionFrame(enabled: boolean): MotionFrame | null {
  const [latestFrame, setLatestFrame] = useState<MotionFrame | null>(null)
  const latestTimestampRef = useRef(-Infinity)

  useEffect(() => {
    latestTimestampRef.current = -Infinity

    let websocket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let resetFrameTimer: number | undefined
    let isUnmounted = false

    const clearReconnectTimer = () => {
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
    }

    const clearResetFrameTimer = () => {
      if (resetFrameTimer !== undefined) {
        window.clearTimeout(resetFrameTimer)
        resetFrameTimer = undefined
      }
    }

    const clearNativeFrame = () => {
      setLatestFrame(null)
    }

    resetFrameTimer = window.setTimeout(() => {
      resetFrameTimer = undefined

      if (!isUnmounted && latestTimestampRef.current === -Infinity) {
        clearNativeFrame()
      }
    }, 0)

    if (!enabled) {
      return () => {
        isUnmounted = true
        clearResetFrameTimer()
      }
    }

    const scheduleReconnect = () => {
      if (isUnmounted || reconnectTimer !== undefined) {
        return
      }

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined
        connect()
      }, RECONNECT_DELAY_MS)
    }

    const connect = () => {
      if (isUnmounted) {
        return
      }

      latestTimestampRef.current = -Infinity
      websocket = new WebSocket(NATIVE_MOTION_WS_URL)

      websocket.onmessage = (event: MessageEvent<unknown>) => {
        const frame = parseMotionFrame(event.data)

        if (frame === null) {
          clearNativeFrame()
          return
        }

        if (frame.timestampMs <= latestTimestampRef.current) {
          return
        }

        latestTimestampRef.current = frame.timestampMs
        setLatestFrame(frame)
      }

      websocket.onerror = () => {
        clearNativeFrame()
        websocket?.close()
      }

      websocket.onclose = () => {
        clearNativeFrame()
        scheduleReconnect()
      }
    }

    connect()

    return () => {
      isUnmounted = true
      clearReconnectTimer()
      clearResetFrameTimer()
      websocket?.close()
      websocket = null
    }
  }, [enabled])

  return latestFrame
}

/**
 * ClientBuffer - Backpressure handling for slow clients
 * 
 * Buffers events when a client can't consume them fast enough. When buffer fills,
 * drops oldest events (ring buffer behavior) to prevent memory exhaustion.
 * 
 * Emits 'backpressure' events when buffer starts filling for monitoring.
 * 
 * @example
 * ```typescript
 * const buffer = new ClientBuffer({ maxSize: 1000 });
 * 
 * buffer.on('backpressure', (stats) => {
 *   console.warn(`Client backpressure: ${stats.buffered}/${stats.maxSize} buffered, ${stats.dropped} dropped`);
 * });
 * 
 * // Enqueue event with send function
 * buffer.enqueue(event, (data) => ws.send(JSON.stringify(data)));
 * 
 * // Flush buffered events
 * await buffer.flush();
 * 
 * // Get metrics
 * const metrics = buffer.getMetrics();
 * ```
 */

import { EventEmitter } from "node:events";

export interface ClientBufferConfig {
  /** Maximum buffer size before dropping oldest events (default 1000) */
  maxSize?: number;
  /** Backpressure threshold as fraction of maxSize (default 0.5 = 50%) */
  backpressureThreshold?: number;
}

export interface BufferMetrics {
  /** Current number of buffered events */
  buffered: number;
  /** Total number of dropped events */
  dropped: number;
  /** Maximum buffer size */
  maxSize: number;
  /** Last flush latency in milliseconds */
  lastFlushLatencyMs: number;
}

interface BufferedEvent {
  data: any;
  send: (data: any) => Promise<void>;
}

/**
 * ClientBuffer handles backpressure for slow clients by buffering events
 * up to a maximum size, then dropping oldest events when full.
 * 
 * Emits 'backpressure' event when buffer utilization crosses threshold.
 */
export class ClientBuffer extends EventEmitter {
  private buffer: BufferedEvent[] = [];
  private _droppedCount = 0;
  private _maxSize: number;
  private _lastFlushLatencyMs = 0;
  private pendingFlush = false;
  private backpressureThreshold: number;

  constructor(config: ClientBufferConfig = {}) {
    super();
    this._maxSize = config.maxSize ?? 1000;
    const thresholdFraction = config.backpressureThreshold ?? 0.5;

    if (this._maxSize <= 0) {
      throw new Error("maxSize must be positive");
    }

    if (thresholdFraction <= 0 || thresholdFraction > 1) {
      throw new Error("backpressureThreshold must be between 0 and 1");
    }

    // Emit backpressure warning when buffer crosses threshold
    this.backpressureThreshold = Math.floor(this._maxSize * thresholdFraction);
  }

  /**
   * Maximum buffer size before dropping oldest events
   */
  get maxSize(): number {
    return this._maxSize;
  }

  /**
   * Current number of buffered events
   */
  get size(): number {
    return this.buffer.length;
  }

  /**
   * Total number of dropped events since buffer creation
   */
  get droppedCount(): number {
    return this._droppedCount;
  }

  /**
   * Enqueue an event to be sent. If buffer is full, drops oldest event.
   * 
   * @param data - Event data to send
   * @param send - Function to send the data (e.g., ws.send or controller.enqueue)
   */
  enqueue(data: any, send: (data: any) => Promise<void>): void {
    // If buffer is full, drop oldest
    if (this.buffer.length >= this._maxSize) {
      this.buffer.shift();
      this._droppedCount++;
    }

    this.buffer.push({ data, send });

    // Emit backpressure warning if buffer is filling
    if (this.buffer.length > this.backpressureThreshold) {
      this.emit("backpressure", this.getMetrics());
    }
  }

  /**
   * Flush all buffered events to the client.
   * Sends events in FIFO order.
   * 
   * @returns Promise that resolves when all events are sent
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    // Prevent duplicate flushes
    if (this.pendingFlush) {
      return;
    }

    this.pendingFlush = true;
    const startTime = Date.now();

    try {
      // Send all buffered events in order
      while (this.buffer.length > 0) {
        const event = this.buffer.shift();
        if (event) {
          await event.send(event.data);
        }
      }

      this._lastFlushLatencyMs = Date.now() - startTime;
    } finally {
      this.pendingFlush = false;
    }
  }

  /**
   * Get current buffer metrics for monitoring
   */
  getMetrics(): BufferMetrics {
    return {
      buffered: this.buffer.length,
      dropped: this._droppedCount,
      maxSize: this._maxSize,
      lastFlushLatencyMs: this._lastFlushLatencyMs,
    };
  }

  /**
   * Check if buffer is healthy (not under backpressure)
   */
  isHealthy(): boolean {
    return this.buffer.length <= this.backpressureThreshold;
  }

  /**
   * Reset buffer metrics (useful for testing or when reconnecting)
   */
  reset(): void {
    this.buffer = [];
    this._droppedCount = 0;
    this._lastFlushLatencyMs = 0;
  }
}

# ClientBuffer Integration Guide

## Overview

`ClientBuffer` provides backpressure handling for slow clients by buffering events when they can't consume fast enough. When the buffer fills, it drops oldest events (ring buffer) to prevent memory exhaustion.

## Integration into DurableStreamServer

### WebSocket Integration

```typescript
import { ClientBuffer } from "./client-buffer.js";

// In WebSocket open handler
const clientBuffer = new ClientBuffer({ maxSize: 1000 });

clientBuffer.on('backpressure', (stats) => {
  console.warn(
    `[WS] Client ${clientId} backpressure: ${stats.buffered}/${stats.maxSize} buffered, ${stats.dropped} dropped`
  );
});

// Store buffer in ws.data
ws.data.clientBuffer = clientBuffer;

// In subscribe handler, wrap the send
const unsubscribe = adapter.subscribe(
  (event: StreamEvent) => {
    if (event.offset > offset) {
      // Enqueue instead of direct send
      ws.data.clientBuffer.enqueue(
        { type: "event", ...event },
        async (data) => {
          try {
            ws.send(JSON.stringify(data));
          } catch (error) {
            console.error(`[WS] Send failed: ${error}`);
            throw error;
          }
        }
      );
      
      // Flush periodically or on idle
      ws.data.clientBuffer.flush().catch(err => {
        console.error(`[WS] Flush failed: ${err}`);
      });
    }
  },
  offset
);
```

### SSE Integration

```typescript
// In ReadableStream start
const clientBuffer = new ClientBuffer({ maxSize: 1000 });

clientBuffer.on('backpressure', (stats) => {
  console.warn(
    `[SSE] Client ${clientId} backpressure: ${stats.buffered}/${stats.maxSize}`
  );
});

const unsubscribe = adapter.subscribe(
  (event: StreamEvent) => {
    if (event.offset > offset) {
      // Enqueue instead of direct enqueue
      clientBuffer.enqueue(
        event,
        async (data) => {
          const sse = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(sse));
        }
      );
      
      // Flush on next tick
      setImmediate(() => {
        clientBuffer.flush().catch(err => {
          console.error(`[SSE] Flush failed: ${err}`);
        });
      });
    }
  },
  offset
);
```

## Flush Strategies

### 1. Periodic Flush (Recommended for WebSocket)

```typescript
// Flush every 100ms
const flushInterval = setInterval(async () => {
  try {
    await clientBuffer.flush();
  } catch (error) {
    console.error('Flush failed:', error);
  }
}, 100);

// Clean up on disconnect
ws.data.flushInterval = flushInterval;
```

### 2. Event-Driven Flush (SSE)

```typescript
// Flush after each event enqueue
clientBuffer.enqueue(event, send);
setImmediate(() => clientBuffer.flush());
```

### 3. Batch Flush

```typescript
// Accumulate N events, then flush
let eventCount = 0;
const BATCH_SIZE = 10;

clientBuffer.enqueue(event, send);
eventCount++;

if (eventCount >= BATCH_SIZE) {
  await clientBuffer.flush();
  eventCount = 0;
}
```

## Health Monitoring Endpoint

```typescript
// Add to fetch handler
if (url.pathname === "/health/clients") {
  const clientStats = Array.from(wsClients).map(ws => {
    const buffer = ws.data.clientBuffer;
    return {
      clientId: ws.data.clientId,
      healthy: buffer.isHealthy(),
      metrics: buffer.getMetrics(),
    };
  });
  
  return new Response(JSON.stringify({ clients: clientStats }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
```

## Cleanup on Disconnect

```typescript
// WebSocket close handler
close(ws) {
  // Flush any pending events before disconnect
  if (ws.data.clientBuffer) {
    ws.data.clientBuffer.flush().finally(() => {
      if (ws.data.flushInterval) {
        clearInterval(ws.data.flushInterval);
      }
      ws.data.clientBuffer.reset();
    });
  }
  
  wsClients.delete(ws);
  // ... rest of cleanup
}
```

## Configuration Examples

### Low-Latency (Real-time Dashboard)

```typescript
const buffer = new ClientBuffer({
  maxSize: 100,              // Small buffer
  backpressureThreshold: 0.3 // Warn early (30%)
});

// Flush aggressively
setInterval(() => buffer.flush(), 50); // Every 50ms
```

### High-Throughput (Analytics)

```typescript
const buffer = new ClientBuffer({
  maxSize: 5000,             // Large buffer
  backpressureThreshold: 0.8 // Warn late (80%)
});

// Flush in batches
let count = 0;
adapter.subscribe((event) => {
  buffer.enqueue(event, send);
  if (++count % 100 === 0) {
    buffer.flush();
  }
});
```

### Mobile/Unstable Network

```typescript
const buffer = new ClientBuffer({
  maxSize: 2000,             // Medium buffer for recovery
  backpressureThreshold: 0.5
});

// Adaptive flush based on buffer health
function adaptiveFlush() {
  if (!buffer.isHealthy()) {
    // Slow down event subscriptions
    pauseSubscription();
  }
  buffer.flush().then(() => {
    if (buffer.isHealthy()) {
      resumeSubscription();
    }
  });
}

setInterval(adaptiveFlush, 200);
```

## Testing

```typescript
import { describe, it, expect } from "bun:test";
import { ClientBuffer } from "./client-buffer.js";

describe("ClientBuffer integration", () => {
  it("handles slow client scenario", async () => {
    const buffer = new ClientBuffer({ maxSize: 10 });
    const sent: any[] = [];
    
    // Simulate slow send (100ms each)
    const slowSend = (data: any) => {
      return new Promise<void>(resolve => {
        setTimeout(() => {
          sent.push(data);
          resolve();
        }, 100);
      });
    };
    
    // Rapid event stream
    for (let i = 0; i < 20; i++) {
      buffer.enqueue({ id: i }, slowSend);
    }
    
    // Buffer should be full, oldest dropped
    expect(buffer.size).toBe(10);
    expect(buffer.droppedCount).toBe(10);
    
    // Flush clears buffer
    await buffer.flush();
    expect(buffer.size).toBe(0);
    
    // Only newest 10 events sent
    expect(sent.length).toBe(10);
    expect(sent[0].id).toBe(10); // Oldest kept was event 10
  });
});
```

## Performance Considerations

1. **Buffer Size**: Balance memory vs recovery window
   - Too small: Drop events during temporary slowdowns
   - Too large: Memory exhaustion on persistent slow clients

2. **Flush Frequency**: Balance latency vs throughput
   - Frequent: Lower latency, more overhead
   - Batched: Higher throughput, increased latency

3. **Backpressure Threshold**: Balance alerting vs noise
   - Low (30%): Early warning, more alerts
   - High (80%): Late warning, fewer false positives

4. **Dropped Events**: Not a bug, it's overflow protection
   - Monitor `droppedCount` metric
   - Log client IDs with high drop rates
   - Consider disconnecting persistently slow clients

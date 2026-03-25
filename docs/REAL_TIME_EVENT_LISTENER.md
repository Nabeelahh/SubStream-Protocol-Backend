# Real-Time Event Listener & WebSocket Integration

## Overview

This document describes the real-time event listening system that detects Soroban contract events and instantly updates user authorization status to prevent "sync lag" when users start or stop streams.

## Architecture

```
┌─────────────────┐
│  Soroban Smart  │
│     Contract    │
└────────┬────────┘
         │
         │ Blockchain Events
         │ (StreamCreated,
         │  StreamStopped, etc.)
         ▼
┌─────────────────────────────────────┐
│   Soroban Event Listener Service    │
│  - Polls Stellar RPC for events    │
│  - Detects contract interactions   │
│  - Updates database in real-time   │
└────────┬────────────────────────────┘
         │
         │ Authorization Updates
         │
         ├──────────────────┐
         │                  │
         ▼                  ▼
┌─────────────────┐  ┌──────────────────┐
│ Local Database  │  │  WebSocket Server │
│ - user_         │  │  - Broadcasts to  │
│   subscriptions │  │    connected      │
│ - is_authorized │  │    clients        │
│   flag          │  │                   │
└─────────────────┘  └──────────────────┘
                            │
                            │ Real-time Notifications
                            ▼
                     ┌─────────────────┐
                     │  Frontend Apps  │
                     │  (React/Vue)    │
                     └─────────────────┘
```

## Components

### 1. Soroban Event Listener (`src/services/sorobanEventListener.js`)

**Purpose**: Monitors the Soroban blockchain for contract events and updates user authorization in real-time.

**Key Features**:
- Polls Stellar RPC every 5 seconds (configurable via `SOROBAN_POLLING_INTERVAL`)
- Detects `StreamCreated`, `StreamStopped`, `SubscriptionActivated`, and `SubscriptionDeactivated` events
- Automatically updates the `user_subscriptions` table with `is_authorized` flag
- Emits events via EventEmitter for WebSocket broadcast
- Supports manual force-sync for immediate verification after payments

**Event Detection**:
- Uses `server.getEvents()` RPC method with contract filters
- Falls back to transaction scanning if `getEvents` is unavailable
- Extracts event data from multiple possible formats for compatibility

### 2. WebSocket Server (`src/services/webSocketServer.js`)

**Purpose**: Provides real-time bidirectional communication with connected clients.

**Key Features**:
- Built on Socket.IO for automatic reconnection and fallback support
- Room-based subscription model (users join personal rooms)
- Broadcasts authorization updates instantly to affected users
- Supports manual subscription status checks via WebSocket messages

**Client Rooms**:
- Personal room: `user:{walletAddress}` - for user-specific notifications
- Creator room: `creator:{creatorAddress}` - for creator analytics
- Content room: `content:{contentId}` - for content-specific updates

**WebSocket Events**:

**Client → Server**:
```javascript
// Subscribe to rooms
socket.emit('subscribe', { rooms: ['user:0xABC...', 'content:video123'] });

// Unsubscribe from rooms
socket.emit('unsubscribe', { rooms: ['user:0xABC...'] });

// Check subscription status
socket.emit('checkSubscription', {
  userAddress: '0xABC...',
  creatorAddress: '0xDEF...',
  contentId: 'video123'
}, callback);
```

**Server → Client**:
```javascript
// Stream started
{ type: 'STREAM_STARTED', data: { ... } }

// Stream ended
{ type: 'STREAM_ENDED', data: { ... } }

// Subscription activated
{ type: 'SUBSCRIPTION_ACTIVATED', data: { isAuthorized: true, message: '...' } }

// Subscription deactivated
{ type: 'SUBSCRIPTION_DEACTIVATED', data: { isAuthorized: false, message: '...' } }

// Authorization updated
{ type: 'AUTHORIZATION_UPDATED', data: { userAddress, creatorAddress, contentId, isAuthorized } }
```

### 3. Database Schema (`src/db/appDatabase.js`)

**New Table**: `user_subscriptions`

```sql
CREATE TABLE user_subscriptions (
  id TEXT PRIMARY KEY,
  user_address TEXT NOT NULL,
  creator_address TEXT NOT NULL,
  content_id TEXT NOT NULL,
  is_authorized INTEGER NOT NULL DEFAULT 0,
  subscription_type TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_synced_block INTEGER,
  metadata_json TEXT
);
```

**Indexes**:
- `idx_user_subscriptions_unique` - Unique constraint on (user_address, creator_address, content_id)
- `idx_user_subscriptions_user` - Fast lookup by user
- `idx_user_subscriptions_creator` - Fast lookup by creator
- `idx_user_subscriptions_authorized` - Filter by authorization status

**Database Methods**:
- `upsertUserSubscription(subscription)` - Create or update subscription
- `getUserSubscription(userAddress, creatorAddress, contentId)` - Get subscription details
- `updateUserAuthorization(userAddress, creatorAddress, contentId, isAuthorized)` - Update auth flag
- `getActiveSubscriptionsForUser(userAddress)` - Get all active subscriptions for a user
- `getSubscribersForCreator(creatorAddress, contentId?)` - Get all subscribers for a creator

## API Endpoints

### 1. Manual Subscription Sync

**POST** `/api/subscription/sync`

Force sync a subscription with the blockchain immediately. Useful after a payment to ensure instant access.

**Request Body**:
```json
{
  "userAddress": "0xABC...",
  "creatorAddress": "0xDEF...",
  "contentId": "video123"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "isAuthorized": true,
    "subscription": {
      "userAddress": "0xABC...",
      "creatorAddress": "0xDEF...",
      "contentId": "video123",
      "isAuthorized": true,
      "subscriptionType": "stream",
      "startedAt": "2026-03-25T10:30:00.000Z",
      "updatedAt": "2026-03-25T10:30:05.000Z"
    },
    "syncedAt": "2026-03-25T10:30:05.000Z"
  }
}
```

### 2. WebSocket Stats

**GET** `/api/websocket/stats`

Get statistics about connected WebSocket clients.

**Response**:
```json
{
  "success": true,
  "data": {
    "connectedClients": 42,
    "ioConnected": 42,
    "rooms": ["user:0xABC...", "creator:0xDEF...", "content:video123"]
  }
}
```

## Frontend Integration Example

### React Hook for Real-Time Subscription

```javascript
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_WEBSOCKET_URL || 'http://localhost:3000';

export function useSubscription(userAddress, creatorAddress, contentId) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Initialize WebSocket connection
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      console.log('WebSocket connected');
      
      // Join personal room for notifications
      newSocket.emit('subscribe', {
        rooms: [`user:${userAddress}`],
      });

      // Check initial subscription status
      newSocket.emit('checkSubscription', {
        userAddress,
        creatorAddress,
        contentId,
      }, (response) => {
        if (response.success) {
          setIsAuthorized(response.data.isAuthorized);
        }
        setLoading(false);
      });
    });

    // Listen for authorization updates
    newSocket.on('event', (payload) => {
      switch (payload.type) {
        case 'AUTHORIZATION_UPDATED':
          if (
            payload.data.userAddress === userAddress &&
            payload.data.creatorAddress === creatorAddress &&
            payload.data.contentId === contentId
          ) {
            setIsAuthorized(payload.data.isAuthorized);
          }
          break;
        case 'SUBSCRIPTION_ACTIVATED':
          if (payload.data.userAddress === userAddress) {
            setIsAuthorized(true);
          }
          break;
        case 'SUBSCRIPTION_DEACTIVATED':
          if (payload.data.userAddress === userAddress) {
            setIsAuthorized(false);
          }
          break;
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [userAddress, creatorAddress, contentId]);

  return { isAuthorized, loading, socket };
}
```

### Usage in Component

```javascript
function VideoPlayer({ videoId, userAddress, creatorAddress }) {
  const { isAuthorized, loading } = useSubscription(
    userAddress,
    creatorAddress,
    videoId
  );

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!isAuthorized) {
    return (
      <div>
        <h2>Content Locked</h2>
        <p>Subscribe to watch this video</p>
        <button onClick={handleSubscribe}>Subscribe Now</button>
      </div>
    );
  }

  return (
    <div>
      <video controls>
        <source src={`/api/cdn/stream/${videoId}`} />
      </video>
    </div>
  );
}
```

## Configuration

### Environment Variables

```bash
# Soroban Event Listener
ENABLE_SOROBAN_EVENT_LISTENER=true        # Enable/disable event listener
SOROBAN_POLLING_INTERVAL=5000             # Polling interval in milliseconds

# WebSocket Configuration
WEBSOCKET_CORS_ORIGIN=*                   # CORS origin for WebSocket connections

# Existing Soroban Configuration
SOROBAN_RPC_URL=...                       # Stellar RPC endpoint
SOROBAN_CONTRACT_ID=...                   # Contract address
SOROBAN_SOURCE_SECRET=...                 # Source wallet secret
```

### Customization Options

**Polling Interval**: Adjust based on your needs
- Faster (1-2s): More responsive, higher RPC load
- Slower (10-30s): Less responsive, lower RPC load
- Recommended: 5s (good balance)

**Event Filtering**: Modify `sorobanEventListener.js` to filter specific event types:

```javascript
async processEvent(event) {
  const eventType = this.extractEventType(event);
  
  // Only process specific events
  if (!['StreamCreated', 'StreamStopped'].includes(eventType)) {
    return;
  }
  
  // ... rest of processing
}
```

## Testing

### Manual Testing

1. **Start the backend**:
   ```bash
   npm install
   npm start
   ```

2. **Connect a WebSocket client** (e.g., using Socket.IO client in browser):
   ```javascript
   const socket = io('http://localhost:3000');
   
   socket.on('connect', () => {
     socket.emit('subscribe', {
       rooms: ['user:YOUR_WALLET_ADDRESS']
     });
   });
   
   socket.on('event', (data) => {
     console.log('Received event:', data);
   });
   ```

3. **Trigger a contract event** (via your frontend or test script)

4. **Verify**:
   - Check console logs for event detection
   - Verify database `is_authorized` flag updated
   - Confirm WebSocket received notification

### Automated Testing

Create a test file `sorobanEventListener.test.js`:

```javascript
const { SorobanEventListener } = require('./src/services/sorobanEventListener');
const { AppDatabase } = require('./src/db/appDatabase');
const { loadConfig } = require('./src/config');

describe('SorobanEventListener', () => {
  let eventListener;
  let database;
  let config;

  beforeEach(() => {
    config = loadConfig();
    database = new AppDatabase(':memory:');
    eventListener = new SorobanEventListener(config, database);
  });

  afterEach(() => {
    eventListener.stop();
  });

  test('should detect subscription activation', async () => {
    return new Promise((resolve) => {
      eventListener.on('subscriptionUpdated', (subscription) => {
        expect(subscription.isAuthorized).toBe(true);
        resolve();
      });

      // Simulate event
      eventListener.updateUserAuthorization(
        'USER_ADDRESS',
        'CREATOR_ADDRESS',
        'CONTENT_ID',
        true,
        { eventType: 'TestEvent' }
      );
    });
  });

  test('should force sync subscription', async () => {
    const result = await eventListener.forceSyncSubscription(
      'USER_ADDRESS',
      'CREATOR_ADDRESS',
      'CONTENT_ID'
    );

    expect(typeof result).toBe('boolean');
  });
});
```

## Production Deployment

### Scaling Considerations

1. **Multiple Instances**: Use Redis adapter for Socket.IO to share state across instances
   ```javascript
   const { createAdapter } = require('@socket.io/redis-adapter');
   const redis = require('redis');

   const pubClient = redis.createClient({ url: process.env.REDIS_URL });
   const subClient = pubClient.duplicate();

   io.adapter(createAdapter(pubClient, subClient));
   ```

2. **Database**: Switch from SQLite to PostgreSQL for concurrent writes
   ```javascript
   // Use a production-ready database driver
   const { Pool } = require('pg');
   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
   ```

3. **RPC Rate Limiting**: Implement request queuing if hitting rate limits
   ```javascript
   class RateLimitedSorobanEventListener extends SorobanEventListener {
     constructor(config, database) {
       super(config, database);
       this.requestQueue = [];
       this.processing = false;
     }

     async getContractEvents(startLedger, endLedger) {
       return new Promise((resolve, reject) => {
         this.requestQueue.push({ startLedger, endLedger, resolve, reject });
         this.processQueue();
       });
     }

     async processQueue() {
       if (this.processing || this.requestQueue.length === 0) return;

       this.processing = true;
       const request = this.requestQueue.shift();

       try {
         const result = await super.getContractEvents(
           request.startLedger,
           request.endLedger
         );
         request.resolve(result);
       } catch (error) {
         request.reject(error);
       } finally {
         this.processing = false;
         setTimeout(() => this.processQueue(), 1000); // Rate limit delay
       }
     }
   }
   ```

### Monitoring

Add health check endpoints:

```javascript
app.get('/health', (req, res) => {
  const stats = webSocketServer.getStats();
  const isHealthy = stats.connectedClients > 0 && eventListener.isRunning;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    services: {
      websocket: stats,
      eventListener: {
        running: eventListener.isRunning,
        lastProcessedLedger: eventListener.lastProcessedLedger,
      },
    },
  });
});
```

## Troubleshooting

### Common Issues

**Issue**: Events not being detected
- **Solution**: Check `SOROBAN_RPC_URL` is accessible and supports `getEvents` method
- **Alternative**: The listener will fall back to transaction scanning automatically

**Issue**: WebSocket connections dropping
- **Solution**: Increase `pingTimeout` and `pingInterval` in WebSocket server config
- **Check**: Network stability and firewall rules

**Issue**: Database lock errors (SQLite)
- **Solution**: Switch to PostgreSQL or reduce polling frequency
- **Temporary**: Set `SOROBAN_POLLING_INTERVAL=10000` (10 seconds)

**Issue**: Users still seeing "Locked" screen after payment
- **Solution**: Call `/api/subscription/sync` endpoint immediately after on-chain payment
- **Better**: Implement optimistic UI update on frontend while waiting for blockchain confirmation

## Performance Optimization

1. **Batch Event Processing**: Process multiple ledgers in one RPC call
2. **Database Indexing**: Already configured for optimal queries
3. **WebSocket Compression**: Enable per-message compression in Socket.IO
   ```javascript
   new Server(httpServer, {
     perMessageDeflate: {
       threshold: 1024,
       zlibDeflateOptions: { chunkSize: 16 * 1024 },
     },
   });
   ```

## Security Considerations

1. **Authentication**: Validate user addresses before allowing room joins
2. **Rate Limiting**: Implement connection rate limiting for WebSocket endpoints
3. **CORS**: Restrict `WEBSOCKET_CORS_ORIGIN` to your domain in production
4. **Input Validation**: Sanitize all WebSocket message payloads

## Future Enhancements

- [ ] Support for Mercury streaming API for instant event delivery
- [ ] Custom Horizon worker implementation for specific event filtering
- [ ] Event replay capability for debugging
- [ ] Analytics dashboard for subscription metrics
- [ ] Webhook notifications for server-to-server communication

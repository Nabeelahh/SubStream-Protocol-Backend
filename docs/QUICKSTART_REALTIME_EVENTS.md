# Quick Start Guide: Real-Time Event Listener

## Overview

This guide will help you quickly set up and test the real-time event listener system that prevents "sync lag" when users subscribe to streams.

## Prerequisites

- Node.js v16+ installed
- npm or yarn package manager
- Basic understanding of WebSockets and blockchain events

## Installation

### 1. Install Dependencies

```bash
npm install
```

This installs all required dependencies including `socket.io` for WebSocket functionality.

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and configure these essential variables:

```bash
# Enable the event listener (default: true)
ENABLE_SOROBAN_EVENT_LISTENER=true

# How often to check for new events (in milliseconds)
SOROBAN_POLLING_INTERVAL=5000

# Your Soroban RPC endpoint
SOROBAN_RPC_URL=https://soroban-rpc.mainnet.stellar.gateway.fm

# Your contract address
SOROBAN_CONTRACT_ID=YOUR_CONTRACT_ID_HERE

# WebSocket CORS (set to your frontend domain in production)
WEBSOCKET_CORS_ORIGIN=http://localhost:3001
```

### 3. Start the Server

```bash
npm start
```

You should see output like:

```
SubStream API running on port 3000
WebSocket server ready for real-time events
Soroban event listener: enabled
```

## Testing the System

### Option 1: Run Automated Tests

Test the event listener functionality without connecting to actual blockchain:

```bash
npm run test:event-listener
```

Expected output:
```
============================================================
Soroban Event Listener Test Suite
============================================================

This test simulates contract events to verify the
real-time authorization system.

📡 Setting up event listeners...

Test 1: Simulating StreamCreated event...
------------------------------------------------------------
✓ Event Emitted: subscriptionUpdated
  User: TEST_USER_WALLET_ADDRESS
  Creator: TEST_CREATOR_WALLET_ADDRESS
  Content: test_video_001
  Authorized: YES ✓

✓ Test 1 PASSED: Database updated correctly

... (more tests)

============================================================
Test Summary
============================================================
Total Tests: 5
Passed: 5 ✓
Failed: 0
============================================================
```

### Option 2: Interactive WebSocket Client

Run the example WebSocket client to see real-time updates:

```bash
# Set your wallet addresses (optional)
export WALLET_ADDRESS="your_wallet_address"
export CREATOR_ADDRESS="creator_wallet_address"
export CONTENT_ID="video_id"

# Run the client
npm run example:websocket-client
```

### Option 3: Manual Testing with Postman/cURL

#### 1. Check WebSocket Stats

```bash
curl http://localhost:3000/api/websocket/stats
```

Response:
```json
{
  "success": true,
  "data": {
    "connectedClients": 0,
    "ioConnected": 0,
    "rooms": []
  }
}
```

#### 2. Manually Sync Subscription

After a user pays on-chain, force an immediate sync:

```bash
curl -X POST http://localhost:3000/api/subscription/sync \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "USER_WALLET",
    "creatorAddress": "CREATOR_WALLET",
    "contentId": "VIDEO_ID"
  }'
```

## Integration with Frontend

### React Example

Install Socket.IO client:

```bash
npm install socket.io-client
```

Create a custom hook:

```javascript
// hooks/useSubscription.js
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export function useSubscription(userAddress, creatorAddress, contentId) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const socket = io('http://localhost:3000');

    socket.on('connect', () => {
      // Join personal room
      socket.emit('subscribe', { rooms: [`user:${userAddress}`] });

      // Check initial status
      socket.emit('checkSubscription', {
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

    // Listen for updates
    socket.on('event', (payload) => {
      if (payload.type === 'AUTHORIZATION_UPDATED') {
        setIsAuthorized(payload.data.isAuthorized);
      }
    });

    return () => socket.close();
  }, [userAddress, creatorAddress, contentId]);

  return { isAuthorized, loading };
}
```

Use in your component:

```javascript
function VideoPlayer({ video }) {
  const { isAuthorized, loading } = useSubscription(
    currentUser.address,
    video.creatorAddress,
    video.id
  );

  if (loading) return <div>Loading...</div>;
  
  if (!isAuthorized) {
    return (
      <div>
        <h2>Content Locked</h2>
        <button onClick={handleSubscribe}>Subscribe Now</button>
      </div>
    );
  }

  return <video controls src={video.url} />;
}
```

## How It Works

### Flow Diagram

```
User Pays on Chain
       ↓
Soroban Contract Emits Event
       ↓
Event Listener Detects (within 5 seconds)
       ↓
Updates Database (is_authorized = true)
       ↓
Broadcasts via WebSocket
       ↓
Frontend Receives Update
       ↓
UI Instantly Unlocks Content ✓
```

### Key Components

1. **Soroban Event Listener** (`src/services/sorobanEventListener.js`)
   - Polls blockchain every 5 seconds
   - Detects `StreamCreated`, `StreamStopped` events
   - Updates database instantly

2. **WebSocket Server** (`src/services/webSocketServer.js`)
   - Maintains connections with clients
   - Broadcasts authorization updates
   - Supports manual status checks

3. **Database** (`src/db/appDatabase.js`)
   - Stores `user_subscriptions` table
   - Tracks `is_authorized` flag
   - Provides fast lookup methods

## Troubleshooting

### Issue: "Cannot connect to WebSocket server"

**Solution**: Make sure the server is running and port 3000 is not blocked.

```bash
# Check if server is running
curl http://localhost:3000/

# Should respond with project info
```

### Issue: "Events not being detected"

**Solution**: Verify your Soroban RPC URL is correct and accessible.

```bash
# Test RPC connection
curl -X POST YOUR_SOROBAN_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getLatestLedger"
  }'
```

### Issue: "Database is locked"

**Solution**: SQLite can have locking issues with concurrent access. For production, switch to PostgreSQL or increase polling interval:

```bash
# In .env
SOROBAN_POLLING_INTERVAL=10000  # 10 seconds instead of 5
```

### Issue: "Users still see locked content after payment"

**Immediate Fix**: Call the sync endpoint right after payment:

```javascript
// After on-chain payment succeeds
fetch('/api/subscription/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userAddress: user.address,
    creatorAddress: video.creatorAddress,
    contentId: video.id,
  }),
}).then(res => res.json())
  .then(data => {
    if (data.success && data.isAuthorized) {
      // Unlock content immediately
      setAccessGranted(true);
    }
  });
```

**Better Solution**: Implement optimistic UI update on payment confirmation, then let the event listener handle any edge cases.

## Next Steps

1. **Customize Event Filtering**: Modify which events trigger updates in `sorobanEventListener.js`

2. **Add Authentication**: Validate user addresses before allowing WebSocket room joins

3. **Scale to Production**: 
   - Switch to PostgreSQL database
   - Add Redis adapter for WebSocket clustering
   - Deploy with proper SSL/TLS

4. **Monitor Performance**: Use the `/health` endpoint to track system status

## Additional Resources

- Full documentation: `docs/REAL_TIME_EVENT_LISTENER.md`
- Example client: `examples/websocket-client-example.js`
- Test suite: `examples/test-event-listener.js`

## Getting Help

If you encounter issues:

1. Check the logs for error messages
2. Verify environment variables are set correctly
3. Run the automated tests to isolate the problem
4. Review the full documentation for advanced configuration

---

**You're all set!** 🎉 The real-time event listener is now active and will automatically detect contract events and update user authorization instantly.

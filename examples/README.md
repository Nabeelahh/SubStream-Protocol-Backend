# Examples Directory

This directory contains working examples and test scripts for the real-time event listener system.

## Available Examples

### 1. Test Event Listener (`test-event-listener.js`)

Automated test suite that simulates contract events and verifies the authorization system works correctly.

**Purpose**: Verify the event listener functionality without connecting to actual blockchain

**Run**:
```bash
npm run test:event-listener
```

**What it tests**:
- StreamCreated event simulation
- StreamStopped event simulation
- Database updates
- Force sync functionality
- Subscription queries

**Expected Output**: All 5 tests should pass ✓

---

### 2. WebSocket Client Example (`websocket-client-example.js`)

Interactive demonstration of how to connect to the WebSocket server and receive real-time events.

**Purpose**: Show how frontend applications can integrate with the WebSocket server

**Run**:
```bash
npm run example:websocket-client
```

**Optional Configuration**:
```bash
export WALLET_ADDRESS="your_wallet_address"
export CREATOR_ADDRESS="creator_wallet_address"
export CONTENT_ID="video_id"
```

**Features Demonstrated**:
- Connecting to WebSocket server
- Subscribing to personal notification rooms
- Receiving real-time events
- Checking subscription status
- Handling disconnections and reconnections

**Use Case**: Use this as a reference when building your frontend integration

---

## How to Use These Examples

### For Testing

1. **Start the backend server**:
   ```bash
   npm start
   ```

2. **Run the test suite** (in another terminal):
   ```bash
   npm run test:event-listener
   ```

3. **Verify all tests pass** ✓

### For Learning

1. **Read the code** - Both examples are well-commented
2. **Run the WebSocket client** to see real-time events in action
3. **Modify the code** to test different scenarios
4. **Use as templates** for your production code

### For Debugging

If you're experiencing issues:

1. Run `test-event-listener.js` to verify core functionality
2. Run `websocket-client-example.js` to test WebSocket connectivity
3. Check the console logs for error messages
4. Compare your implementation with the examples

## Example Output

### Test Event Listener

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

### WebSocket Client

```
============================================================
SubStream WebSocket Client Example
============================================================

Configuration:
  Wallet Address: EXAMPLE_USER_ADDRESS
  Creator Address: EXAMPLE_CREATOR_ADDRESS
  Content ID: example_video_123
  Server URL: http://localhost:3000
============================================================

Starting client...

Connecting to http://localhost:3000...
✓ Connected to WebSocket server
  Socket ID: abc123xyz

📡 Checking subscription status...
✓ Subscription Status:
  Authorized: YES ✓
  Checked at: 3/25/2026, 10:30:00 AM

📨 Received Event: SUBSCRIPTION_ACTIVATED
  ✅ SUBSCRIPTION ACTIVATED!
     Message: Your subscription is now active. You can now access the content.
     You can now access the content!

  Current Authorization Status: AUTHORIZED ✓
```

## Integration Guide

### React/Vue/Angular Frontend

Use these examples as a template for your frontend integration:

```javascript
// Pseudocode for any frontend framework
const socket = io('YOUR_BACKEND_URL');

socket.on('connect', () => {
  socket.emit('subscribe', { 
    rooms: [`user:${currentUser.walletAddress}`] 
  });
});

socket.on('event', (payload) => {
  if (payload.type === 'AUTHORIZATION_UPDATED') {
    updateUI(payload.data.isAuthorized);
  }
});
```

### Backend Customization

Modify the event listener to filter specific events:

```javascript
// In sorobanEventListener.js
async processEvent(event) {
  const eventType = this.extractEventType(event);
  
  // Only process events you care about
  if (!['StreamCreated', 'SubscriptionActivated'].includes(eventType)) {
    return;
  }
  
  // ... process event
}
```

## Troubleshooting

### "Cannot connect to server"

**Solution**: Make sure the backend is running:
```bash
npm start
```

### "Tests failing"

**Solution**: Check that all dependencies are installed:
```bash
npm install
```

### "No events received"

**Solution**: Verify you're subscribed to the correct rooms:
```javascript
socket.emit('subscribe', { 
  rooms: [`user:${YOUR_WALLET_ADDRESS}`] 
});
```

## Additional Resources

- Full documentation: `../docs/REAL_TIME_EVENT_LISTENER.md`
- Quick start guide: `../docs/QUICKSTART_REALTIME_EVENTS.md`
- Implementation summary: `../IMPLEMENTATION_SUMMARY.md`

## Support

If you encounter issues:

1. Check the example code for proper usage patterns
2. Review the console logs for error messages
3. Read the troubleshooting section in the quickstart guide
4. Compare your implementation with these working examples

---

**Happy Coding!** 🚀

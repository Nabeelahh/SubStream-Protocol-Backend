# Testing Guide - Real-Time Event Listener

This guide provides comprehensive testing procedures for the real-time event listener system.

## Table of Contents

1. [Quick Test](#quick-test)
2. [Automated Tests](#automated-tests)
3. [Manual Testing](#manual-testing)
4. [Integration Testing](#integration-testing)
5. [Performance Testing](#performance-testing)
6. [Troubleshooting](#troubleshooting)

---

## Quick Test ⚡

**Purpose**: Verify the system is working in under 2 minutes

### Steps

1. **Start the server**:
   ```bash
   npm start
   ```
   
   Expected output:
   ```
   SubStream API running on port 3000
   WebSocket server ready for real-time events
   Soroban event listener: enabled
   ```

2. **Run automated tests** (in new terminal):
   ```bash
   npm run test:event-listener
   ```
   
   Expected output: All 5 tests pass ✓

3. **Check WebSocket stats**:
   ```bash
   curl http://localhost:3000/api/websocket/stats
   ```
   
   Expected response:
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

If all three steps succeed, the basic functionality is working! ✓

---

## Automated Tests 🤖

### Test Suite Overview

**Location**: `examples/test-event-listener.js`

**What it tests**:
1. StreamCreated event simulation
2. StreamStopped event simulation
3. Force sync functionality
4. Active subscriptions query
5. Subscribers query for creator

### Running Tests

```bash
npm run test:event-listener
```

### Understanding Test Output

#### Passing Test Example
```
Test 1: Simulating StreamCreated event...
------------------------------------------------------------
✓ Event Emitted: subscriptionUpdated
  User: TEST_USER_WALLET_ADDRESS
  Creator: TEST_CREATOR_WALLET_ADDRESS
  Content: test_video_001
  Authorized: YES ✓

✓ Test 1 PASSED: Database updated correctly
```

#### Failing Test Example
```
✗ Test 2 FAILED: Authorization not revoked

Error: Expected isAuthorized to be false but got true
    at runTests (examples/test-event-listener.js:95:11)
```

### Test Exit Codes

- **Exit code 0**: All tests passed ✓
- **Exit code 1**: One or more tests failed ✗

---

## Manual Testing 👤

### Test 1: WebSocket Connection

**Purpose**: Verify WebSocket connectivity

**Steps**:
```bash
npm run example:websocket-client
```

**Expected behavior**:
- Connects successfully
- Shows "Connected to WebSocket server"
- Displays subscription status
- Receives events in real-time

**Test scenarios**:
1. ✓ Normal connection
2. ✓ Reconnection after disconnect
3. ✓ Room subscription
4. ✓ Event reception

### Test 2: Manual Subscription Sync

**Purpose**: Test the force-sync endpoint

**Setup**:
```bash
# Start server if not running
npm start
```

**Test request**:
```bash
curl -X POST http://localhost:3000/api/subscription/sync \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "TEST_USER",
    "creatorAddress": "TEST_CREATOR",
    "contentId": "test_content"
  }'
```

**Expected response**:
```json
{
  "success": true,
  "data": {
    "isAuthorized": false,
    "subscription": null,
    "syncedAt": "2026-03-25T10:30:00.000Z"
  }
}
```

### Test 3: WebSocket Stats Endpoint

**Purpose**: Verify WebSocket monitoring

**Request**:
```bash
curl http://localhost:3000/api/websocket/stats
```

**Expected response**:
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

---

## Integration Testing 🔗

### Frontend Integration Test

**Purpose**: Test real-world frontend usage

**Setup**:
1. Create a simple HTML test page:

```html
<!DOCTYPE html>
<html>
<head>
  <title>WebSocket Test</title>
  <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
</head>
<body>
  <h1>WebSocket Connection Test</h1>
  <div id="status">Connecting...</div>
  <div id="events"></div>
  
  <script>
    const socket = io('http://localhost:3000');
    
    socket.on('connect', () => {
      document.getElementById('status').innerHTML = '✓ Connected';
      
      // Subscribe to personal room
      socket.emit('subscribe', {
        rooms: ['user:TEST_ADDRESS']
      });
    });
    
    socket.on('event', (payload) => {
      const div = document.createElement('div');
      div.textContent = `Event: ${payload.type}`;
      document.getElementById('events').appendChild(div);
    });
    
    socket.on('disconnect', () => {
      document.getElementById('status').innerHTML = '✗ Disconnected';
    });
  </script>
</body>
</html>
```

2. Open the HTML file in a browser
3. Check browser console for connection status

**Expected behavior**:
- Connects within 2 seconds
- Shows "Connected" status
- Can subscribe to rooms
- Receives events

### Multi-Client Test

**Purpose**: Test multiple simultaneous connections

**Setup**:
1. Start server: `npm start`
2. Open 3-5 browser tabs with the test HTML page
3. Run WebSocket client example in terminal: `npm run example:websocket-client`

**Monitor**:
```bash
# In another terminal, watch stats
watch -n 2 'curl -s http://localhost:3000/api/websocket/stats | jq'
```

**Expected**:
- All clients connect successfully
- Stats show correct client count
- Events broadcast to all clients
- No connection drops

---

## Performance Testing ⚡

### Load Test Setup

**Tool**: Apache Bench (ab) or similar

**Test WebSocket connections**:
```bash
# Install Apache Bench if needed
# Ubuntu: sudo apt-get install apache2-utils
# macOS: brew install ab

# Test with 100 concurrent connections
ab -n 1000 -c 100 http://localhost:3000/api/websocket/stats
```

### Metrics to Monitor

1. **Response Time**: Should be <100ms for stats endpoint
2. **WebSocket Connection Time**: Should be <2 seconds
3. **Event Broadcast Latency**: Should be <50ms
4. **Database Query Time**: Should be <10ms

### Performance Benchmarks

| Metric | Excellent | Good | Acceptable | Poor |
|--------|-----------|------|------------|------|
| Event Detection | <3s | 3-5s | 5-10s | >10s |
| DB Update | <5ms | 5-10ms | 10-20ms | >20ms |
| WS Broadcast | <20ms | 20-50ms | 50-100ms | >100ms |
| Force Sync | <1s | 1-2s | 2-5s | >5s |

### Stress Test

**Purpose**: Find breaking point

**Script**:
```javascript
// stress-test.js
const { io } = require('socket.io-client');

const CLIENTS_COUNT = 500;
const clients = [];

console.log(`Starting ${CLIENTS_COUNT} clients...`);

for (let i = 0; i < CLIENTS_COUNT; i++) {
  const client = io('http://localhost:3000');
  
  client.on('connect', () => {
    client.emit('subscribe', { rooms: [`user:test_${i}`] });
  });
  
  clients.push(client);
  
  if (i % 100 === 0) {
    console.log(`Started ${i} clients...`);
  }
}

// Monitor for 30 seconds
setTimeout(() => {
  let connected = clients.filter(c => c.connected).length;
  console.log(`Connected: ${connected}/${CLIENTS_COUNT}`);
  
  // Clean up
  clients.forEach(c => c.close());
  process.exit(0);
}, 30000);
```

**Run**:
```bash
node stress-test.js
```

**Expected**: System should handle 100+ concurrent connections without issues

---

## Troubleshooting 🔧

### Issue: Tests Failing

**Symptoms**:
```
✗ Test 1 FAILED: Database not updated
```

**Diagnosis**:
```bash
# Check if database file exists
ls -la data/

# Check permissions
chmod 755 data/
```

**Solution**:
```bash
# Delete and recreate database
rm data/substream-protocol.sqlite
npm start
# Restart server to recreate tables
```

### Issue: WebSocket Not Connecting

**Symptoms**:
```
WebSocket connection failed
```

**Diagnosis**:
```bash
# Check if port 3000 is in use
netstat -an | grep 3000

# Check firewall
sudo ufw status
```

**Solution**:
```bash
# Kill process on port 3000
killall node

# Restart server
npm start

# Or use different port
PORT=3001 npm start
```

### Issue: Events Not Detected

**Symptoms**:
No events appearing in logs

**Diagnosis**:
```bash
# Check RPC connection
curl -X POST YOUR_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}'

# Check event listener status
curl http://localhost:3000/health
```

**Solution**:
```bash
# Verify .env configuration
cat .env | grep SOROBAN

# Increase polling interval for debugging
SOROBAN_POLLING_INTERVAL=2000

# Restart server
npm start
```

### Issue: Database Lock Errors

**Symptoms**:
```
Error: database is locked
```

**Diagnosis**:
```bash
# Check for zombie node processes
ps aux | grep node

# Check database locks
lsof data/substream-protocol.sqlite
```

**Solution**:
```bash
# Kill all node processes
killall -9 node

# Remove database lock file
rm data/substream-protocol.sqlite-journal

# Increase polling interval
SOROBAN_POLLING_INTERVAL=10000

# Restart
npm start
```

### Issue: High Memory Usage

**Symptoms**:
Server using excessive memory

**Diagnosis**:
```bash
# Monitor memory
ps -o pid,rss,command -p $(pgrep -f "node index.js")
```

**Solution**:
```bash
# Set Node.js memory limit
NODE_OPTIONS="--max-old-space-size=512" npm start

# Or reduce polling frequency
SOROBAN_POLLING_INTERVAL=10000
```

---

## Test Checklist ✅

Use this checklist to verify complete functionality:

### Basic Functionality
- [ ] Server starts without errors
- [ ] WebSocket server initializes
- [ ] Event listener starts
- [ ] Health endpoint responds
- [ ] Stats endpoint works

### Database Tests
- [ ] user_subscriptions table created
- [ ] Can insert subscription record
- [ ] Can update authorization flag
- [ ] Can query by user address
- [ ] Can query by creator address
- [ ] Indexes are working (<10ms queries)

### Event Listener Tests
- [ ] Detects simulated events
- [ ] Updates database correctly
- [ ] Emits events via EventEmitter
- [ ] Handles errors gracefully
- [ ] Can be stopped and restarted

### WebSocket Tests
- [ ] Clients can connect
- [ ] Can subscribe to rooms
- [ ] Receives broadcast events
- [ ] Handles disconnections
- [ ] Auto-reconnection works
- [ ] Multiple clients supported

### API Endpoint Tests
- [ ] GET /api/websocket/stats returns data
- [ ] POST /api/subscription/sync updates status
- [ ] Error handling works correctly
- [ ] Input validation catches bad requests

### Integration Tests
- [ ] Frontend can connect via Socket.IO
- [ ] Events flow from blockchain → DB → WS → UI
- [ ] Manual sync works after payment
- [ ] Real-time updates functional

### Performance Tests
- [ ] Handles 10 concurrent connections
- [ ] Handles 50 concurrent connections
- [ ] Handles 100 concurrent connections
- [ ] Event detection <5 seconds
- [ ] Database updates <10ms
- [ ] WebSocket broadcast <50ms

### Security Tests
- [ ] CORS configuration works
- [ ] Input validation prevents injection
- [ ] Rate limiting considered
- [ ] Error messages don't leak sensitive info

---

## Continuous Testing

### CI/CD Integration

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Setup Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '16'
    
    - name: Install dependencies
      run: npm install
    
    - name: Run event listener tests
      run: npm run test:event-listener
    
    - name: Start server for integration tests
      run: npm start &
      env:
        ENABLE_SOROBAN_EVENT_LISTENER: false
    
    - name: Wait for server
      run: sleep 5
    
    - name: Run API tests
      run: |
        curl http://localhost:3000/api/websocket/stats
        curl -X POST http://localhost:3000/api/subscription/sync \
          -H "Content-Type: application/json" \
          -d '{"userAddress":"test","creatorAddress":"test","contentId":"test"}'
```

---

## Test Reports

### Generating Coverage Reports

If using Jest or similar:

```bash
# Install coverage tool
npm install --save-dev nyc

# Run tests with coverage
nyc npm run test:event-listener

# Generate HTML report
nyc report --reporter=html

# Open report
open coverage/index.html
```

### Performance Report Template

```markdown
## Test Results - [DATE]

### Environment
- Node.js: v16.x.x
- Memory: 8GB
- CPU: 4 cores

### Test Summary
- Total Tests: 15
- Passed: 14 ✓
- Failed: 1 ✗
- Skipped: 0

### Performance Metrics
- Avg Response Time: 45ms
- P95 Response Time: 89ms
- P99 Response Time: 156ms
- Max Concurrent Connections: 500

### Issues Found
1. Minor: Database lock under extreme load (>400 connections)
   - Workaround: Switch to PostgreSQL for production

### Recommendations
1. ✓ Ready for staging deployment
2. ⚠ Consider PostgreSQL for production
3. ℹ Monitor memory usage under load
```

---

## Support

For additional help:
1. Check the troubleshooting section above
2. Review example code in `examples/`
3. Read full documentation in `docs/REAL_TIME_EVENT_LISTENER.md`
4. Check server logs for error details
5. Test in isolation before integrating

---

**Happy Testing!** 🧪

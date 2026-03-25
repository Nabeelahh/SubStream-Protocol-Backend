/**
 * Example WebSocket Client for SubStream Real-Time Events
 * 
 * This script demonstrates how to connect to the WebSocket server
 * and receive real-time subscription updates.
 * 
 * Usage: node examples/websocket-client-example.js
 */

const { io } = require('socket.io-client');

// Configuration
const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:3000';
const WALLET_ADDRESS = process.env.WALLET_ADDRESS || 'EXAMPLE_USER_ADDRESS';
const CREATOR_ADDRESS = process.env.CREATOR_ADDRESS || 'EXAMPLE_CREATOR_ADDRESS';
const CONTENT_ID = process.env.CONTENT_ID || 'example_video_123';

class SubscriptionClient {
  constructor(walletAddress, creatorAddress, contentId) {
    this.walletAddress = walletAddress;
    this.creatorAddress = creatorAddress;
    this.contentId = contentId;
    this.socket = null;
    this.isAuthorized = false;
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    console.log(`Connecting to ${SOCKET_URL}...`);

    this.socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    // Connection established
    this.socket.on('connect', () => {
      console.log('✓ Connected to WebSocket server');
      console.log(`  Socket ID: ${this.socket.id}`);

      // Subscribe to personal room for notifications
      this.socket.emit('subscribe', {
        rooms: [`user:${this.walletAddress}`],
      });

      // Check initial subscription status
      this.checkSubscription();
    });

    // Disconnected
    this.socket.on('disconnect', () => {
      console.log('✗ Disconnected from WebSocket server');
    });

    // Connection error
    this.socket.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    // Subscription confirmation
    this.socket.on('subscribed', (data) => {
      console.log('✓ Subscribed to rooms:', data.rooms);
    });

    // Real-time events
    this.socket.on('event', (payload) => {
      this.handleEvent(payload);
    });

    // Reconnection events
    this.socket.on('reconnect', (attemptNumber) => {
      console.log(`↻ Reconnected after ${attemptNumber} attempts`);
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('Reconnection error:', error);
    });
  }

  /**
   * Check current subscription status
   */
  checkSubscription() {
    console.log('\n📡 Checking subscription status...');

    this.socket.emit('checkSubscription', {
      userAddress: this.walletAddress,
      creatorAddress: this.creatorAddress,
      contentId: this.contentId,
    }, (response) => {
      if (response.success) {
        this.isAuthorized = response.data.isAuthorized;
        console.log('✓ Subscription Status:');
        console.log(`  Authorized: ${this.isAuthorized ? 'YES ✓' : 'NO ✗'}`);
        console.log(`  Checked at: ${new Date(response.data.checkedAt).toLocaleString()}`);
        
        if (response.data.subscription) {
          const sub = response.data.subscription;
          console.log(`  Type: ${sub.subscriptionType || 'N/A'}`);
          console.log(`  Started: ${sub.startedAt ? new Date(sub.startedAt).toLocaleString() : 'N/A'}`);
          console.log(`  Last Updated: ${new Date(sub.updatedAt).toLocaleString()}`);
        }
      } else {
        console.error('✗ Failed to check subscription:', response.error);
      }
    });
  }

  /**
   * Handle incoming events
   */
  handleEvent(payload) {
    console.log('\n📨 Received Event:', payload.type);

    switch (payload.type) {
      case 'STREAM_STARTED':
        console.log('  🎬 Stream started!');
        console.log(`     Creator: ${payload.data.creatorAddress}`);
        console.log(`     Content: ${payload.data.contentId}`);
        break;

      case 'STREAM_ENDED':
        console.log('  ⏹️ Stream ended');
        console.log(`     Creator: ${payload.data.creatorAddress}`);
        break;

      case 'SUBSCRIPTION_ACTIVATED':
        console.log('  ✅ SUBSCRIPTION ACTIVATED!');
        console.log(`     Message: ${payload.data.message}`);
        console.log(`     You can now access the content!`);
        this.isAuthorized = true;
        break;

      case 'SUBSCRIPTION_DEACTIVATED':
        console.log('  ❌ Subscription deactivated');
        console.log(`     Message: ${payload.data.message}`);
        this.isAuthorized = false;
        break;

      case 'AUTHORIZATION_UPDATED':
        console.log('  🔄 Authorization status updated');
        console.log(`     Authorized: ${payload.data.isAuthorized ? 'YES ✓' : 'NO ✗'}`);
        console.log(`     Updated: ${new Date(payload.data.updatedAt).toLocaleString()}`);
        this.isAuthorized = payload.data.isAuthorized;
        break;

      case 'NEW_SUBSCRIBER':
        console.log('  🎉 New subscriber detected!');
        console.log(`     User: ${payload.data.userAddress}`);
        break;

      default:
        console.log('  Unknown event type:', payload.type);
    }

    // Show current status
    console.log(`\n  Current Authorization Status: ${this.isAuthorized ? 'AUTHORIZED ✓' : 'NOT AUTHORIZED ✗'}\n`);
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    if (this.socket) {
      console.log('\nDisconnecting...');
      this.socket.close();
      console.log('✓ Disconnected');
    }
  }

  /**
   * Get connection status
   */
  isConnected() {
    return this.socket && this.socket.connected;
  }
}

// Main execution
console.log('='.repeat(60));
console.log('SubStream WebSocket Client Example');
console.log('='.repeat(60));
console.log(`\nConfiguration:`);
console.log(`  Wallet Address: ${WALLET_ADDRESS}`);
console.log(`  Creator Address: ${CREATOR_ADDRESS}`);
console.log(`  Content ID: ${CONTENT_ID}`);
console.log(`  Server URL: ${SOCKET_URL}`);
console.log('='.repeat(60));
console.log('\nStarting client...\n');

const client = new SubscriptionClient(WALLET_ADDRESS, CREATOR_ADDRESS, CONTENT_ID);
client.connect();

// Keep the process running and show status periodically
let statusInterval = setInterval(() => {
  if (!client.isConnected()) {
    console.log('\n⚠️  Not connected to server. Attempting to reconnect...\n');
  }
}, 5000);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  clearInterval(statusInterval);
  client.disconnect();
  process.exit(0);
});

console.log('Press Ctrl+C to exit\n');

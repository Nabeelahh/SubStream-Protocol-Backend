const { Server } = require('socket.io');
const { EventNames } = require('./sorobanEventListener');

/**
 * WebSocket server for real-time subscription updates.
 * Broadcasts stream events and authorization changes to connected clients.
 */
class WebSocketServer {
  constructor(httpServer, eventListener, database) {
    this.httpServer = httpServer;
    this.eventListener = eventListener;
    this.database = database;
    this.io = null;
    this.connectedClients = new Map(); // Map of socketId -> client data
  }

  /**
   * Initialize and start the WebSocket server.
   * @returns {object} Socket.IO server instance.
   */
  init() {
    if (this.io) {
      console.log('[WebSocketServer] Already initialized');
      return this.io;
    }

    // Initialize Socket.IO with CORS configuration
    this.io = new Server(this.httpServer, {
      cors: {
        origin: process.env.WEBSOCKET_CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
        credentials: false,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Set up connection handling
    this.setupConnectionHandler();
    
    // Subscribe to event listener broadcasts
    this.subscribeToEvents();

    console.log('[WebSocketServer] Initialized successfully');
    return this.io;
  }

  /**
   * Set up WebSocket connection handler.
   * @private
   */
  setupConnectionHandler() {
    this.io.on('connection', (socket) => {
      console.log(`[WebSocketServer] Client connected: ${socket.id}`);
      
      // Track connected client
      this.connectedClients.set(socket.id, {
        socketId: socket.id,
        subscriptions: [],
        connectedAt: new Date().toISOString(),
      });

      // Handle client joining specific rooms (e.g., user-specific channels)
      socket.on('subscribe', (data) => {
        this.handleSubscribe(socket, data);
      });

      // Handle client leaving rooms
      socket.on('unsubscribe', (data) => {
        this.handleUnsubscribe(socket, data);
      });

      // Handle subscription status check requests
      socket.on('checkSubscription', async (data, callback) => {
        await this.handleSubscriptionCheck(socket, data, callback);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      // Handle errors
      socket.on('error', (error) => {
        console.error(`[WebSocketServer] Socket error (${socket.id}):`, error);
      });
    });
  }

  /**
   * Subscribe to Soroban event listener broadcasts.
   * @private
   */
  subscribeToEvents() {
    // Stream created events
    this.eventListener.on(EventNames.STREAM_CREATED, (data) => {
      console.log('[WebSocketServer] Broadcasting StreamCreated event');
      this.broadcastToRoom(`creator:${data.creatorAddress}`, {
        type: 'STREAM_CREATED',
        data,
      });
      
      // Also notify specific users if available
      if (data.userAddress) {
        this.broadcastToUser(data.userAddress, {
          type: 'STREAM_STARTED',
          data,
        });
      }
    });

    // Stream stopped events
    this.eventListener.on(EventNames.STREAM_STOPPED, (data) => {
      console.log('[WebSocketServer] Broadcasting StreamStopped event');
      this.broadcastToRoom(`creator:${data.creatorAddress}`, {
        type: 'STREAM_STOPPED',
        data,
      });
      
      // Also notify specific users if available
      if (data.userAddress) {
        this.broadcastToUser(data.userAddress, {
          type: 'STREAM_ENDED',
          data,
        });
      }
    });

    // Subscription activated events
    this.eventListener.on(EventNames.SUBSCRIPTION_ACTIVATED, (data) => {
      console.log('[WebSocketServer] Broadcasting SubscriptionActivated event');
      
      // Notify the user immediately
      if (data.userAddress) {
        this.broadcastToUser(data.userAddress, {
          type: 'SUBSCRIPTION_ACTIVATED',
          data: {
            ...data,
            isAuthorized: true,
            message: 'Your subscription is now active. You can now access the content.',
          },
        });
        
        // Notify the creator
        this.broadcastToRoom(`creator:${data.creatorAddress}`, {
          type: 'NEW_SUBSCRIBER',
          data,
        });
      }
    });

    // Subscription deactivated events
    this.eventListener.on(EventNames.SUBSCRIPTION_DEACTIVATED, (data) => {
      console.log('[WebSocketServer] Broadcasting SubscriptionDeactivated event');
      
      // Notify the user
      if (data.userAddress) {
        this.broadcastToUser(data.userAddress, {
          type: 'SUBSCRIPTION_DEACTIVATED',
          data: {
            ...data,
            isAuthorized: false,
            message: 'Your subscription has ended.',
          },
        });
      }
    });

    // General subscription updates
    this.eventListener.on('subscriptionUpdated', (subscription) => {
      console.log('[WebSocketServer] Broadcasting subscription update');
      
      // Broadcast to user's room
      this.broadcastToUser(subscription.userAddress, {
        type: 'AUTHORIZATION_UPDATED',
        data: {
          userAddress: subscription.userAddress,
          creatorAddress: subscription.creatorAddress,
          contentId: subscription.contentId,
          isAuthorized: subscription.isAuthorized,
          updatedAt: subscription.updatedAt,
        },
      });
    });
  }

  /**
   * Handle client subscription to rooms.
   * @private
   * @param {Socket} socket Socket.IO socket.
   * @param {object} data Subscription data.
   */
  handleSubscribe(socket, data) {
    const { rooms } = data || {};
    
    if (!rooms || !Array.isArray(rooms)) {
      socket.emit('error', { message: 'Invalid subscription request' });
      return;
    }

    for (const room of rooms) {
      socket.join(room);
      console.log(`[WebSocketServer] Client ${socket.id} joined room: ${room}`);
      
      // Update client tracking
      const client = this.connectedClients.get(socket.id);
      if (client) {
        client.subscriptions.push(room);
      }
    }

    // Send confirmation
    socket.emit('subscribed', { rooms });
  }

  /**
   * Handle client unsubscription from rooms.
   * @private
   * @param {Socket} socket Socket.IO socket.
   * @param {object} data Unsubscription data.
   */
  handleUnsubscribe(socket, data) {
    const { rooms } = data || {};
    
    if (!rooms || !Array.isArray(rooms)) {
      return;
    }

    for (const room of rooms) {
      socket.leave(room);
      console.log(`[WebSocketServer] Client ${socket.id} left room: ${room}`);
      
      // Update client tracking
      const client = this.connectedClients.get(socket.id);
      if (client) {
        client.subscriptions = client.subscriptions.filter(r => r !== room);
      }
    }

    // Send confirmation
    socket.emit('unsubscribed', { rooms });
  }

  /**
   * Handle subscription status check request.
   * @private
   * @param {Socket} socket Socket.IO socket.
   * @param {object} data Check request data.
   * @param {Function} callback Callback function.
   */
  async handleSubscriptionCheck(socket, data, callback) {
    try {
      const { userAddress, creatorAddress, contentId } = data || {};
      
      if (!userAddress || !creatorAddress || !contentId) {
        callback({ 
          success: false, 
          error: 'Missing required fields: userAddress, creatorAddress, contentId' 
        });
        return;
      }

      // Force sync with blockchain first
      const isAuthorized = await this.eventListener.forceSyncSubscription(
        userAddress,
        creatorAddress,
        contentId
      );

      // Get current subscription from database
      const subscription = this.database.getUserSubscription(
        userAddress,
        creatorAddress,
        contentId
      );

      callback({
        success: true,
        data: {
          isAuthorized,
          subscription: subscription || null,
          checkedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('[WebSocketServer] Subscription check failed:', error);
      callback({
        success: false,
        error: error.message || 'Failed to check subscription status',
      });
    }
  }

  /**
   * Handle client disconnection.
   * @private
   * @param {Socket} socket Socket.IO socket.
   */
  handleDisconnect(socket) {
    console.log(`[WebSocketServer] Client disconnected: ${socket.id}`);
    this.connectedClients.delete(socket.id);
  }

  /**
   * Broadcast a message to all clients in a specific room.
   * @param {string} room Room name to broadcast to.
   * @param {object} payload Message payload.
   */
  broadcastToRoom(room, payload) {
    if (!this.io) {
      return;
    }

    console.log(`[WebSocketServer] Broadcasting to room ${room}:`, payload.type);
    this.io.to(room).emit('event', payload);
  }

  /**
   * Broadcast a message to all sockets associated with a user address.
   * @param {string} userAddress User wallet address.
   * @param {object} payload Message payload.
   */
  broadcastToUser(userAddress, payload) {
    if (!this.io) {
      return;
    }

    // Users join a personal room based on their address
    const userRoom = `user:${userAddress}`;
    console.log(`[WebSocketServer] Broadcasting to user ${userAddress}:`, payload.type);
    this.io.to(userRoom).emit('event', payload);
  }

  /**
   * Broadcast a message to all connected clients.
   * @param {object} payload Message payload.
   */
  broadcast(payload) {
    if (!this.io) {
      return;
    }

    console.log('[WebSocketServer] Broadcasting to all clients:', payload.type);
    this.io.emit('event', payload);
  }

  /**
   * Get statistics about connected clients.
   * @returns {object}
   */
  getStats() {
    return {
      connectedClients: this.connectedClients.size,
      ioConnected: this.io?.engine?.clientsCount || 0,
      rooms: Array.from(this.io?.sockets.adapter.rooms?.keys() || []),
    };
  }

  /**
   * Close the WebSocket server.
   * @returns {void}
   */
  close() {
    if (this.io) {
      this.io.close();
      this.io = null;
      console.log('[WebSocketServer] Closed');
    }
  }
}

module.exports = {
  WebSocketServer,
};

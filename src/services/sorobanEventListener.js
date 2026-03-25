const { rpc, Networks, hash } = require('@stellar/stellar-sdk');
const EventEmitter = require('events');

/**
 * Event names emitted by SorobanEventListener.
 */
const EventNames = {
  STREAM_CREATED: 'streamCreated',
  STREAM_STOPPED: 'streamStopped',
  SUBSCRIPTION_ACTIVATED: 'subscriptionActivated',
  SUBSCRIPTION_DEACTIVATED: 'subscriptionDeactivated',
  ERROR: 'error',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
};

/**
 * Listens to Soroban contract events using Stellar RPC polling.
 * Detects StreamCreated, StreamStopped, and subscription-related events.
 * Updates user authorization status in real-time to prevent sync lag.
 */
class SorobanEventListener extends EventEmitter {
  constructor(config, database) {
    super();
    this.config = config;
    this.database = database;
    this.server = config.soroban.rpcUrl ? new rpc.Server(config.soroban.rpcUrl) : null;
    this.contractId = config.soroban.contractId;
    this.pollingInterval = config.soroban.pollingInterval || 5000; // 5 seconds default
    this.isRunning = false;
    this.lastProcessedLedger = null;
    this.retryAttempts = 0;
    this.maxRetryAttempts = 5;
    this.retryDelay = 1000;
  }

  /**
   * Start listening for contract events.
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      console.log('[SorobanEventListener] Already running');
      return;
    }

    if (!this.server) {
      const error = new Error('SOROBAN_RPC_URL is required for event listening');
      this.emit(EventNames.ERROR, error);
      throw error;
    }

    this.isRunning = true;
    console.log('[SorobanEventListener] Starting event listener...');

    try {
      // Initialize last processed ledger from latest
      if (!this.lastProcessedLedger) {
        const latestLedger = await this.getLatestLedger();
        this.lastProcessedLedger = latestLedger;
        console.log(`[SorobanEventListener] Starting from ledger ${latestLedger}`);
      }

      this.emit(EventNames.CONNECTED);
      this.pollEvents();
    } catch (error) {
      console.error('[SorobanEventListener] Failed to start:', error);
      this.emit(EventNames.ERROR, error);
      throw error;
    }
  }

  /**
   * Stop listening for contract events.
   * @returns {void}
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    clearTimeout(this.pollTimeout);
    this.emit(EventNames.DISCONNECTED);
    console.log('[SorobanEventListener] Stopped');
  }

  /**
   * Poll for new events from the blockchain.
   * @private
   */
  async pollEvents() {
    if (!this.isRunning) {
      return;
    }

    try {
      await this.processNewEvents();
      this.retryAttempts = 0;
    } catch (error) {
      console.error('[SorobanEventListener] Error polling events:', error);
      this.retryAttempts++;

      if (this.retryAttempts >= this.maxRetryAttempts) {
        console.error('[SorobanEventListener] Max retry attempts reached');
        this.emit(EventNames.ERROR, error);
        this.retryAttempts = 0;
      }
    }

    // Schedule next poll
    this.pollTimeout = setTimeout(() => this.pollEvents(), this.pollingInterval);
  }

  /**
   * Process new events since the last processed ledger.
   * @private
   */
  async processNewEvents() {
    const currentLedger = await this.getLatestLedger();
    
    if (!this.lastProcessedLedger || currentLedger <= this.lastProcessedLedger) {
      return;
    }

    console.log(`[SorobanEventListener] Processing ledgers ${this.lastProcessedLedger + 1} to ${currentLedger}`);

    // Fetch events from contract
    const events = await this.getContractEvents(this.lastProcessedLedger + 1, currentLedger);
    
    for (const event of events) {
      await this.processEvent(event);
    }

    this.lastProcessedLedger = currentLedger;
  }

  /**
   * Get latest ledger sequence.
   * @private
   * @returns {Promise<number>}
   */
  async getLatestLedger() {
    const latest = await this.server.getLatestLedger();
    return latest.sequence;
  }

  /**
   * Fetch contract events between two ledgers.
   * @private
   * @param {number} startLedger Starting ledger sequence.
   * @param {number} endLedger Ending ledger sequence.
   * @returns {Promise<Array>}
   */
  async getContractEvents(startLedger, endLedger) {
    try {
      // Use getEvents RPC method with contract filter
      const response = await this.server.getEvents({
        startLedger,
        endLedger,
        filters: [{
          type: 'contract',
          contractIds: [this.contractId]
        }]
      });

      return response.events || [];
    } catch (error) {
      // Fallback: try alternative RPC methods if getEvents is not supported
      console.warn('[SorobanEventListener] getEvents failed, trying alternative approach:', error.message);
      return await this.fetchEventsAlternative(startLedger, endLedger);
    }
  }

  /**
   * Alternative method to fetch events using transactions.
   * @private
   * @param {number} startLedger Starting ledger sequence.
   * @param {number} endLedger Ending ledger sequence.
   * @returns {Promise<Array>}
   */
  async fetchEventsAlternative(startLedger, endLedger) {
    const events = [];
    
    // Iterate through ledgers (limit range to avoid timeout)
    const maxRange = 10;
    const actualEnd = Math.min(endLedger, startLedger + maxRange);
    
    for (let ledgerSeq = startLedger; ledgerSeq <= actualEnd; ledgerSeq++) {
      try {
        const ledger = await this.server.getLedger(ledgerSeq);
        
        if (ledger && ledger.transactions) {
          for (const tx of ledger.transactions) {
            if (tx.operations) {
              for (const op of tx.operations) {
                // Check if operation involves our contract
                if (op.destination === this.contractId || 
                    (op.asset && op.asset.issuer === this.contractId)) {
                  events.push({
                    type: 'contract_interaction',
                    ledger: ledgerSeq,
                    transaction: tx.hash,
                    operation: op,
                    timestamp: ledger.closed_at
                  });
                }
              }
            }
          }
        }
      } catch (error) {
        console.warn(`[SorobanEventListener] Failed to fetch ledger ${ledgerSeq}:`, error.message);
      }
    }
    
    return events;
  }

  /**
   * Process a single contract event.
   * @private
   * @param {object} event Contract event data.
   * @returns {Promise<void>}
   */
  async processEvent(event) {
    try {
      const eventType = this.extractEventType(event);
      
      console.log(`[SorobanEventListener] Processing event: ${eventType}`, {
        ledger: event.ledger || event.provenance?.ledger,
        timestamp: event.timestamp || event.provenance?.timestamp,
      });

      switch (eventType) {
        case 'StreamCreated':
          await this.handleStreamCreated(event);
          break;
        case 'StreamStopped':
          await this.handleStreamStopped(event);
          break;
        case 'SubscriptionActivated':
          await this.handleSubscriptionActivated(event);
          break;
        case 'SubscriptionDeactivated':
          await this.handleSubscriptionDeactivated(event);
          break;
        default:
          console.log(`[SorobanEventListener] Unknown event type: ${eventType}`);
      }
    } catch (error) {
      console.error('[SorobanEventListener] Error processing event:', error);
      this.emit(EventNames.ERROR, error);
    }
  }

  /**
   * Extract event type from event data.
   * @private
   * @param {object} event Event data.
   * @returns {string}
   */
  extractEventType(event) {
    // Try different event structure formats
    if (event.type) {
      return event.type;
    }
    
    if (event.body?.type) {
      return event.body.type;
    }
    
    if (event.event_type) {
      return event.event_type;
    }
    
    // Check decoded event data
    if (event.decodedEvent) {
      if (event.decodedEvent.type) {
        return event.decodedEvent.type;
      }
      if (typeof event.decodedEvent.data === 'string') {
        return event.decodedEvent.data;
      }
    }
    
    // Check raw event data
    if (event.rawEvent) {
      try {
        const parsed = typeof event.rawEvent === 'string' 
          ? JSON.parse(event.rawEvent) 
          : event.rawEvent;
        
        if (parsed.type) return parsed.type;
        if (parsed.event) return parsed.event;
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    return 'Unknown';
  }

  /**
   * Handle StreamCreated event.
   * @private
   * @param {object} event Event data.
   * @returns {Promise<void>}
   */
  async handleStreamCreated(event) {
    const eventData = this.extractEventData(event);
    
    console.log('[SorobanEventListener] StreamCreated event detected', eventData);
    
    // Emit event for WebSocket broadcast
    this.emit(EventNames.STREAM_CREATED, eventData);
    
    // Update user authorization if stream subscription is detected
    if (eventData.userAddress && eventData.creatorAddress && eventData.contentId) {
      await this.updateUserAuthorization(
        eventData.userAddress,
        eventData.creatorAddress,
        eventData.contentId,
        true,
        {
          eventType: 'StreamCreated',
          ledger: event.ledger || event.provenance?.ledger,
          timestamp: event.timestamp || event.provenance?.timestamp,
        }
      );
    }
  }

  /**
   * Handle StreamStopped event.
   * @private
   * @param {object} event Event data.
   * @returns {Promise<void>}
   */
  async handleStreamStopped(event) {
    const eventData = this.extractEventData(event);
    
    console.log('[SorobanEventListener] StreamStopped event detected', eventData);
    
    // Emit event for WebSocket broadcast
    this.emit(EventNames.STREAM_STOPPED, eventData);
    
    // Update user authorization
    if (eventData.userAddress && eventData.creatorAddress && eventData.contentId) {
      await this.updateUserAuthorization(
        eventData.userAddress,
        eventData.creatorAddress,
        eventData.contentId,
        false,
        {
          eventType: 'StreamStopped',
          ledger: event.ledger || event.provenance?.ledger,
          timestamp: event.timestamp || event.provenance?.timestamp,
        }
      );
    }
  }

  /**
   * Handle SubscriptionActivated event.
   * @private
   * @param {object} event Event data.
   * @returns {Promise<void>}
   */
  async handleSubscriptionActivated(event) {
    const eventData = this.extractEventData(event);
    
    console.log('[SorobanEventListener] SubscriptionActivated event detected', eventData);
    
    // Emit event for WebSocket broadcast
    this.emit(EventNames.SUBSCRIPTION_ACTIVATED, eventData);
    
    // Update user authorization
    if (eventData.userAddress && eventData.creatorAddress && eventData.contentId) {
      await this.updateUserAuthorization(
        eventData.userAddress,
        eventData.creatorAddress,
        eventData.contentId,
        true,
        {
          eventType: 'SubscriptionActivated',
          ledger: event.ledger || event.provenance?.ledger,
          timestamp: event.timestamp || event.provenance?.timestamp,
        }
      );
    }
  }

  /**
   * Handle SubscriptionDeactivated event.
   * @private
   * @param {object} event Event data.
   * @returns {Promise<void>}
   */
  async handleSubscriptionDeactivated(event) {
    const eventData = this.extractEventData(event);
    
    console.log('[SorobanEventListener] SubscriptionDeactivated event detected', eventData);
    
    // Emit event for WebSocket broadcast
    this.emit(EventNames.SUBSCRIPTION_DEACTIVATED, eventData);
    
    // Update user authorization
    if (eventData.userAddress && eventData.creatorAddress && eventData.contentId) {
      await this.updateUserAuthorization(
        eventData.userAddress,
        eventData.creatorAddress,
        eventData.contentId,
        false,
        {
          eventType: 'SubscriptionDeactivated',
          ledger: event.ledger || event.provenance?.ledger,
          timestamp: event.timestamp || event.provenance?.timestamp,
        }
      );
    }
  }

  /**
   * Extract structured data from event.
   * @private
   * @param {object} event Event data.
   * @returns {object}
   */
  extractEventData(event) {
    const data = {};
    
    // Extract common fields
    if (event.data) {
      if (typeof event.data === 'object') {
        Object.assign(data, event.data);
      } else if (typeof event.data === 'string') {
        try {
          Object.assign(data, JSON.parse(event.data));
        } catch (e) {
          data.rawData = event.data;
        }
      }
    }
    
    // Extract from decoded event
    if (event.decodedEvent?.data) {
      if (typeof event.decodedEvent.data === 'object') {
        Object.assign(data, event.decodedEvent.data);
      }
    }
    
    // Extract addresses and content ID from various possible field names
    data.userAddress = data.userAddress || data.subscriber || data.walletAddress || data.user;
    data.creatorAddress = data.creatorAddress || data.creator || data.receiver;
    data.contentId = data.contentId || data.videoId || data.streamId || data.content;
    data.subscriptionType = data.subscriptionType || data.type || data.plan;
    
    // Add event metadata
    data.ledger = event.ledger || event.provenance?.ledger;
    data.timestamp = event.timestamp || event.provenance?.timestamp;
    data.transactionHash = event.transactionHash || event.tx_hash || event.hash;
    
    return data;
  }

  /**
   * Update user authorization in database.
   * @private
   * @param {string} userAddress User wallet address.
   * @param {string} creatorAddress Creator wallet address.
   * @param {string} contentId Content identifier.
   * @param {boolean} isAuthorized Authorization status.
   * @param {object} metadata Additional metadata.
   * @returns {Promise<void>}
   */
  async updateUserAuthorization(userAddress, creatorAddress, contentId, isAuthorized, metadata = {}) {
    try {
      // First check if subscription exists
      const existing = this.database.getUserSubscription(userAddress, creatorAddress, contentId);
      
      if (!existing) {
        // Create new subscription record
        const subscription = this.database.upsertUserSubscription({
          userAddress,
          creatorAddress,
          contentId,
          isAuthorized,
          subscriptionType: metadata.subscriptionType || 'stream',
          startedAt: isAuthorized ? new Date().toISOString() : null,
          endedAt: !isAuthorized ? new Date().toISOString() : null,
          lastSyncedBlock: metadata.ledger,
          metadata,
        });
        
        console.log(`[SorobanEventListener] Created new subscription: ${userAddress} -> ${creatorAddress}/${contentId}, authorized: ${isAuthorized}`);
        
        // Emit update for real-time notification
        this.emit('subscriptionUpdated', subscription);
      } else {
        // Update existing subscription
        const updated = this.database.updateUserAuthorization(
          userAddress,
          creatorAddress,
          contentId,
          isAuthorized,
          { ...existing.metadata, ...metadata }
        );
        
        console.log(`[SorobanEventListener] Updated subscription: ${userAddress} -> ${creatorAddress}/${contentId}, authorized: ${isAuthorized}`);
        
        // Emit update for real-time notification
        this.emit('subscriptionUpdated', updated);
      }
    } catch (error) {
      console.error('[SorobanEventListener] Failed to update user authorization:', error);
      throw error;
    }
  }

  /**
   * Manually verify and update subscription status (for immediate sync on payment).
   * @param {string} userAddress User wallet address.
   * @param {string} creatorAddress Creator wallet address.
   * @param {string} contentId Content identifier.
   * @returns {Promise<boolean>} Current authorization status.
   */
  async forceSyncSubscription(userAddress, creatorAddress, contentId) {
    try {
      console.log(`[SorobanEventListener] Force syncing subscription: ${userAddress} -> ${creatorAddress}/${contentId}`);
      
      // Query recent events for this subscription
      const currentLedger = await this.getLatestLedger();
      const lookbackLedgers = 1000; // Look back ~1000 ledgers
      const startLedger = Math.max(1, currentLedger - lookbackLedgers);
      
      const events = await this.getContractEvents(startLedger, currentLedger);
      
      // Find most recent event for this subscription
      let latestStatus = null;
      let latestTimestamp = null;
      
      for (const event of events) {
        const eventData = this.extractEventData(event);
        
        if (eventData.userAddress === userAddress && 
            eventData.creatorAddress === creatorAddress && 
            eventData.contentId === contentId) {
          
          const eventType = this.extractEventType(event);
          const eventTime = event.timestamp || event.provenance?.timestamp;
          
          if (!latestTimestamp || eventTime > latestTimestamp) {
            latestTimestamp = eventTime;
            
            if (['StreamCreated', 'SubscriptionActivated'].includes(eventType)) {
              latestStatus = true;
            } else if (['StreamStopped', 'SubscriptionDeactivated'].includes(eventType)) {
              latestStatus = false;
            }
          }
        }
      }
      
      // If found on-chain status, update database
      if (latestStatus !== null) {
        await this.updateUserAuthorization(
          userAddress,
          creatorAddress,
          contentId,
          latestStatus,
          {
            eventType: 'ForceSync',
            syncedAt: new Date().toISOString(),
            syncedFromLedger: currentLedger,
          }
        );
        
        return latestStatus;
      }
      
      // No on-chain event found, keep current status or default to false
      const existing = this.database.getUserSubscription(userAddress, creatorAddress, contentId);
      return existing ? existing.isAuthorized : false;
      
    } catch (error) {
      console.error('[SorobanEventListener] Force sync failed:', error);
      throw error;
    }
  }
}

module.exports = {
  SorobanEventListener,
  EventNames,
};

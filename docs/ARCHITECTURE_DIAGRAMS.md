# Architecture Diagrams

This document provides visual diagrams of the real-time event listener system architecture.

## System Overview

```mermaid
graph TB
    User[Fan/User Wallet] -->|Pays on Chain| Contract[Soroban Smart Contract]
    Contract -->|Emits Event| Blockchain[Stellar Blockchain]
    EventListener[Soroban Event Listener] -->|Polls Every 5s| Blockchain
    EventListener -->|Updates| Database[(SQLite/PostgreSQL Database)]
    EventListener -->|Emits Event| WebSocketServer[WebSocket Server]
    WebSocketServer -->|Broadcasts| Frontend[Frontend App]
    Frontend -->|Connects via Socket.IO| WebSocketServer
    Database -->|Stores| Subscriptions[user_subscriptions table]
    Subscriptions -->|Contains| AuthFlag[is_authorized flag]
    Frontend -->|Checks| AuthFlag
    AuthFlag -->|Determines| Access[Content Access]
```

## Event Flow Sequence

```mermaid
sequenceDiagram
    participant User
    participant Contract
    participant Listener
    participant DB
    participant WS as WebSocket Server
    participant Frontend

    User->>Contract: Start Stream (Payment)
    Contract->>Blockchain: Emit StreamCreated Event
    loop Every 5 Seconds
        Listener->>Blockchain: Poll for Events
        Blockchain-->>Listener: Return New Events
    end
    Listener->>Listener: Detect StreamCreated
    Listener->>DB: Update is_authorized = true
    Listener->>WS: Emit subscriptionUpdated
    WS->>Frontend: Broadcast AUTHORIZATION_UPDATED
    Frontend->>Frontend: Unlock Content UI
    Frontend->>User: Show "Access Granted"
```

## Component Architecture

```mermaid
graph LR
    subgraph Backend
        EL[Soroban Event Listener]
        WS[WebSocket Server]
        API[Express API Endpoints]
        DB[(Database)]
    end
    
    subgraph Frontend
        React[React/Vue App]
        Socket[Socket.IO Client]
    end
    
    subgraph Blockchain
        Soroban[Soroban Contract]
        Stellar[Stellar Network]
    end
    
    Soroban -->|Events| Stellar
    Stellar -->|Polled by| EL
    EL -->|Updates| DB
    EL -->|Emits to| WS
    WS <-->|Real-time| Socket
    API <-->|HTTP| React
    DB -->|Serves| API
```

## Database Schema

```mermaid
erDiagram
    user_subscriptions {
        text id PK
        text user_address FK
        text creator_address FK
        text content_id
        integer is_authorized
        text subscription_type
        text started_at
        text ended_at
        text created_at
        text updated_at
        integer last_synced_block
        text metadata_json
    }
    
    INDEXES {
        idx_user_subscriptions_unique "UNIQUE(user_address, creator_address, content_id)"
        idx_user_subscriptions_user "INDEX(user_address)"
        idx_user_subscriptions_creator "INDEX(creator_address)"
        idx_user_subscriptions_authorized "INDEX(is_authorized)"
    }
```

## WebSocket Room Structure

```mermaid
graph TB
    subgraph WebSocket Rooms
        UserRoom[user:0xABC123...]
        CreatorRoom[creator:0xDEF456...]
        ContentRoom[content:video_123]
        
        UserRoom -->|Receives| PersonalEvents[Personal Notifications]
        CreatorRoom -->|Receives| AnalyticsEvents[Analytics Updates]
        ContentRoom -->|Receives| ContentEvents[Content-Specific Events]
    end
    
    SocketClient[Client Socket] -->|Joins| UserRoom
    SocketClient -->|Joins| CreatorRoom
    SocketClient -->|Joins| ContentRoom
```

## Event Types Flow

```mermaid
graph TD
    Start[Contract Event Detected] --> CheckType{Event Type?}
    CheckType -->|StreamCreated| HandleStream[Handle Stream Created]
    CheckType -->|StreamStopped| HandleStop[Handle Stream Stopped]
    CheckType -->|SubscriptionActivated| HandleSubStart[Handle Subscription Activated]
    CheckType -->|SubscriptionDeactivated| HandleSubStop[Handle Subscription Deactivated]
    
    HandleStream --> UpdateDB[Update Database: is_authorized=true]
    HandleSubStart --> UpdateDB
    HandleStop --> UpdateDBFalse[Update Database: is_authorized=false]
    HandleSubStop --> UpdateDBFalse
    
    UpdateDB --> EmitUpdate[Emit subscriptionUpdated Event]
    UpdateDBFalse --> EmitUpdate
    
    EmitUpdate --> Broadcast[WebSocket Broadcast to User]
    Broadcast --> FrontendUpdate[Frontend Updates UI]
```

## API Endpoint Integration

```mermaid
graph LR
    subgraph Express Routes
        CDNToken[POST /api/cdn/token]
        Sync[POST /api/subscription/sync]
        Stats[GET /api/websocket/stats]
    end
    
    subgraph Services
        Verifier[Soroban Subscription Verifier]
        EventListener[Soroban Event Listener]
        WSServer[WebSocket Server]
    end
    
    CDNToken -->|Verify| Verifier
    Sync -->|Force Sync| EventListener
    Stats -->|Get Connections| WSServer
    EventListener <-->|Share State| WSServer
```

## Deployment Architecture (Production)

```mermaid
graph TB
    subgraph Load Balancer
        LB[Nginx/HAProxy]
    end
    
    subgraph Backend Instances
        Instance1[Node.js Instance 1]
        Instance2[Node.js Instance 2]
        Instance3[Node.js Instance 3]
    end
    
    subgraph Shared Services
        Redis[Redis Adapter]
        Postgres[PostgreSQL Database]
    end
    
    subgraph External
        Stellar[Stellar RPC]
        Soroban[Soroban Contract]
    end
    
    LB --> Instance1
    LB --> Instance2
    LB --> Instance3
    
    Instance1 <--> Redis
    Instance2 <--> Redis
    Instance3 <--> Redis
    
    Instance1 --> Postgres
    Instance2 --> Postgres
    Instance3 --> Postgres
    
    Instance1 -->|Poll| Stellar
    Instance2 -->|Poll| Stellar
    Instance3 -->|Poll| Stellar
    
    Stellar --> Soroban
```

## Security Model

```mermaid
graph TD
    Client[Frontend Client] -->|Connect| WSServer[WebSocket Server]
    WSServer --> Validate{Validate Connection}
    Validate -->|Check Origin| CORS[CORS Configuration]
    Validate -->|Authenticate| Auth[Address Verification]
    Validate -->|Rate Limit| RateLimiter[Connection Rate Limiter]
    
    CORS --> Allow[Allow Connection]
    Auth --> Allow
    RateLimiter --> Allow
    
    Allow --> JoinRoom[Join Personal Room]
    JoinRoom --> VerifySig[Verify Wallet Signature]
    VerifySig --> Authorized[Authorized Access]
    
    Client -->|Send Message| WSServer
    WSServer --> Sanitize[Sanitize Input]
    Sanitize --> Process[Process Request]
    Process --> Respond[Send Response]
```

## Error Handling Flow

```mermaid
graph TD
    Start[Event Processing] --> Try[Try Process Event]
    Try -->|Success| Complete[Update DB & Broadcast]
    Try -->|Error| Catch[Catch Error]
    Catch --> Log[Log Error Details]
    Log --> Retry{Retry Available?}
    Retry -->|Yes| RetryAttempt[Retry with Backoff]
    Retry -->|No| EmitError[Emit Error Event]
    RetryAttempt -->|Success| Complete
    RetryAttempt -->|Fail| MaxRetries{Max Retries Reached?}
    MaxRetries -->|Yes| EmitError
    MaxRetries -->|No| Retry
    
    EmitError --> Alert[Alert Monitoring System]
    Alert --> Fallback[Fallback to Manual Sync]
```

## Performance Optimization

```mermaid
graph LR
    subgraph Caching Layer
        EventCache[Event Cache]
        DBCache[Database Query Cache]
    end
    
    subgraph Processing
        BatchProcessor[Batch Event Processor]
        Queue[Request Queue]
    end
    
    subgraph Output
        Compression[Message Compression]
        Throttle[Throttling]
    end
    
    Blockchain -->|Raw Events| EventCache
    EventCache --> BatchProcessor
    BatchProcessor --> Queue
    Queue --> DBCache
    DBCache --> Compression
    Compression --> Throttle
    Throttle --> WebSocketServer
```

## Monitoring Points

```mermaid
graph TB
    subgraph Health Checks
        HC1[Event Listener Running]
        HC2[WebSocket Connected Clients]
        HC3[Database Connections]
        HC4[RPC Endpoint Status]
    end
    
    subgraph Metrics
        M1[Events Processed/min]
        M2[Avg Processing Time]
        M3[WebSocket Latency]
        M4[Database Query Time]
    end
    
    subgraph Alerts
        A1[Event Detection Delay]
        A2[WebSocket Disconnections]
        A3[Database Lock Errors]
        A4[RPC Rate Limit]
    end
    
    HC1 --> Monitor[Monitoring Service]
    HC2 --> Monitor
    HC3 --> Monitor
    HC4 --> Monitor
    
    M1 --> Metrics
    M2 --> Metrics
    M3 --> Metrics
    M4 --> Metrics
    
    Monitor --> Dashboard[Grafana/Datadog]
    Metrics --> Dashboard
    Alerts --> PagerDuty[PagerDuty/Slack]
```

---

These diagrams illustrate the complete architecture of the real-time event listener system from multiple perspectives: component interaction, data flow, deployment topology, and operational concerns.

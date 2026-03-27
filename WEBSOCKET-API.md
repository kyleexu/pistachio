# Market WebSocket API

## 1. Endpoint

- URL: `ws://<host>:8082/ws/market`
- Example: `ws://localhost:8082/ws/market`
- Protocol: WebSocket (text/json)

## 2. Connection Behavior

- On connect, server registers the client and enables default subscriptions.
- Default topics:
  - `ticker`
  - `candle`
  - `orderbook`
  - `trade`

## 3. Client -> Server Messages

The server accepts JSON commands for subscribe/unsubscribe.

### 3.1 Subscribe

```json
{
  "op": "subscribe",
  "topics": ["ticker", "trade", "orderbook.5"]
}
```

Alternative single-topic format:

```json
{
  "op": "subscribe",
  "topic": "candle.1m"
}
```

### 3.2 Unsubscribe

```json
{
  "op": "unsubscribe",
  "topics": ["ticker", "candle"]
}
```

Alternative key:

- `action` can be used instead of `op` (same meaning).

## 4. Topic Semantics

- `ticker`  
  Push latest ticker snapshot.

- `candle`  
  Push latest candle snapshot (all intervals are pushed by default).

- `candle.<interval>`  
  Interval-specific filtering by client side topic matching, e.g.:
  - `candle.1m`
  - `candle.5m`
  - `candle.15m`
  - `candle.1h`
  - `candle.1d`

- `orderbook`  
  Push orderbook snapshot updates.

- `orderbook.<multiplier>`  
  Orderbook level aggregation topic, e.g.:
  - `orderbook.1`
  - `orderbook.5`
  - `orderbook.10`
  - `orderbook.50`
  - `orderbook.100`

- `trade`  
  Push latest trade price and quantity.

## 5. Server -> Client Message Format

All pushed messages share this envelope:

```json
{
  "type": "<ticker|candle|orderBook|trade>",
  "timestamp": 1774541400065,
  "...": "payload by type"
}
```

> Note: `type` for orderbook is currently `orderBook` (camel case).

### 5.1 Ticker

```json
{
  "type": "ticker",
  "timestamp": 1774541400065,
  "ticker": {
    "contract": "ETH_USDT",
    "lastPrice": 2973.6308,
    "highPrice": 3002.1132,
    "lowPrice": 2948.1021,
    "volume": 560.0000,
    "turnover": 1664578.1234,
    "tradeCount": 1234,
    "lastUpdateTs": 1774541400065
  }
}
```

### 5.2 Candle

```json
{
  "type": "candle",
  "timestamp": 1774541400065,
  "candle": {
    "contract": "ETH_USDT",
    "interval": "1m",
    "openTime": 1774541340000,
    "closeTime": 1774541399999,
    "open": 2975.0000,
    "high": 2978.2000,
    "low": 2970.8000,
    "close": 2973.6308,
    "volume": 15.0000,
    "turnover": 44604.4620,
    "tradeCount": 15
  }
}
```

### 5.3 OrderBook

```json
{
  "type": "orderBook",
  "timestamp": 1774541400065,
  "orderBook": {
    "contract": "ETH_USDT",
    "multiplier": 5,
    "levelStep": 0.5000,
    "bids": [
      { "price": 2973.5000, "quantity": 8.0000 }
    ],
    "asks": [
      { "price": 2974.0000, "quantity": 6.0000 }
    ]
  }
}
```

### 5.4 Trade (Latest Price + Quantity)

```json
{
  "type": "trade",
  "timestamp": 1774541400065,
  "trade": {
    "contract": "ETH_USDT",
    "price": 2973.6308,
    "quantity": 1.0000,
    "timestamp": 1774541400065
  }
}
```

## 6. Error/Invalid Message Handling

- Invalid JSON from client: ignored (server logs warning).
- Unknown op/action: ignored (server logs debug).
- Empty/invalid topic list: ignored.
- Send failure for a specific session: server removes that session.

## 7. Reconnect Recommendation

- Client should auto-reconnect with backoff (e.g. 1s, 2s, 5s, up to 30s).
- After reconnect, resend your subscribe commands (subscription state is per connection).

## 8. Minimal Client Example

```javascript
const ws = new WebSocket("ws://localhost:8082/ws/market");

ws.onopen = () => {
  ws.send(JSON.stringify({
    op: "subscribe",
    topics: ["trade", "orderbook.1"]
  }));
};

ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);
  console.log(msg.type, msg);
};
```

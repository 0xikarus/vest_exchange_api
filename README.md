TS wrapper around vest api

Orders
```js
async function makeLimitOrder(token: string, markPrice: string, size: string, isBuy: boolean, reduceOnly: boolean = false, tpsl?: {
    tp: string,
    sl: string
}) {
    const ttl = 5000;
    const order = await vest.createOrder({
        "symbol": token,
        "isBuy": isBuy,
        "size": size,
        "orderType": "LIMIT",
        "limitPrice": markPrice,
        "reduceOnly": reduceOnly,
        "nonce": Date.now(),
        "tpPrice": tpsl?.tp,
        "slPrice": tpsl?.sl,
    }, ttl)
    return order?.id;
}

async function makeMarketOrder(token: string, markPrice: string, size: string, isBuy: boolean, reduceOnly: boolean = false) {
    const ttl = 5000;
    const order = await vest.createOrder({
        "symbol": token,
        "isBuy": isBuy,
        "size": size,
        "orderType": "MARKET",
        "limitPrice": markPrice,
        "reduceOnly": reduceOnly,
        "nonce": Date.now(),
    }, ttl)
    return order?.id;
}

const orderId = await makeLimitOrder(tokenToTrade, (Number(markPrice) * 0.95).toFixed(3), minOrder.toFixed(3), true, false, {
    sl: (Number(markPrice) * 0.9).toFixed(3),
    tp: (Number(markPrice) * 1.1).toFixed(3)
});

// open and close using market order
const slippage = 0.05;
await makeMarketOrder(tokenToTrade, (Number(markPrice) * (1 + slippage)).toFixed(3), minOrder.toFixed(3), true);
await makeMarketOrder(tokenToTrade, (Number(markPrice) * (1 - slippage)).toFixed(3), minOrder.toFixed(3), false, true);

```
LP
```js
    await vest.createLPOrder({
        "nonce": Date.now(),
        "orderType": "DEPOSIT",
        "size": (100).toFixed(6),
    });
    
    await vest.createLPOrder({
        "nonce": Date.now(),
        "orderType": "IMMEDIATE_WITHDRAW",
        "size": (100).toFixed(6),
    });
```


```js
const account = await vest.getAccount();
const positions = account.positions;
```

```js
const tickerLatest = await vest.tickerLatest(["BTC-PERP"]);
const markPrice = tickerLatest.tickers[0].markPrice;
```

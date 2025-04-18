import {
    type Address,
    type Account,
    type Hex,
    encodeAbiParameters,
    keccak256,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import WebSocket from 'ws';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const makeDeferred = () => {
    var deferred: any = {};
    deferred.promise = new Promise((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
    });
    return deferred;
}

export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'LIQUIDATION';
export type OrderStatus = 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
export type SymbolStatus = 'TRADING' | 'HALT';
export type LpType = 'DEPOSIT' | 'IMMEDIATE_WITHDRAW' | 'SCHEDULE_WITHDRAW';
export type TransferType = 'DEPOSIT' | 'WITHDRAW';

export type NonceResponse = {
    "lastNonce": number
}
export type AccountResponse = {
    "address": string,
    "balances": [{
        "asset": string,
        "total": string,
        "locked": string
    }],
    "collateral": string,
    "withdrawable": string,
    "totalAccountValue": string,
    "openOrderMargin": string,
    "totalMaintMargin": string,
    "positions": {
        "symbol": string,
        "isLong": boolean,
        "size": string,
        "entryPrice": string,
        "entryFunding": string,
        "unrealizedPnl": string,
        "settledFunding": string,
        "markPrice": string,
        "indexPrice": string,
        "liqPrice": string,
        "initMargin": string,
        "maintMargin": string,
        "initMarginRatio": string
    }[],
    "leverages": { "symbol": string, "value": number }[],
    "lp": {
        "balance": string,
        "shares": string,
        "unrealizedPnl": string
    },
    "time": number,
    "twitterUsername": string | null,
    "discordUsername": string | null,
}

export type ExchangeInfoResponse = {
    "symbols": {
        "symbol": string,
        "displayName": string,
        "base": string,
        "quote": string,
        "sizeDecimals": number,
        "priceDecimals": number,
        "initMarginRatio": string,
        "maintMarginRatio": string,
        "takerFee": string,
    }[],
    "exchange": {
        "lp": string,
        "insurance": string,
        "collateralDecimals": number,
    },
}

export type TickerLatestResponse = {
    "tickers": {
        "symbol": string,
        "markPrice": string,
        "indexPrice": string,
        "imbalance": string,
        "oneHrFundingRate": string,
        "cumFunding": string,
        "status": SymbolStatus,
    }[]
}
export type Ticker24HrResponse = {
    "tickers": {
        "symbol": string,
        "openPrice": string,
        "closePrice": string,
        "highPrice": string,
        "lowPrice": string,
        "quoteVolume": string,
        "volume": string,
        "priceChange": string,
        "priceChangePercent": string,
        "openTime": number,
        "closeTime": number,
    }[]
}
export type FundingHistoryResponse = {
    "symbol": string,
    "time": number,
    "oneHrFundingRate": string,
}[]
export type KlineResponse = {
    "time": number,
    "open": string,
    "high": string,
    "low": string,
    "close": string,
    "closeTime": number,
    "volume": string,
    "quoteVolume": string,
    "numOfTrades": number
}

export type TradeResponse = {
    "id": number,
    "price": string,
    "qty": string,
    "quoteQty": string,
    "time": number,
}[]

export type LeverageResponse = {
    "symbol": string,
    "value": number
}

export type OrderResponse = {
    "id": string,
    "nonce": number,
    "symbol": string,
    "isBuy": boolean,
    "orderType": OrderType,
    "limitPrice": string,
    "markPrice": string,
    "size": string,
    "status": OrderStatus,
    "reduceOnly": boolean,
    "initMarginRatio": string,
    "code": string | null, // error code, specified only if status is REJECTED
    "lastFilledSize": string | null, // null if status != FILLED
    "lastFilledPrice": string | null, // null if status != FILLED
    "lastFilledTime": number | null, // null if status != FILLED
    "avgFilledPrice": string | null, // null if status != FILLED
    "settledFunding": string | null, // null if status != FILLED, positive means trader received
    "fees": string, // includes premium (and liquidation penalty if applicable)
    "realizedPnl": string | null, // null if status != FILLED, includes funding and fees
    "postTime": number,
    "tpPrice": string | null,
    "slPrice": string | null,
}[]


export type VestExchangeConfig = {
    privateKey: Hex;
    signingPrivateKey: Hex;
    apiKey?: string;
    accGroup?: number;
};

export class VestExchange {
    private signingAccount: Account;
    private account: Account;
    private baseUrl: string;
    private verifyingContract: Address;

    private accGroup?: number;
    private apiKey?: string;

    private ws: WebSocket | null = null;
    private wsCallbacks: Map<string, (data: any) => void> = new Map();
    private listenKey: string | null = null;
    private pingInterval: NodeJS.Timeout | null = null;

    private pendingSubscriptions: {
        id: number,
        promise: Promise<void>,
        handles: {
            resolve?: (...any: any) => void,
            reject?: (...any: any) => void
        }
    }[] = [];

    constructor(config: VestExchangeConfig) {
        this.baseUrl = "https://serverprod.vest.exchange/v2";
        this.verifyingContract = "0x919386306C47b2Fe1036e3B4F7C40D22D2461a23";

        this.account = privateKeyToAccount(config.privateKey);
        this.signingAccount = privateKeyToAccount(config.signingPrivateKey);

        if (config.apiKey && config.accGroup) {
            this.apiKey = config.apiKey;
            this.accGroup = config.accGroup;
        }


    }

    private async request<T>(
        method: string,
        endpoint: string,
        params?: any,
        isPrivate: boolean = false
    ): Promise<T> {
        let url = `${this.baseUrl}${endpoint}`;

        if (method === 'GET' && params) {
            const queryParams: string[] = [];
            Object.keys(params).forEach(key => {
                if (params[key] !== undefined) {
                    queryParams.push(`${encodeURIComponent(key)}=${encodeURIComponent(params[key].toString())}`);
                }
            });
            if (queryParams.length > 0) {
                url += `?${queryParams.join('&')}`;
            }
        }

        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };
        if (isPrivate && this.apiKey && (this.accGroup != undefined)) {
            headers['X-API-Key'] = this.apiKey;
            headers['xrestservermm'] = `restserver${this.accGroup}`
        }

        const options: RequestInit = {
            method,
            headers,
        };
        if (method !== 'GET' && params) {
            options.body = JSON.stringify(params);
        }
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorData = await response?.json();
            if (errorData?.detail != undefined) {
                throw (`Vest API error: ${errorData.detail?.msg} [${errorData.detail?.code}]`);
            }
            throw (`Vest API error: ${errorData.msg || response.statusText}`);
        }

        return response.json() as Promise<T>;
    }

    async register(): Promise<boolean> {
        if (this.apiKey && this.accGroup) {
            return true;
        }
        console.log("Registering signing key");
        const expiry = Math.floor(Date.now() / 1000) * 1000 + 7 * 24 * 60 * 60 * 1000;

        const domain = {
            name: 'VestRouterV2',
            version: '0.0.1',
            verifyingContract: this.verifyingContract
        };
        const types = {
            SignerProof: [
                { name: 'approvedSigner', type: 'address' },
                { name: 'signerExpiry', type: 'uint256' },
            ]
        };
        const proofArgs = {
            approvedSigner: this.signingAccount.address,
            signerExpiry: expiry
        };

        if (!this.account) throw new Error('Account not found');
        try {
            if (!this.account.signTypedData) throw new Error('Account does not support signTypedData');
            const signature = await this.account.signTypedData({
                domain,
                types,
                primaryType: 'SignerProof',
                message: proofArgs
            });

            const response = await this.request<{ apiKey: string, accGroup: number }>('POST', '/register', {
                "signingAddr": this.signingAccount.address.toLowerCase(),
                "primaryAddr": this.account.address.toLowerCase(),
                "signature": signature,
                "expiryTime": expiry,
                "networkType": 0
            }, false);

            this.accGroup = response.accGroup;
            this.apiKey = response.apiKey;
            return true;
        } catch (error) {
            console.error('Registration failed:', error);
            throw false;
        }
    }

    async getAccount(): Promise<AccountResponse> {
        const response = await this.request<AccountResponse>('GET', '/account', { time: Date.now() }, true);

        return response;
    }
    async getAccountNonce(): Promise<NonceResponse> {
        const response = await this.request<NonceResponse>('GET', '/account/nonce', { time: Date.now() }, true);
        console.log("nonce", response);
        return response;
    }

    async setAccountLeverage(symbol: string, value: number): Promise<LeverageResponse> {
        const response = await this.request<LeverageResponse>('POST', '/account/leverage', { time: Date.now(), symbol: symbol, value: value }, true);
        return response;
    }
    /* Orders */
    private async _signOrder(
        time: number,
        nonce: number,
        orderType: string,
        symbol: string,
        isBuy: boolean,
        size: string,
        limitPrice: string,
        reduceOnly: boolean
    ): Promise<Hex> {
        if (!this.signingAccount) throw new Error('signingAccount not found');
        if (!this.signingAccount.signMessage) throw new Error('signingAccount does not support signMessage');

        const args = encodeAbiParameters(
            [
                { name: 'time', type: 'uint256' },
                { name: 'nonce', type: 'uint256' },
                { name: 'orderType', type: 'string' },
                { name: 'symbol', type: 'string' },
                { name: 'isBuy', type: 'bool' },
                { name: 'size', type: 'string' },
                { name: 'limitPrice', type: 'string' },
                { name: 'reduceOnly', type: 'bool' }
            ],
            [BigInt(time), BigInt(nonce), orderType, symbol, isBuy, size, limitPrice, reduceOnly]
        )
        const hash = keccak256(args)
        const signature = await this.signingAccount.signMessage({ message: { raw: hash } })
        return signature;
    }


    async createOrder(
        order: {
            nonce: number,
            symbol: string,
            isBuy: boolean,
            size: string,
            orderType: OrderType,
            limitPrice: string,
            reduceOnly: boolean,
            timeInForce?: 'GTC' | 'FOK', // (optional str: only accepted when orderType == LIMIT, must be GTC or FOK),
            tpPrice?: string, // (optional str: can only be specified for LIMIT order),
            tpSignature?: string, // (optional str: should be produced by setting orderType = "TAKE_PROFIT", isBuy = opposite of parent LIMIT order, limitPrice = tpPrice and reduceOnly = True),
            slPrice?: string, // (optional str: can only be specified for LIMIT order),
            slSignature?: string // (optional str: should be produced by setting orderType = "STOP_LOSS", isBuy = opposite of parent LIMIT order, limitPrice = slPrice and reduceOnly = True),
        },
        ttl: number = 10000,
    ): Promise<{
        "id": string
    }> {
        const time = Date.now();
        const signature = await this._signOrder(time, order.nonce, order.orderType, order.symbol, order.isBuy, order.size, order.limitPrice, order.reduceOnly);

        if (order.tpPrice != undefined) {
            console.log("signing tp");
            order.tpSignature = await this._signOrder(time, order.nonce + 1, "TAKE_PROFIT", order.symbol, !order.isBuy, order.size, order.tpPrice, true);
        }
        if (order.slPrice != undefined) {
            console.log("signing sl");
            order.slSignature = await this._signOrder(time, order.nonce + 2, "STOP_LOSS", order.symbol, !order.isBuy, order.size, order.slPrice, true);
        }

        const response = await this.request<any>('POST', '/orders', {
            "order": { time: time, ...order },
            "recvWindow": ttl,
            "signature": signature,
        }, true);
        return response;
    }

    async cancelOrder(
        order: {
            id: string,
            nonce: number,
        },
        ttl: number = 10000,
    ): Promise<any> {
        if (!this.signingAccount) throw new Error('signingAccount not found');
        if (!this.signingAccount.signMessage) throw new Error('signingAccount does not support signMessage');
        const now = Date.now();
        const args = encodeAbiParameters(
            [
                { name: 'time', type: 'uint256' },
                { name: 'nonce', type: 'uint256' },
                { name: 'id', type: 'string' }
            ],
            [BigInt(now), BigInt(order.nonce), order.id]
        )

        const hash = keccak256(args)
        const signature = await this.signingAccount.signMessage({ message: { raw: hash } })

        const response = await this.request<any>('POST', '/orders/cancel', {
            "order": {
                "id": order.id,
                "nonce": order.nonce,
                "time": now,
            },
            "recvWindow": ttl, // (optional int: defaults to 5000; server will discard if server ts > time + recvWindow)
            "signature": signature, // NOTE: make sure this starts with 0x
        }, true);
        console.log("cancel response", response);
        return response;
    }
    async getOrders(
        filter: {
            id?: string,
            nonce?: number,
            symbol?: string,
            orderType?: OrderType,
            status?: OrderStatus,
            startTime?: number,
            endTime?: number,
            limit?: number
        }
    ): Promise<OrderResponse> {
        const response = await this.request<OrderResponse>('GET', '/orders', { ...filter, time: Date.now() }, true);
        return response;
    }
    /* LP */
    async createLPOrder(
        order: {
            "nonce": number,
            "orderType": LpType,
            "size": string,
        }
    ): Promise<OrderResponse> {
        if (!this.signingAccount) throw new Error('signingAccount not found');
        if (!this.signingAccount.signMessage) throw new Error('signingAccount does not support signMessage');
        const ttl = 5000;
        const now = Date.now();
        const args = encodeAbiParameters(
            [
                { name: 'time', type: 'uint256' },
                { name: 'nonce', type: 'uint256' },
                { name: 'orderType', type: 'string' },
                { name: 'size', type: 'string' }
            ],
            [BigInt(now), BigInt(order.nonce), order.orderType, order.size]
        )

        const hash = keccak256(args)
        const signature = await this.signingAccount.signMessage({ message: { raw: hash } })

        const response = await this.request<any>('POST', '/lp', {
            "order": {
                "time": now,
                "nonce": order.nonce,
                "orderType": order.orderType,
                "size": order.size,
            },
            "recvWindow": ttl,
            "signature": signature,
        }, true);

        return response;
    }

    async getLPOrders(
        filter: {
            id?: string,
            nonce?: number,
            orderType?: OrderType,
            status?: OrderStatus,
            startTime?: number,
            endTime?: number,
            limit?: number
        }
    ): Promise<OrderResponse> {
        const response = await this.request<OrderResponse>('GET', '/lp', { ...filter, time: Date.now() }, true);
        return response;
    }
    /* Transfer */
    async withdraw(
        order: {
            "nonce": number,
            "recipient": Address,
            "token": string,
            "size": string,
            "chainId": number,
        },
        receiveToken: Address
    ): Promise<OrderResponse> {
        if (!this.signingAccount) throw new Error('signingAccount not found');
        if (!this.signingAccount.signMessage) throw new Error('signingAccount does not support signMessage');
        const ttl = 5000;
        const now = Date.now();
        const account = this.account.address;

        const args = encodeAbiParameters(
            [
                { name: 'time', type: 'uint256' },
                { name: 'nonce', type: 'uint256' },
                { name: 'false', type: 'bool' },
                { name: 'account', type: 'address' },
                { name: 'recipient', type: 'address' },
                { name: 'token', type: 'address' },
                { name: 'size', type: 'uint256' },
                { name: 'chainId', type: 'uint256' }
            ],
            [BigInt(now), BigInt(order.nonce), false, account, order.recipient, receiveToken as any, BigInt(order.size), BigInt(order.chainId)]
        )

        const hash = keccak256(args)
        const signature = await this.signingAccount.signMessage({ message: { raw: hash } })

        const response = await this.request<any>('POST', '/transfer/withdraw', {
            order: {
                "time": now,
                ...order
            },
            "recvWindow": ttl,
            "signature": signature,
        }, true);

        return response;
    }

    async getTransfers(
        filter: {
            id?: string,
            nonce?: number,
            orderType?: OrderType,
            status?: OrderStatus,
            startTime?: number,
            endTime?: number,
            limit?: number
        }
    ): Promise<OrderResponse> {
        const response = await this.request<OrderResponse>('GET', '/transfer', { ...filter, time: Date.now() }, true);
        return response;
    }

    // market getters
    async exchangeInfo(symbols: string[]): Promise<ExchangeInfoResponse> {
        const response = await this.request<ExchangeInfoResponse>('GET', '/exchangeInfo', { symbols: symbols.join(',') }, false);
        return response;
    }
    async tickerLatest(symbols: string[]): Promise<TickerLatestResponse> {
        const response = await this.request<TickerLatestResponse>('GET', '/ticker/latest', { symbols: symbols.join(',') }, false);
        return response;
    }
    async ticker24Hr(symbols: string[]): Promise<Ticker24HrResponse> {
        const response = await this.request<Ticker24HrResponse>('GET', '/ticker/24hr', { symbols: symbols.join(',') }, false);
        return response;
    }
    async fundingHistory(
        filter: {
            symbol: string,
            startTime?: number,
            endTime?: number,
            limit?: number,
            interval?: number
        }
    ): Promise<FundingHistoryResponse> {
        const response = await this.request<FundingHistoryResponse>('GET', '/fundingHistory', filter, false);
        return response;
    }
    async klines(
        symbol: string,
        startTime?: number,
        endTime?: number,
        limit?: number,
        interval?: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M'
    ): Promise<KlineResponse[]> {
        const response = await this.request<[
            number, // open time
            string, // o
            string, // h
            string, // l
            string, // c
            number, // close time
            string, // v
            string, // quote v
            number, // num of trades
        ][]>('GET', '/klines', {
            symbol: symbol,
            startTime: startTime,
            endTime: endTime,
            limit: limit,
            interval: interval
        }, false);
        const formattedKlines = response.map((kline) => {
            return {
                time: kline[0],
                open: kline[1],
                high: kline[2],
                low: kline[3],
                close: kline[4],
                closeTime: kline[5],
                volume: kline[6],
                quoteVolume: kline[7],
                numOfTrades: kline[8],
            }
        })

        return formattedKlines;
    }

    async trades(symbol: string,
        startTime?: number,
        endTime?: number,
        limit?: number
    ): Promise<TradeResponse> {
        const response = await this.request<TradeResponse>('GET', '/trades', {
            symbol: symbol,
            startTime: startTime,
            endTime: endTime,
            limit: limit
        }, false);
        return response;
    }

    async depth(symbol: string,
        limit?: number
    ): Promise<TradeResponse> {
        const response = await this.request<TradeResponse>('GET', '/depth', {
            symbol: symbol,
            limit: limit
        }, false);
        return response;
    }

    async setupWebSocket(isPrivate: boolean = false): Promise<boolean> {
        if (isPrivate && !this.listenKey) {
            await this.getListenKey();
        }

        return new Promise((resolve, reject) => {
            try {
                const baseUrl = "wss://wsprod.vest.exchange/ws-api?version=1.0";
                const url = isPrivate
                    ? `${baseUrl}&xwebsocketserver=restserver${this.accGroup}&listenKey=${this.listenKey}`
                    : `${baseUrl}&xwebsocketserver=restserver${this.accGroup}`;

                const wsInstance = new WebSocket(url);

                wsInstance.on('open', () => {
                    console.log(`WebSocket connected`);
                    this.ws = wsInstance;
                    this.startPingInterval();
                    resolve(true);
                });

                wsInstance.on('message', (data) => {
                    const parsedData = JSON.parse(data.toString());
                    if (parsedData?.result == null && parsedData?.id != null) {
                        const foundHandles = this.pendingSubscriptions.findIndex(p => p.id == parsedData.id);
                        if (foundHandles != -1) {
                            this.pendingSubscriptions[foundHandles].handles.resolve?.();
                            this.pendingSubscriptions.splice(foundHandles, 1);
                        }
                    }

                    if (parsedData.data === "pong") {
                        return;
                    }
                    if (parsedData.channel) {
                        const callback = this.wsCallbacks.get(parsedData.channel);
                        if (callback) {
                            callback(parsedData.data);
                        }
                    }
                });

                wsInstance.on('error', (error) => {
                    console.error(`WebSocket error:`, error);
                    reject(error);
                });

                wsInstance.on('close', () => {
                    console.log(`WebSocket disconnected`);

                    setTimeout(() => {
                        this.setupWebSocket(isPrivate);
                    }, 5000);
                });
            } catch (error) {
                console.error('WebSocket connection error:', error);
                reject(error);
            }
        });
    }

    private startPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        console.log("pinging");
        this.ping();
        this.pingInterval = setInterval(() => {
            this.ping();
        }, 30000);
    }

    closeWebSocket(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    ping(id: number = 0): void {
        if (!this.ws) {
            throw new Error('WebSocket not connected');
        }
        this.ws.send(JSON.stringify({
            method: "PING",
            params: [],
            id: id
        }));
    }

    async subscribe(channels: string[], isPrivate: boolean = false) {
        const ws = this.ws;
        if (!ws) {
            throw new Error(`WebSocket not connected`);
        }
        await sleep(2);
        const id = Date.now();
        const promise = makeDeferred();

        this.pendingSubscriptions.push({
            id: id,
            promise: promise,
            handles: { resolve: promise.resolve, reject: promise.reject }
        });
        ws.send(JSON.stringify({
            method: "SUBSCRIBE",
            params: channels,
            id: id
        }));
        await promise.promise;
    }

    async unsubscribe(channels: string[], isPrivate: boolean = false): Promise<void> {
        if (!this.ws) {
            throw new Error(`WebSocket not connected`);
        }
        await sleep(2);
        const id = Date.now();
        const promise = makeDeferred();

        this.pendingSubscriptions.push({
            id: id,
            promise: promise,
            handles: { resolve: promise.resolve, reject: promise.reject }
        });

        this.ws.send(JSON.stringify({
            method: "UNSUBSCRIBE",
            params: channels,
            id: id
        }));
        await promise.promise;
    }

    async subscribeTickers(callback: (data: {
        "symbol": string,
        "oneHrFundingRate": string,
        "cumFunding": string,
        "imbalance": string,
        "indexPrice": string,
        "markPrice": string,
        "priceChange": string,
        "priceChangePercent": string,
    }[]) => void): Promise<void> {
        this.wsCallbacks.set("tickers", callback);
        await this.subscribe(["tickers"]);
    }

    async subscribeKlines(symbol: string, interval: string, callback: (data: [
        number,
        string,
        string,
        string,
        string,
        number,
        string,
        string,
        string
    ]) => void): Promise<void> {
        const channel = `${symbol}@kline_${interval}`;
        this.wsCallbacks.set(channel, callback);
        await this.subscribe([channel]);
    }

    async subscribeDepth(symbol: string, callback: (data: {
        "bids": [string, string][],
        "asks": [string, string][]
    }) => void): Promise<void> {
        const channel = `${symbol}@depth`;
        this.wsCallbacks.set(channel, callback);
        await this.subscribe([channel]);
    }

    async subscribeTrades(symbol: string, callback: (data: {
        "id": string,
        "price": string,
        "qty": string,
        "quoteQty": string,
        "time": number
    }) => void): Promise<void> {
        const channel = `${symbol}@trades`;
        this.wsCallbacks.set(channel, callback);
        await this.subscribe([channel]);
    }

    async getListenKey(): Promise<string> {
        const response = await this.request<{ listenKey: string }>('POST', '/account/listenKey', {}, true);
        this.listenKey = response.listenKey;
        return this.listenKey;
    }

    async extendListenKey(): Promise<string> {
        const response = await this.request<{ listenKey: string }>('PUT', '/account/listenKey', {}, true);
        this.listenKey = response.listenKey;
        return this.listenKey;
    }

    async deleteListenKey(): Promise<void> {
        await this.request<{}>('DELETE', '/account/listenKey', {}, true);
        this.listenKey = null;
    }

    async subscribeAccountUpdates(callback: (data: any) => void): Promise<void> {
        if (!this.ws) {
            throw new Error('Private WebSocket not connected');
        }

        this.wsCallbacks.set("account_private", callback);
        await this.subscribe(["account_private"], true);
    }
}

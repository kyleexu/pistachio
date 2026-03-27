import { CandlestickSeries, createChart, HistogramSeries } from "lightweight-charts";
import "./style.css";

const DEFAULT_WS_URL = "ws://localhost:8082/ws/market";
const DEFAULT_ORDERBOOK_MULTIPLIER = 10;
const ORDERBOOK_TOPICS_ALL = ["orderbook", "orderbook.1", "orderbook.5", "orderbook.10", "orderbook.50", "orderbook.100"];

const CHART_THEMES = {
  dark: {
    background: "#0d141f",
    textColor: "#cbd5e1",
    gridColor: "#1f2937",
    upColor: "#26a69a",
    downColor: "#ef5350",
    volumeUp: "rgba(38,166,154,0.6)",
    volumeDown: "rgba(239,83,80,0.6)",
  },
  light: {
    background: "#ffffff",
    textColor: "#334155",
    gridColor: "#d8e0e8",
    upColor: "#16a34a",
    downColor: "#dc2626",
    volumeUp: "rgba(22,163,74,0.35)",
    volumeDown: "rgba(220,38,38,0.35)",
  },
};

function getInitialTheme() {
  const saved = window.localStorage.getItem("pistachio-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

document.querySelector("#app").innerHTML = `
  <div class="terminal">
    <header class="topbar">
      <div class="pair-title">
        <strong id="tickerContract">-</strong>
        <span class="hint">Realtime market board</span>
      </div>
      <div class="top-stats">
        <div><span>Last</span><strong id="tickerLast">-</strong></div>
        <div><span>Bid</span><strong id="tickerBid">-</strong></div>
        <div><span>Ask</span><strong id="tickerAsk">-</strong></div>
        <div><span>Volume</span><strong id="tickerVolume">-</strong></div>
        <div><span>24h High</span><strong id="tickerHigh">-</strong></div>
        <div><span>24h Low</span><strong id="tickerLow">-</strong></div>
        <div><span>24h Chg%</span><strong id="tickerChange">-</strong></div>
      </div>
      <div class="toolbar">
        <select id="pairSelect"><option value="">Auto</option></select>
        <select id="multiplierSelect" aria-label="Orderbook Multiplier">
          <option value="1">OB x1</option>
          <option value="5">OB x5</option>
          <option value="10" selected>OB x10</option>
          <option value="50">OB x50</option>
          <option value="100">OB x100</option>
        </select>
        <select id="themeSelect" aria-label="Theme">
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>
    </header>

    <div class="workspace">
      <section class="panel chart-panel">
        <div class="content-header">
          <h2>Candle</h2>
          <div class="intervals">
            <button class="interval-btn active" data-interval="1m">1m</button>
            <button class="interval-btn" data-interval="5m">5m</button>
            <button class="interval-btn" data-interval="15m">15m</button>
            <button class="interval-btn" data-interval="1h">1h</button>
          </div>
        </div>
        <div class="candle-wrap">
          <div class="price-pane">
            <div id="priceChart" class="chart-canvas"></div>
          </div>
          <div class="volume-pane">
            <div id="volumeChart" class="chart-canvas"></div>
          </div>
        </div>
      </section>

      <section class="panel orderbook-panel">
        <header class="book-header">
          <h3 id="bookContract">-</h3>
          <small id="bookMeta" class="book-meta">-</small>
        </header>
        <div class="orderbook-content">
          <div class="book-columns">
            <div class="book-side">
              <table>
                <thead>
                  <tr><th>Price</th><th>Qty</th></tr>
                </thead>
                <tbody id="asksBody" class="asks-body"></tbody>
              </table>
            </div>
            <div class="midline">
              <span>Mid</span><strong id="midPrice">-</strong>
              <span>Spread</span><strong id="spreadValue">-</strong>
            </div>
            <div class="book-side">
              <table>
                <thead>
                  <tr><th>Price</th><th>Qty</th></tr>
                </thead>
                <tbody id="bidsBody" class="bids-body"></tbody>
              </table>
            </div>
          </div>
          <div class="trade-block">
            <h4>Recent Trades</h4>
            <table>
              <thead>
                <tr><th>Time</th><th>Price</th><th>Qty</th></tr>
              </thead>
              <tbody id="tradesBody"></tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  </div>
`;

const state = {
  ws: null,
  depth: 10,
  theme: getInitialTheme(),
  selectedMultiplier: DEFAULT_ORDERBOOK_MULTIPLIER,
  selectedPair: "",
  pairSet: new Set(),
  booksRawByContract: new Map(),
  tickerRawByContract: new Map(),
  candleBarsByContract: new Map(),
  tradesByContract: new Map(),
  priceChart: null,
  volumeChart: null,
  candleSeries: null,
  volumeSeries: null,
  syncingTimeRange: false,
  syncingCrosshair: false,
  subscribedTopics: new Set(),
  selectedInterval: "1m",
};

const el = {
  pairSelect: document.getElementById("pairSelect"),
  multiplierSelect: document.getElementById("multiplierSelect"),
  themeSelect: document.getElementById("themeSelect"),
  tickerContract: document.getElementById("tickerContract"),
  tickerLast: document.getElementById("tickerLast"),
  tickerBid: document.getElementById("tickerBid"),
  tickerAsk: document.getElementById("tickerAsk"),
  tickerVolume: document.getElementById("tickerVolume"),
  tickerHigh: document.getElementById("tickerHigh"),
  tickerLow: document.getElementById("tickerLow"),
  tickerChange: document.getElementById("tickerChange"),
  priceChart: document.getElementById("priceChart"),
  volumeChart: document.getElementById("volumeChart"),
  intervalBtns: Array.from(document.querySelectorAll(".interval-btn")),
  bookContract: document.getElementById("bookContract"),
  bookMeta: document.getElementById("bookMeta"),
  bidsBody: document.getElementById("bidsBody"),
  asksBody: document.getElementById("asksBody"),
  tradesBody: document.getElementById("tradesBody"),
  midPrice: document.getElementById("midPrice"),
  spreadValue: document.getElementById("spreadValue"),
};

function getPaneSize(target) {
  return {
    width: Math.max(target.clientWidth, 320),
    height: Math.max(target.clientHeight, 80),
  };
}

function getChartTheme() {
  return CHART_THEMES[state.theme] || CHART_THEMES.dark;
}

function barByTime(rawTime) {
  const pair = selectedPair();
  const bars = state.candleBarsByContract.get(pair) || [];
  const t = Number(rawTime);
  if (!Number.isFinite(t)) return null;
  return bars.find((b) => b.time === t) || null;
}

function syncCrosshair(sourceChart, targetChart, targetSeries, valueResolver) {
  sourceChart.subscribeCrosshairMove((param) => {
    if (state.syncingCrosshair) return;
    state.syncingCrosshair = true;
    if (param && param.time != null) {
      const value = valueResolver(param.time);
      if (typeof targetChart.setCrosshairPosition === "function") {
        targetChart.setCrosshairPosition(value, param.time, targetSeries);
      }
    } else if (typeof targetChart.clearCrosshairPosition === "function") {
      targetChart.clearCrosshairPosition();
    }
    state.syncingCrosshair = false;
  });
}

function updateChartTheme() {
  if (!state.priceChart || !state.volumeChart || !state.candleSeries || !state.volumeSeries) return;
  const theme = getChartTheme();

  state.priceChart.applyOptions({
    layout: {
      background: { color: theme.background },
      textColor: theme.textColor,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: theme.gridColor },
      horzLines: { color: theme.gridColor },
    },
    rightPriceScale: {
      borderColor: theme.gridColor,
    },
    timeScale: {
      borderColor: theme.gridColor,
    },
  });

  state.volumeChart.applyOptions({
    layout: {
      background: { color: theme.background },
      textColor: theme.textColor,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: theme.gridColor },
      horzLines: { color: theme.gridColor },
    },
    rightPriceScale: {
      borderColor: theme.gridColor,
    },
    timeScale: {
      borderColor: theme.gridColor,
      ticksVisible: true,
    },
  });

  state.candleSeries.applyOptions({
    upColor: theme.upColor,
    downColor: theme.downColor,
    wickUpColor: theme.upColor,
    wickDownColor: theme.downColor,
  });
  setCandleSeriesForPair(selectedPair());
}

function applyTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.colorScheme = state.theme;
  window.localStorage.setItem("pistachio-theme", state.theme);
  if (el.themeSelect) el.themeSelect.value = state.theme;
  updateChartTheme();
}

function initCandleCharts() {
  const priceSize = getPaneSize(el.priceChart);
  const volumeSize = getPaneSize(el.volumeChart);
  const theme = getChartTheme();

  const priceChart = createChart(el.priceChart, {
    width: priceSize.width,
    height: priceSize.height,
    layout: {
      background: { color: theme.background },
      textColor: theme.textColor,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: theme.gridColor },
      horzLines: { color: theme.gridColor },
    },
    rightPriceScale: {
      visible: true,
      borderVisible: true,
      borderColor: theme.gridColor,
      entireTextOnly: true,
      minimumWidth: 132,
      scaleMargins: { top: 0.08, bottom: 0.04 },
    },
    leftPriceScale: { visible: false },
    timeScale: {
      visible: false,
      borderVisible: true,
      borderColor: theme.gridColor,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 14,
      minBarSpacing: 6,
    },
    crosshair: {
      vertLine: {
        labelVisible: false,
      },
    },
  });

  const volumeChart = createChart(el.volumeChart, {
    width: volumeSize.width,
    height: volumeSize.height,
    layout: {
      background: { color: theme.background },
      textColor: theme.textColor,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: theme.gridColor },
      horzLines: { color: theme.gridColor },
    },
    rightPriceScale: {
      visible: true,
      borderVisible: true,
      borderColor: theme.gridColor,
      minimumWidth: 132,
      autoScale: true,
      scaleMargins: { top: 0.08, bottom: 0.08 },
    },
    leftPriceScale: { visible: false },
    handleScale: {
      axisPressedMouseMove: {
        price: false,
        time: true,
      },
      mouseWheel: true,
      pinch: true,
    },
    timeScale: {
      visible: true,
      borderVisible: true,
      borderColor: theme.gridColor,
      ticksVisible: true,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 14,
      minBarSpacing: 6,
    },
    crosshair: {
      vertLine: {
        labelVisible: true,
      },
    },
  });

  const series = priceChart.addSeries(CandlestickSeries, {
    upColor: theme.upColor,
    downColor: theme.downColor,
    borderVisible: false,
    wickUpColor: theme.upColor,
    wickDownColor: theme.downColor,
  });

  const volumeSeries = volumeChart.addSeries(HistogramSeries, {
    priceFormat: { type: "volume" },
    priceScaleId: "right",
    autoscaleInfoProvider: (original) => {
      const info = original();
      if (!info || !info.priceRange) return info;
      return {
        ...info,
        priceRange: {
          minValue: 0,
          maxValue: Math.max(1, info.priceRange.maxValue),
        },
      };
    },
  });

  volumeSeries.priceScale().applyOptions({
    autoScale: true,
  });

  priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (!range || state.syncingTimeRange) return;
    state.syncingTimeRange = true;
    volumeChart.timeScale().setVisibleLogicalRange(range);
    state.syncingTimeRange = false;
  });

  volumeChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (!range || state.syncingTimeRange) return;
    state.syncingTimeRange = true;
    priceChart.timeScale().setVisibleLogicalRange(range);
    state.syncingTimeRange = false;
  });

  syncCrosshair(priceChart, volumeChart, volumeSeries, (time) => {
    const bar = barByTime(time);
    return Number(bar?.volume ?? 0);
  });

  syncCrosshair(volumeChart, priceChart, series, (time) => {
    const bar = barByTime(time);
    return Number(bar?.close ?? 0);
  });

  const priceObserver = new ResizeObserver(() => {
    const next = getPaneSize(el.priceChart);
    priceChart.applyOptions({ width: next.width, height: next.height });
  });
  priceObserver.observe(el.priceChart);

  const volumeObserver = new ResizeObserver(() => {
    const next = getPaneSize(el.volumeChart);
    volumeChart.applyOptions({ width: next.width, height: next.height });
  });
  volumeObserver.observe(el.volumeChart);

  state.priceChart = priceChart;
  state.volumeChart = volumeChart;
  state.candleSeries = series;
  state.volumeSeries = volumeSeries;
}
initCandleCharts();

function now() {
  return new Date().toLocaleTimeString();
}

function log(message) {
  console.log(`[${now()}] ${message}`);
}

function getCandleTopic(interval = state.selectedInterval) {
  return `candle.${normalizeIntervalName(interval) || "1m"}`;
}

function getOrderbookTopic(multiplier = state.selectedMultiplier) {
  return `orderbook.${multiplier}`;
}

function getDesiredTopics() {
  return ["ticker", "trade", getCandleTopic(), getOrderbookTopic()];
}

function sendTopicCommand(op, topics) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN || !topics.length) return;
  state.ws.send(JSON.stringify({ op, topics }));
  log(`${op} topics=${JSON.stringify(topics)}`);
}

function syncSubscriptions({ resetDefaultOrderbook = false } = {}) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

  const desiredTopics = getDesiredTopics();
  const desiredSet = new Set(desiredTopics);
  const unsubscribeTopics = Array.from(state.subscribedTopics).filter((topic) => !desiredSet.has(topic));
  const subscribeTopics = desiredTopics.filter((topic) => !state.subscribedTopics.has(topic));

  if (resetDefaultOrderbook) {
    // Defensive reset: clear all possible orderbook streams before subscribing current multiplier.
    sendTopicCommand("unsubscribe", ORDERBOOK_TOPICS_ALL);
  }
  if (unsubscribeTopics.length) {
    sendTopicCommand("unsubscribe", unsubscribeTopics);
  }
  if (subscribeTopics.length) {
    sendTopicCommand("subscribe", subscribeTopics);
  }

  state.subscribedTopics = desiredSet;
}

function normalizeType(rawType) {
  return String(rawType || "").trim().toLowerCase().replaceAll("_", "").replaceAll("-", "");
}

function fmtNum(v, digits = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatTs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return "-";
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  const pad2 = (v) => String(v).padStart(2, "0");
  const pad3 = (v) => String(v).padStart(3, "0");
  const yyyy = d.getFullYear();
  const MM = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const HH = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  const SSS = pad3(d.getMilliseconds());
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}.${SSS}`;
}

function registerPair(contract) {
  if (!contract || state.pairSet.has(contract)) return;
  state.pairSet.add(contract);
  const option = document.createElement("option");
  option.value = contract;
  option.textContent = contract;
  el.pairSelect.appendChild(option);
  if (!state.selectedPair) {
    state.selectedPair = contract;
    el.pairSelect.value = contract;
    renderSelectedPair();
  }
}

function selectedPair() {
  if (state.selectedPair) return state.selectedPair;
  const first = state.pairSet.values().next().value;
  return first || "";
}

function connect() {
  const url = DEFAULT_WS_URL;
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    log("Already connected");
    return;
  }

  if (state.ws && state.ws.readyState === WebSocket.CONNECTING) {
    return;
  }

  state.ws = new WebSocket(url);

  state.ws.onopen = () => {
    state.subscribedTopics = new Set();
    log(`connected: ${url}`);
    syncSubscriptions({ resetDefaultOrderbook: true });
  };

  state.ws.onmessage = (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      log(`non-json: ${String(event.data).slice(0, 120)}`);
      return;
    }

    const messageType = normalizeType(payload.type);

    if (messageType === "orderbook") {
      renderOrderbook(payload.orderBook || {});
      return;
    }
    if (messageType === "ticker") {
      renderTicker(payload.ticker || {});
      return;
    }
    if (messageType === "candle") {
      renderCandle(payload.candle || {}, payload.timestamp);
      return;
    }
    if (messageType === "trade") {
      renderTrade(payload.trade || {});
      return;
    }

    log(`${messageType || "unknown"}: ${event.data.slice(0, 180)}`);
  };

  state.ws.onerror = () => {
    log("websocket error");
  };

  state.ws.onclose = () => {
    log("disconnected");
    state.subscribedTopics = new Set();
    state.ws = null;
  };
}

function ensureRowCount(tbody, count) {
  while (tbody.rows.length < count) {
    const tr = document.createElement("tr");
    const priceTd = document.createElement("td");
    const qtyTd = document.createElement("td");
    tr.append(priceTd, qtyTd);
    tbody.appendChild(tr);
  }
  while (tbody.rows.length > count) {
    tbody.deleteRow(tbody.rows.length - 1);
  }
}

function renderRows(tbody, rows, side, maxQty, depth, alignToBottom = false) {
  ensureRowCount(tbody, depth);
  const n = rows.length;
  for (let i = 0; i < depth; i += 1) {
    const tr = tbody.rows[i];
    const priceTd = tr.cells[0];
    const qtyTd = tr.cells[1];
    let row = null;
    if (alignToBottom) {
      const start = depth - n;
      if (i >= start) {
        const j = i - start;
        row = rows[n - 1 - j] || null;
      }
    } else {
      row = rows[i] || null;
    }
    if (!row) {
      priceTd.textContent = "";
      qtyTd.textContent = "";
      qtyTd.style.background = "transparent";
      continue;
    }
    const qty = Number(row.quantity || 0);
    const width = maxQty > 0 ? Math.max(3, (qty / maxQty) * 100) : 0;
    priceTd.textContent = fmtNum(row.price, 8);
    qtyTd.textContent = fmtNum(qty, 8);
    qtyTd.style.background = side === "ask"
      ? `linear-gradient(to left, rgba(255,100,120,0.22) ${width}%, transparent ${width}%)`
      : `linear-gradient(to left, rgba(40,207,131,0.22) ${width}%, transparent ${width}%)`;
  }
}

function renderOrderbook(book) {
  const contract = book.contract || "UNKNOWN";
  registerPair(contract);
  state.booksRawByContract.set(contract, {
    timestamp: Number(book.timestamp || Date.now()),
    multiplier: book.multiplier,
    levelStep: book.levelStep,
    bids: Array.isArray(book.bids) ? book.bids : [],
    asks: Array.isArray(book.asks) ? book.asks : [],
  });
  if (contract === selectedPair()) renderOrderbookByContract(contract);
}

function renderOrderbookByContract(contract) {
  const raw = state.booksRawByContract.get(contract);
  if (!raw) {
    el.bookContract.textContent = contract || "-";
    el.bookMeta.textContent = "-";
    el.bidsBody.innerHTML = "";
    el.asksBody.innerHTML = "";
    return;
  }
  const asks = raw.asks
    .slice()
    .sort((a, b) => Number(a.price || 0) - Number(b.price || 0))
    .slice(0, state.depth);
  const bids = raw.bids
    .slice()
    .sort((a, b) => Number(b.price || 0) - Number(a.price || 0))
    .slice(0, state.depth);
  el.bookContract.textContent = contract;
  const maxBidQty = Math.max(0, ...bids.map((x) => Number(x.quantity || 0)));
  const maxAskQty = Math.max(0, ...asks.map((x) => Number(x.quantity || 0)));
  renderRows(el.bidsBody, bids, "bid", maxBidQty, state.depth, false);
  renderRows(el.asksBody, asks, "ask", maxAskQty, state.depth, true);
  const bestAsk = asks[0]?.price;
  const bestBid = bids[0]?.price;

  // Keep topbar BID/ASK synced with orderbook best levels.
  el.tickerBid.textContent = Number.isFinite(Number(bestBid)) ? fmtNum(bestBid, 8) : "-";
  el.tickerAsk.textContent = Number.isFinite(Number(bestAsk)) ? fmtNum(bestAsk, 8) : "-";

  const mid = Number.isFinite(Number(bestAsk)) && Number.isFinite(Number(bestBid))
    ? (Number(bestAsk) + Number(bestBid)) / 2
    : null;
  const spread = Number.isFinite(Number(bestAsk)) && Number.isFinite(Number(bestBid))
    ? Number(bestAsk) - Number(bestBid)
    : null;
  el.midPrice.textContent = mid == null ? "-" : fmtNum(mid, 8);
  el.spreadValue.textContent = spread == null ? "-" : fmtNum(spread, 8);
  el.bookMeta.textContent = `ts=${formatTs(raw.timestamp)} multiplier=${raw.multiplier ?? "-"} step=${raw.levelStep ?? "-"} depth=${state.depth}`;
}

function renderTicker(ticker) {
  const contract = ticker.contract || "UNKNOWN";
  registerPair(contract);
  state.tickerRawByContract.set(contract, {
    lastPrice: ticker.lastPrice,
    bidPrice: ticker.bidPrice,
    askPrice: ticker.askPrice,
    volume: ticker.volume,
    high24h: ticker.highPrice ?? ticker.high24h ?? ticker.high,
    low24h: ticker.lowPrice ?? ticker.low24h ?? ticker.low,
    change24h: ticker.changePercent24h ?? ticker.priceChangePercent ?? ticker.changePercent,
  });
  if (contract === selectedPair()) {
    el.tickerContract.textContent = contract;
    el.tickerLast.textContent = fmtNum(ticker.lastPrice, 8);
    el.tickerBid.textContent = fmtNum(ticker.bidPrice, 8);
    el.tickerAsk.textContent = fmtNum(ticker.askPrice, 8);
    el.tickerVolume.textContent = fmtNum(ticker.volume, 4);
    el.tickerHigh.textContent = fmtNum(ticker.highPrice ?? ticker.high24h ?? ticker.high, 8);
    el.tickerLow.textContent = fmtNum(ticker.lowPrice ?? ticker.low24h ?? ticker.low, 8);
    const ch = Number(ticker.changePercent24h ?? ticker.priceChangePercent ?? ticker.changePercent);
    el.tickerChange.textContent = Number.isFinite(ch) ? `${ch.toFixed(2)}%` : "-";
  }
}

function renderTrade(trade) {
  const contract = trade.contract || "UNKNOWN";
  registerPair(contract);
  let arr = state.tradesByContract.get(contract);
  if (!arr) {
    arr = [];
    state.tradesByContract.set(contract, arr);
  }
  arr.unshift({
    price: Number(trade.price ?? 0),
    quantity: Number(trade.quantity ?? 0),
    timestamp: Number(trade.timestamp ?? Date.now()),
  });
  if (arr.length > 60) arr.length = 60;
  if (contract === selectedPair()) renderTrades(contract);
}

function fmtTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return "-";
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms).toLocaleTimeString();
}

function renderTrades(contract) {
  const list = (state.tradesByContract.get(contract) || []).slice(0, 20);
  el.tradesBody.innerHTML = "";
  for (const t of list) {
    const tr = document.createElement("tr");
    const tdTime = document.createElement("td");
    const tdPrice = document.createElement("td");
    const tdQty = document.createElement("td");
    tdTime.textContent = fmtTime(t.timestamp);
    tdPrice.textContent = fmtNum(t.price, 8);
    tdQty.textContent = fmtNum(t.quantity, 8);
    tr.append(tdTime, tdPrice, tdQty);
    el.tradesBody.appendChild(tr);
  }
}

function normalizeCandleTime(t) {
  if (t == null) return Math.floor(Date.now() / 1000);
  const n = Number(t);
  if (!Number.isFinite(n)) return Math.floor(Date.now() / 1000);
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function normalizeIntervalName(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "";
  if (s === "1" || s === "1m") return "1m";
  if (s === "5" || s === "5m") return "5m";
  if (s === "15" || s === "15m") return "15m";
  if (s === "60" || s === "1h") return "1h";
  return s;
}

function resolveCandleTimeSec(candle, envelopeTs) {
  const raw = candle.openTime ?? candle.timestamp ?? candle.time ?? envelopeTs;
  return normalizeCandleTime(raw);
}

function renderCandle(candle, envelopeTs) {
  const contract = candle.contract || "UNKNOWN";
  registerPair(contract);

  const bar = {
    time: resolveCandleTimeSec(candle, envelopeTs),
    open: Number(candle.open ?? candle.close ?? 0),
    high: Number(candle.high ?? candle.close ?? 0),
    low: Number(candle.low ?? candle.close ?? 0),
    close: Number(candle.close ?? candle.open ?? 0),
    volume: Number(candle.volume ?? 0),
    interval: normalizeIntervalName(candle.interval ?? "1m"),
  };
  if (![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) return;

  let arr = state.candleBarsByContract.get(contract);
  if (!arr) {
    arr = [];
    state.candleBarsByContract.set(contract, arr);
  }
  const last = arr[arr.length - 1];
  if (last && last.time === bar.time) arr[arr.length - 1] = bar;
  else if (!last || bar.time > last.time) arr.push(bar);
  else {
    const idx = arr.findIndex((x) => x.time === bar.time);
    if (idx >= 0) arr[idx] = bar;
    else arr.push(bar);
    arr.sort((a, b) => a.time - b.time);
  }
  if (arr.length > 1000) arr.splice(0, arr.length - 1000);

  if (contract === selectedPair()) setCandleSeriesForPair(contract);
}

function intervalMatch(bar, interval) {
  const a = normalizeIntervalName(bar.interval);
  const b = normalizeIntervalName(interval);
  if (!a || !b) return true;
  return a === b;
}

function setCandleSeriesForPair(pair) {
  const bars = state.candleBarsByContract.get(pair) || [];
  const filtered = bars.filter((b) => intervalMatch(b, state.selectedInterval));
  const theme = getChartTheme();
  state.candleSeries.setData(filtered);
  state.volumeSeries.setData(
    filtered.map((b) => ({
      time: b.time,
      value: Number(b.volume || 0),
      color: b.close >= b.open ? theme.volumeUp : theme.volumeDown,
    }))
  );
}

function renderSelectedPair() {
  const pair = selectedPair();
  if (!pair) return;
  const tk = state.tickerRawByContract.get(pair);
  el.tickerContract.textContent = pair;
  el.tickerLast.textContent = String(tk?.lastPrice ?? "-");
  el.tickerBid.textContent = String(tk?.bidPrice ?? "-");
  el.tickerAsk.textContent = String(tk?.askPrice ?? "-");
  el.tickerVolume.textContent = String(tk?.volume ?? "-");
  el.tickerHigh.textContent = fmtNum(tk?.high24h, 8);
  el.tickerLow.textContent = fmtNum(tk?.low24h, 8);
  const ch = Number(tk?.change24h);
  el.tickerChange.textContent = Number.isFinite(ch) ? `${ch.toFixed(2)}%` : "-";

  renderOrderbookByContract(pair);
  setCandleSeriesForPair(pair);
  renderTrades(pair);
}

el.pairSelect.addEventListener("change", () => {
  state.selectedPair = el.pairSelect.value;
  renderSelectedPair();
});
el.multiplierSelect.addEventListener("change", () => {
  const nextMultiplier = Number(el.multiplierSelect.value);
  if (!Number.isFinite(nextMultiplier) || nextMultiplier <= 0) return;
  state.selectedMultiplier = nextMultiplier;
  syncSubscriptions();
});
el.themeSelect.addEventListener("change", () => {
  applyTheme(el.themeSelect.value);
});
el.intervalBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    state.selectedInterval = btn.dataset.interval || "1m";
    el.intervalBtns.forEach((x) => x.classList.remove("active"));
    btn.classList.add("active");
    syncSubscriptions();
    setCandleSeriesForPair(selectedPair());
  });
});

window.addEventListener("beforeunload", () => {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.close();
  state.priceChart?.remove();
  state.volumeChart?.remove();
});

applyTheme(state.theme);
connect();

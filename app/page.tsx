"use client";

import React, { useEffect, useMemo, useState } from "react";

// --- LocalStorage keys
const STORAGE = { HOLDINGS: "pt_holdings_v1", SETTINGS: "pt_settings_v1" };

// --- Demo prices (fallback)
const DEMO: Record<string, number> = {
  BTC: 62000, ETH: 2500, XRP: 0.6,
  DOL: 130, ENB: 47, VFV: 115, QQC: 150, XEQT: 35,
  AAPL: 228, MSFT: 410, NVDA: 115, SPY: 530, QQQ: 470, VOO: 470,
};

type AssetType = "Stock" | "ETF" | "Crypto";
type Holding = {
  id: string;
  symbol: string;
  name?: string;
  type: AssetType;
  exchange?: string;
  currency: string;
  quantity: number;
  costBasisPerUnit: number;
};
type Settings = {
  baseCurrency: "CAD" | "USD" | "EUR" | "GBP";
  useLivePrices: boolean; // placeholder toggle for later
  provider: "Demo" | "Finnhub" | "CoinGecko+Polygon"; // placeholder
  apiKeys: { finnhub?: string; polygon?: string };
};

const uid = () => Math.random().toString(36).slice(2, 9);
const load = <T,>(k: string, fb: T): T => {
  if (typeof window === "undefined") return fb;
  try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : fb; } catch { return fb; }
};
const save = <T,>(k: string, v: T) => { if (typeof window !== "undefined") localStorage.setItem(k, JSON.stringify(v)); };

// --- Price resolver (demo only for now)
async function resolvePrice(symbol: string, _type: AssetType, settings: Settings): Promise<number> {
  if (!settings.useLivePrices || settings.provider === "Demo") return DEMO[symbol.toUpperCase()] ?? 0;
  // Later: call your own /api/price/* server routes here.
  return DEMO[symbol.toUpperCase()] ?? 0;
}

export default function Page() {
  const [holdings, setHoldings] = useState<Holding[]>(() => load(STORAGE.HOLDINGS, []));
  const [settings, setSettings] = useState<Settings>(() =>
    load(STORAGE.SETTINGS, { baseCurrency: "CAD", useLivePrices: false, provider: "Demo", apiKeys: {} } as Settings)
  );
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => save(STORAGE.HOLDINGS, holdings), [holdings]);
  useEffect(() => save(STORAGE.SETTINGS, settings), [settings]);

  async function refreshPrices() {
    if (holdings.length === 0) return;
    setBusy(true);
    const symbols = [...new Set(holdings.map(h => h.symbol.toUpperCase()).filter(Boolean))];
    const out: Record<string, number> = {};
    for (const s of symbols) {
      const h = holdings.find(x => x.symbol.toUpperCase() === s)!;
      out[s] = await resolvePrice(s, h.type, settings);
    }
    setPrices(out);
    setBusy(false);
  }

  useEffect(() => { refreshPrices(); }, [settings.useLivePrices, settings.provider]);

  const totals = useMemo(() => {
    let current = 0, cost = 0;
    for (const h of holdings) {
      const p = prices[h.symbol.toUpperCase()] ?? DEMO[h.symbol.toUpperCase()] ?? 0;
      current += p * h.quantity;
      cost += h.costBasisPerUnit * h.quantity;
    }
    const pnl = current - cost;
    return { current, cost, pnl, pnlPct: cost > 0 ? (pnl / cost) * 100 : 0 };
  }, [holdings, prices]);

  function addRow(prefill?: Partial<Holding>) {
    setHoldings(h => [...h, { id: uid(), symbol: "", name: "", type: "Stock", exchange: "", currency: settings.baseCurrency, quantity: 0, costBasisPerUnit: 0, ...prefill }]);
  }
  function updateRow(id: string, patch: Partial<Holding>) {
    setHoldings(h => h.map(x => (x.id === id ? { ...x, ...patch } : x)));
  }
  function removeRow(id: string) { setHoldings(h => h.filter(x => x.id !== id)); }

  function exportCSV() {
    const header = "symbol,name,type,exchange,currency,quantity,costBasisPerUnit";
    const rows = holdings.map(h => [h.symbol, h.name || "", h.type, h.exchange || "", h.currency, h.quantity, h.costBasisPerUnit].join(",")).join("\n");
    const blob = new Blob([header + "\n" + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "holdings.csv"; a.click(); URL.revokeObjectURL(url);
  }
  function importCSV(file: File) {
    const r = new FileReader();
    r.onload = () => {
      const t = String(r.result || "");
      const lines = t.split(/\r?\n/).filter(Boolean);
      const [header, ...rows] = lines;
      const cols = header.split(",").map(s => s.trim().toLowerCase());
      const idx = Object.fromEntries(cols.map((c, i) => [c, i]));
      const parsed: Holding[] = rows.map(row => {
        const c = row.split(",");
        return {
          id: uid(),
          symbol: c[idx.symbol] || "",
          name: c[idx.name] || "",
          type: (c[idx.type] || "Stock") as AssetType,
          exchange: c[idx.exchange] || "",
          currency: c[idx.currency] || settings.baseCurrency,
          quantity: Number(c[idx.quantity] || 0),
          costBasisPerUnit: Number(c[idx.costbasisperunit] || 0),
        };
      });
      setHoldings(parsed);
    };
    r.readAsText(file);
  }

  return (
    <main style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Portfolio Tracker</h1>
          <div style={{ color: "#555" }}>Track stocks, ETFs, and crypto in {settings.baseCurrency}. (Demo prices enabled)</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setShowSettings(true)}>Settings</button>
          <button onClick={exportCSV}>Export CSV</button>
          <label style={{ display: "inline-block" }}>
            <input type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && importCSV(e.target.files[0])}/>
            <span style={{ border: "1px solid #ccc", padding: "6px 10px", cursor: "pointer" }}>Import CSV</span>
          </label>
          <button onClick={() => addRow()}>Add Row</button>
          <button onClick={refreshPrices} disabled={busy}>{busy ? "Refreshing..." : "Refresh Prices"}</button>
        </div>
      </header>

      {/* Settings modal */}
      {showSettings && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "grid", placeItems: "center" }}>
          <div style={{ background: "#fff", padding: 20, borderRadius: 8, minWidth: 320 }}>
            <h3>Settings</h3>
            <div style={{ marginBottom: 8 }}>
              <label>Base currency:&nbsp;</label>
              <select value={settings.baseCurrency} onChange={(e) => setSettings(s => ({ ...s, baseCurrency: e.target.value as Settings["baseCurrency"] }))}>
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label>Provider:&nbsp;</label>
              <select value={settings.provider} onChange={(e) => setSettings(s => ({ ...s, provider: e.target.value as Settings["provider"] }))}>
                <option value="Demo">Demo (offline)</option>
                <option value="Finnhub">Finnhub</option>
                <option value="CoinGecko+Polygon">CoinGecko + Polygon</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setSettings(s => ({ ...s, useLivePrices: !s.useLivePrices }))}>
                {settings.useLivePrices ? "Turn Off Live Prices" : "Turn On Live Prices"}
              </button>
              <button onClick={() => setShowSettings(false)}>Close</button>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
              Live prices will use demo values until we add server API routes (to keep API keys private on Vercel).
            </div>
          </div>
        </div>
      )}

      {/* Table header */}
      <div style={{ marginTop: 16, border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "120px 100px 120px 120px 120px 120px 1fr", gap: 8, padding: "8px 12px", background: "#f7f7f7", fontWeight: 600 }}>
          <div>Symbol</div><div>Type</div><div>Quantity</div><div>Cost/Unit</div><div>Price</div><div>Value</div><div style={{ textAlign: "right" }}>Actions</div>
        </div>

        {/* Rows */}
        {holdings.length === 0 && (
          <div style={{ padding: 16, color: "#666" }}>
            No holdings yet. Click <b>Add Row</b> or use <b>Import CSV</b> (columns: symbol,name,type,exchange,currency,quantity,costBasisPerUnit).
          </div>
        )}
        {holdings.map(h => {
          const sym = (h.symbol || "").toUpperCase();
          const price = prices[sym] ?? DEMO[sym] ?? 0;
          const value = price * h.quantity;
          return (
            <div key={h.id} style={{ display: "grid", gridTemplateColumns: "120px 100px 120px 120px 120px 120px 1fr", gap: 8, padding: "8px 12px", borderTop: "1px solid #eee" }}>
              <input value={h.symbol} placeholder="AAPL / DOL / BTC"
                     onChange={(e) => updateRow(h.id, { symbol: e.target.value })}/>
              <select value={h.type} onChange={(e) => updateRow(h.id, { type: e.target.value as AssetType })}>
                <option value="Stock">Stock</option>
                <option value="ETF">ETF</option>
                <option value="Crypto">Crypto</option>
              </select>
              <input type="number" value={h.quantity} onChange={(e) => updateRow(h.id, { quantity: Number(e.target.value) })}/>
              <input type="number" value={h.costBasisPerUnit} onChange={(e) => updateRow(h.id, { costBasisPerUnit: Number(e.target.value) })}/>
              <div style={{ lineHeight: "32px" }}>{price.toLocaleString(undefined, { style: "currency", currency: settings.baseCurrency })}</div>
              <div style={{ lineHeight: "32px", fontWeight: 600 }}>{value.toLocaleString(undefined, { style: "currency", currency: settings.baseCurrency })}</div>
              <div style={{ textAlign: "right" }}>
                <button onClick={() => removeRow(h.id)}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginTop: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ color: "#666" }}>Current Value</div>
          <div style={{ fontWeight: 700 }}>{totals.current.toLocaleString(undefined, { style: "currency", currency: settings.baseCurrency })}</div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ color: "#666" }}>Invested (Cost)</div>
          <div style={{ fontWeight: 700 }}>{totals.cost.toLocaleString(undefined, { style: "currency", currency: settings.baseCurrency })}</div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ color: "#666" }}>P&L</div>
          <div style={{ fontWeight: 700, color: totals.pnl >= 0 ? "#059669" : "#dc2626" }}>
            {totals.pnl.toLocaleString(undefined, { style: "currency", currency: settings.baseCurrency })}
          </div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ color: "#666" }}>Return %</div>
          <div style={{ fontWeight: 700, color: totals.pnl >= 0 ? "#059669" : "#dc2626" }}>
            {totals.pnlPct.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Quick start tips */}
      <div style={{ marginTop: 16, color: "#666" }}>
        <h3>Quick Start</h3>
        <ol>
          <li>Click <b>Add Row</b> (or Import CSV). Canadian examples: <b>DOL</b>, <b>ENB</b>, <b>VFV</b>, <b>QQC</b>, <b>XEQT</b>. Crypto: <b>BTC</b>, <b>ETH</b>, <b>XRP</b>.</li>
          <li>Open <b>Settings</b> → set <b>Base currency</b> to <b>CAD</b>.</li>
          <li>Click <b>Refresh Prices</b> (demo values will appear).</li>
          <li>When ready for live prices, I’ll add secure server routes + env vars.</li>
        </ol>
      </div>
    </main>
  );
}

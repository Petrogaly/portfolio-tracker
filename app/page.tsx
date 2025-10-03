"use client";

import React, { useEffect, useMemo, useState } from "react";

/** ────────────────────────────────────────────────────────────────────────────
 * Types
 * ─────────────────────────────────────────────────────────────────────────── */
type AssetType = "Stock" | "ETF" | "Crypto";

type Holding = {
  id: string;
  symbol: string;
  type: AssetType;
  quantity: number;
  costBasisPerUnit: number;
};

type Settings = {
  baseCurrency: "CAD" | "USD" | "EUR" | "GBP";
  useLivePrices: boolean;
};

const STORAGE = {
  HOLDINGS: "pt_holdings_v2",
  SETTINGS: "pt_settings_v2",
};

/** Demo fallback prices (used when Live is off or a symbol can’t be priced) */
const DEMO_PRICES: Record<string, number> = {
  DOL: 130,
  ENB: 47,
  VFV: 115,
  QQC: 150,
  XEQT: 35,
  BTC: 62000,
  ETH: 2500,
  XRP: 0.6,
};

/** Small utilities */
const uid = () => Math.random().toString(36).slice(2, 9);
const load = <T,>(k: string, f: T): T => {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(k) : null;
    return raw ? (JSON.parse(raw) as T) : f;
  } catch {
    return f;
  }
};
const save = <T,>(k: string, v: T) => {
  try {
    if (typeof window !== "undefined") localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

/** ────────────────────────────────────────────────────────────────────────────
 * Page
 * ─────────────────────────────────────────────────────────────────────────── */
export default function Page() {
  /** State */
  const [holdings, setHoldings] = useState<Holding[]>(() =>
    load(STORAGE.HOLDINGS, [])
  );

  const [settings, setSettings] = useState<Settings>(() =>
    load(STORAGE.SETTINGS, {
      baseCurrency: "CAD",
      useLivePrices: false,
    } as Settings)
  );

  const [useLive, setUseLive] = useState<boolean>(() =>
    load<Settings>(STORAGE.SETTINGS, { baseCurrency: "CAD", useLivePrices: false })
      .useLivePrices
  );

  const [prices, setPrices] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [openSettings, setOpenSettings] = useState(false);

  /** Persist settings/holdings */
  useEffect(() => save(STORAGE.HOLDINGS, holdings), [holdings]);
  useEffect(() => save(STORAGE.SETTINGS, { ...settings, useLivePrices: useLive }), [settings, useLive]);

  /** Summary + value calcs */
  const totals = useMemo(() => {
    let current = 0;
    let cost = 0;
    for (const h of holdings) {
      const sym = (h.symbol || "").toUpperCase();
      const px = prices[sym] ?? DEMO_PRICES[sym] ?? 0;
      current += px * h.quantity;
      cost += h.costBasisPerUnit * h.quantity;
    }
    const pnl = current - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    return { current, cost, pnl, pnlPct };
  }, [holdings, prices]);

  /** Add/remove/update rows */
  function addRow(prefill?: Partial<Holding>) {
    setHoldings(h => [
      ...h,
      {
        id: uid(),
        symbol: "",
        type: "Stock",
        quantity: 0,
        costBasisPerUnit: 0,
        ...prefill,
      },
    ]);
  }
  function removeRow(id: string) {
    setHoldings(h => h.filter(x => x.id !== id));
  }
  function updateRow(id: string, patch: Partial<Holding>) {
    setHoldings(h => h.map(x => (x.id === id ? { ...x, ...patch } : x)));
  }

  /** CSV import/export */
  function exportCSV() {
    const header = "symbol,type,quantity,costBasisPerUnit";
    const rows = holdings
      .map(h => [h.symbol, h.type, h.quantity, h.costBasisPerUnit].join(","))
      .join("\n");
    const csv = header + "\n" + rows;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "holdings.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importCSV(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const lines = text.split(/\r?\n/).filter(Boolean);
      const [header, ...rows] = lines;
      const cols = header.split(",").map(s => s.trim().toLowerCase());
      const req = ["symbol", "type", "quantity", "costbasisperunit"];
      const ok = req.every(k => cols.includes(k));
      if (!ok) {
        alert("CSV must include columns: symbol,type,quantity,costBasisPerUnit");
        return;
      }
      const idx = Object.fromEntries(cols.map((c, i) => [c, i]));
      const parsed: Holding[] = rows.map(r => {
        const c = r.split(",");
        return {
          id: uid(),
          symbol: (c[idx.symbol] || "").trim(),
          type: ((c[idx.type] || "Stock").trim() as AssetType),
          quantity: Number(c[idx.quantity] || 0),
          costBasisPerUnit: Number(c[idx.costbasisperunit] || 0),
        };
      });
      setHoldings(parsed);
    };
    reader.readAsText(file);
  }

  /** Fetch prices (Live via /api/prices, else demo prices) */
  async function refreshPrices() {
    if (holdings.length === 0) return;
    setBusy(true);

    const symbols = [...new Set(
      holdings.map(h => (h.symbol || "").toUpperCase()).filter(Boolean)
    )];

    // helper: demo fallback
    const setDemo = () => {
      const m: Record<string, number> = {};
      for (const s of symbols) m[s] = DEMO_PRICES[s] ?? 0;
      setPrices(m);
    };

    if (useLive) {
      try {
        const res = await fetch("/api/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbols,
            baseCurrency: settings.baseCurrency || "CAD",
          }),
        });
        const j = await res.json();
        const live: Record<string, number> = j?.prices || {};
        const merged: Record<string, number> = {};
        for (const s of symbols) merged[s] = typeof live[s] === "number" ? live[s] : (DEMO_PRICES[s] ?? 0);
        setPrices(merged);
      } catch {
        setDemo();
      } finally {
        setBusy(false);
      }
    } else {
      setDemo();
      setBusy(false);
    }
  }

  /** Auto-refresh on first render and when toggling live/base currency */
  useEffect(() => {
    refreshPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useLive, settings.baseCurrency]);

  /** ──────────────────────────────────────────────────────────────────────── */

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { style: "currency", currency: settings.baseCurrency });

  return (
    <div style={{ padding: 20, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontWeight: 600, margin: 0 }}>Portfolio Tracker</h1>
          <div style={{ color: "#666", fontSize: 14 }}>
            Track stocks, ETFs, and crypto in {settings.baseCurrency}. {useLive ? "Live prices enabled." : "Demo prices enabled."}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Settings button */}
          <button onClick={() => setOpenSettings(true)}>Settings</button>

          {/* Export / Import */}
          <button onClick={exportCSV}>Export CSV</button>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="file"
              accept=".csv"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && importCSV(e.target.files[0])}
            />
            <span style={{ border: "1px solid #ccc", padding: "6px 10px", borderRadius: 6, cursor: "pointer" }}>
              Import CSV
            </span>
          </label>

          {/* Add row / Refresh */}
          <button onClick={() => addRow()}>Add Row</button>
          <button onClick={refreshPrices} disabled={busy}>
            {busy ? "Refreshing..." : "Refresh Prices"}
          </button>
        </div>
      </header>

      {/* Table */}
      <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 90px", background: "#f7f7f7", padding: "10px 12px", fontWeight: 600 }}>
          <div>Symbol</div>
          <div>Type</div>
          <div>Quantity</div>
          <div>Cost/Unit</div>
          <div>Price</div>
          <div>Value</div>
        </div>

        {holdings.length === 0 ? (
          <div style={{ padding: 16, color: "#666" }}>
            No holdings yet. Click <b>Add Row</b> or use <b>Import CSV</b> (columns: symbol,type,quantity,costBasisPerUnit).
          </div>
        ) : (
          holdings.map(h => {
            const sym = (h.symbol || "").toUpperCase();
            const px = prices[sym] ?? DEMO_PRICES[sym] ?? 0;
            const value = px * h.quantity;

            return (
              <div key={h.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 90px", padding: "10px 12px", borderTop: "1px solid #eee" }}>
                {/* Symbol */}
                <div>
                  <input
                    value={h.symbol}
                    onChange={(e) => updateRow(h.id, { symbol: e.target.value })}
                    placeholder="DOL / ENB / VFV / BTC"
                    style={{ width: "95%" }}
                  />
                </div>

                {/* Type */}
                <div>
                  <select
                    value={h.type}
                    onChange={(e) => updateRow(h.id, { type: e.target.value as AssetType })}
                  >
                    <option value="Stock">Stock</option>
                    <option value="ETF">ETF</option>
                    <option value="Crypto">Crypto</option>
                  </select>
                </div>

                {/* Quantity */}
                <div>
                  <input
                    type="number"
                    value={h.quantity}
                    onChange={(e) => updateRow(h.id, { quantity: Number(e.target.value) })}
                    style={{ width: "95%" }}
                  />
                </div>

                {/* Cost/Unit (book cost per unit) */}
                <div>
                  <input
                    type="number"
                    value={h.costBasisPerUnit}
                    onChange={(e) => updateRow(h.id, { costBasisPerUnit: Number(e.target.value) })}
                    style={{ width: "95%" }}
                  />
                </div>

                {/* Price (current) */}
                <div style={{ display: "flex", alignItems: "center" }}>{fmt(px)}</div>

                {/* Value */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <span>{fmt(value)}</span>
                  <button onClick={() => removeRow(h.id)} style={{ color: "#b00020" }}>Delete</button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 16 }}>
        <SummaryCard title="Current Value" value={fmt(totals.current)} />
        <SummaryCard title="Invested (Cost)" value={fmt(totals.cost)} />
        <SummaryCard title="P&L" value={fmt(totals.pnl)} color={totals.pnl >= 0 ? "#0a7a42" : "#b00020"} />
        <SummaryCard title="Return %" value={`${totals.pnlPct.toFixed(2)}%`} color={totals.pnl >= 0 ? "#0a7a42" : "#b00020"} />
      </div>

      {/* Quick start note */}
      <div style={{ marginTop: 16, color: "#666" }}>
        <div><b>Quick Start</b></div>
        <div>Enter your holdings, then toggle <b>Live prices</b> in Settings and click <b>Refresh Prices</b>.</div>
        <div>Crypto works without keys; Stocks/ETFs require a Finnhub API key (set on Vercel as <code>FINNHUB_API_KEY</code>).</div>
      </div>

      {/* Settings modal (very simple) */}
      {openSettings && (
        <div
          onClick={() => setOpenSettings(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 12
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", padding: 16, borderRadius: 10, width: 420, maxWidth: "95%" }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Settings</div>

            <div style={{ display: "grid", gap: 10 }}>
              {/* Base currency */}
              <label style={{ display: "grid", gap: 6 }}>
                <span>Base currency:</span>
                <select
                  value={settings.baseCurrency}
                  onChange={(e) => setSettings(s => ({ ...s, baseCurrency: e.target.value as Settings["baseCurrency"] }))}
                >
                  <option value="CAD">CAD</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </label>

              {/* Live toggle */}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={useLive}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setUseLive(on);
                    setSettings(s => ({ ...s, useLivePrices: on }));
                  }}
                />
                <span>Live prices</span>
              </label>

              <div style={{ color: "#666", fontSize: 12 }}>
                Stocks/ETFs use Finnhub via a secure server route. Add your key on Vercel as <code>FINNHUB_API_KEY</code>.
                Crypto uses CoinGecko (no key).
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button onClick={() => setOpenSettings(false)}>Close</button>
                <button onClick={() => { refreshPrices(); setOpenSettings(false); }}>
                  Save & Refresh
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Simple summary cell */
function SummaryCard({ title, value, color }: { title: string; value: string; color?: string }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, background: "#fafafa" }}>
      <div style={{ color: "#666", marginBottom: 6 }}>{title}</div>
      <div style={{ fontWeight: 700, color: color || "inherit" }}>{value}</div>
    </div>
  );
}

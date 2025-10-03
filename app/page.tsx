"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Upload, Settings, Download } from "lucide-react";
import { PieChart, Pie, Tooltip, ResponsiveContainer, Cell } from "recharts";

/** MVP with shadcn/ui + Recharts
 * - Manual rows + CSV import/export
 * - Settings (base currency, provider toggle—demo for now)
 * - Allocation pie + P&L cards
 * - Demo prices by default (live feeds can be added later)
 */

// --- LocalStorage keys
const STORAGE = { HOLDINGS: "pt_holdings_v1", SETTINGS: "pt_settings_v1" };

// --- Demo fallback prices
const DEMO: Record<string, number> = {
  // crypto
  BTC: 62000, ETH: 2500, XRP: 0.6,
  // CAD stocks/ETFs (demo)
  DOL: 130, ENB: 47, VFV: 115, QQC: 150, XEQT: 35,
  // misc
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
type SettingsT = {
  baseCurrency: "CAD" | "USD" | "EUR" | "GBP";
  provider: "Demo" | "Finnhub" | "CoinGecko+Polygon";
  apiKeys: { finnhub?: string; polygon?: string };
  useLivePrices: boolean;
};

const uid = () => Math.random().toString(36).slice(2, 9);
const load = <T,>(k: string, fb: T): T => {
  if (typeof window === "undefined") return fb;
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fb; } catch { return fb; }
};
const save = <T,>(k: string, v: T) => { if (typeof window !== "undefined") localStorage.setItem(k, JSON.stringify(v)); };

// Price resolver (demo only for now)
async function resolvePrice(symbol: string, _type: AssetType, settings: SettingsT): Promise<number> {
  if (!settings.useLivePrices || settings.provider === "Demo") return DEMO[symbol.toUpperCase()] ?? 0;
  // Later: call your own /api/price/* server routes and return real prices
  return DEMO[symbol.toUpperCase()] ?? 0;
}

export default function Page() {
  const [holdings, setHoldings] = useState<Holding[]>(() => load(STORAGE.HOLDINGS, []));
  const [settings, setSettings] = useState<SettingsT>(() =>
    load(STORAGE.SETTINGS, { baseCurrency: "CAD", provider: "Demo", apiKeys: {}, useLivePrices: false } as SettingsT)
  );
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

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

  const allocation = useMemo(() => {
    const m: Record<string, number> = {};
    for (const h of holdings) {
      const p = prices[h.symbol.toUpperCase()] ?? DEMO[h.symbol.toUpperCase()] ?? 0;
      m[h.type] = (m[h.type] || 0) + p * h.quantity;
    }
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [holdings, prices]);

  function addRow(prefill?: Partial<Holding>) {
    setHoldings(h => [...h, { id: uid(), symbol: "", name: "", type: "Stock", exchange: "", currency: settings.baseCurrency, quantity: 0, costBasisPerUnit: 0, ...prefill }]);
  }
  function updateRow(id: string, patch: Partial<Holding>) {
    setHoldings(h => h.map(x => (x.id === id ? { ...x, ...patch } : x)));
  }
  function removeRow(id: string) { setHoldings(h => h.filter(x => x.id !== id)); }

  function exportCSV() {
    const header = ["symbol","name","type","exchange","currency","quantity","costBasisPerUnit"].join(",");
    const rows = holdings.map(h => [h.symbol, h.name || "", h.type, h.exchange || "", h.currency, h.quantity, h.costBasisPerUnit].join(",")).join("\n");
    const csv = header + "\n" + rows;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "holdings.csv"; a.click(); URL.revokeObjectURL(url);
  }
  function importCSV(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const lines = text.split(/\r?\n/).filter(Boolean);
      const [header, ...rows] = lines;
      const cols = header.split(",").map(s => s.trim().toLowerCase());
      const idx = Object.fromEntries(cols.map((c, i) => [c, i]));
      const parsed: Holding[] = rows.map((r) => {
        const c = r.split(",");
        return {
          id: uid(),
          symbol: c[idx.symbol]?.trim() || "",
          name: c[idx.name]?.trim() || "",
          type: (c[idx.type]?.trim() || "Stock") as AssetType,
          exchange: c[idx.exchange]?.trim() || "",
          currency: c[idx.currency]?.trim() || settings.baseCurrency,
          quantity: Number(c[idx.quantity] || 0),
          costBasisPerUnit: Number(c[idx.costbasisperunit] || 0),
        };
      });
      setHoldings(parsed);
    };
    reader.readAsText(file);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Portfolio Tracker</h1>
            <p className="text-sm text-muted-foreground">
              Track stocks, ETFs, and crypto in {settings.baseCurrency}. Demo prices by default.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline"><Settings className="mr-2 h-4 w-4" />Settings</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Data & Pricing Settings</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Base currency</Label>
                      <Select value={settings.baseCurrency} onValueChange={(v: any) => setSettings(s => ({ ...s, baseCurrency: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CAD">CAD</SelectItem>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="GBP">GBP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Provider</Label>
                      <Select value={settings.provider} onValueChange={(v: any) => setSettings(s => ({ ...s, provider: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Demo">Demo (offline)</SelectItem>
                          <SelectItem value="CoinGecko+Polygon">CoinGecko + Polygon</SelectItem>
                          <SelectItem value="Finnhub">Finnhub</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label>Polygon API Key</Label>
                    <Input placeholder="pk_..." value={settings.apiKeys.polygon || ""} onChange={(e) => setSettings(s => ({ ...s, apiKeys: { ...s.apiKeys, polygon: e.target.value } }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Finnhub API Key</Label>
                    <Input placeholder="sandbox_... or prod token" value={settings.apiKeys.finnhub || ""} onChange={(e) => setSettings(s => ({ ...s, apiKeys: { ...s.apiKeys, finnhub: e.target.value } }))} />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={settings.useLivePrices ? "default" : "secondary"}>{settings.useLivePrices ? "Live" : "Demo"}</Badge>
                      <span className="text-sm text-muted-foreground">Use live market prices</span>
                    </div>
                    <Button onClick={() => setSettings(s => ({ ...s, useLivePrices: !s.useLivePrices }))}>
                      {settings.useLivePrices ? "Turn Off" : "Turn On"}
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    For production, we’ll proxy real data through server routes so your API keys stay private on Vercel.
                  </p>
                </div>
              </DialogContent>
            </Dialog>

            <Button variant="outline" onClick={exportCSV}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
            <label className="inline-flex items-center">
              <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCSV(e.target.files[0])} />
              <span><Button variant="outline"><Upload className="mr-2 h-4 w-4" />Import CSV</Button></span>
            </label>
            <Button onClick={() => addRow()}><Plus className="mr-2 h-4 w-4" />Add Row</Button>
            <Button onClick={refreshPrices} disabled={busy}>{busy ? "Refreshing..." : "Refresh Prices"}</Button>
          </div>
        </header>

        {/* Holdings grid */}
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1 pb-2">
              <div className="col-span-2">Symbol</div>
              <div className="col-span-2">Type</div>
              <div className="col-span-2">Quantity</div>
              <div className="col-span-2">Cost/Unit</div>
              <div className="col-span-2">Price</div>
              <div className="col-span-1">Value</div>
              <div className="col-span-1 text-right" />
            </div>

            {holdings.length === 0 && (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No holdings yet. Add a row or import a CSV (symbol,type,quantity,costBasisPerUnit,...)
              </div>
            )}

            <div className="space-y-2">
              {holdings.map(h => {
                const sym = (h.symbol || "").toUpperCase();
                const price = prices[sym] ?? DEMO[sym] ?? 0;
                const value = price * h.quantity;
                return (
                  <div key={h.id} className="grid grid-cols-12 items-center gap-2 rounded-lg border bg-white p-2">
                    <div className="col-span-2">
                      <Input value={h.symbol} placeholder="DOL / ENB / BTC"
                        onChange={(e) => updateRow(h.id, { symbol: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <Select value={h.type} onValueChange={(v: any) => updateRow(h.id, { type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Stock">Stock</SelectItem>
                          <SelectItem value="ETF">ETF</SelectItem>
                          <SelectItem value="Crypto">Crypto</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Input type="number" value={h.quantity} onChange={(e) => updateRow(h.id, { quantity: Number(e.target.value) })} />
                    </div>
                    <div className="col-span-2">
                      <Input type="number" value={h.costBasisPerUnit} onChange={(e) => updateRow(h.id, { costBasisPerUnit: Number(e.target.value) })} />
                    </div>
                    <div className="col-span-2">
                      <div className="text-sm">{price.toLocaleString(undefined, { style: "currency", currency: settings.baseCurrency })}</div>
                    </div>
                    <div className="col-span-1">
                      <div className="text-sm font-medium">{value.toLocaleString(undefined, { style: "currency", currency: settings.baseCurrency })}</div>
                    </div>
                    <div className="col-span-1 text-right">
                      <Button size="icon" variant="ghost" onClick={() => removeRow(h.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Right column: summary + allocation */}
        <div className="grid gap-6 lg:grid-cols-1">
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Summary</h2>
                <Badge variant="secondary">{settings.useLivePrices ? "Live" : "Demo"}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-muted-foreground">Current Value</div>
                  <div className="text-lg font-semibold">{totals.current.toLocaleString(undefined, { style: "currency", currency: settings.baseCurrency })}</div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-muted-foreground">Invested (Cost)</div>
                  <div className="text-lg font-semibold">{totals.cost.toLocaleString(undefined, { style: "currency", currency: settings.baseCurrency })}</div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-muted-foreground">P&L</div>
                  <div className={`text-lg font-semibold ${totals.pnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {totals.pnl.toLocaleString(undefined, { style: "currency", currency: settings.baseCurrency })}
                  </div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-muted-foreground">Return %</div>
                  <div className={`text-lg font-semibold ${totals.pnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{totals.pnlPct.toFixed(2)}%</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h2 className="mb-2 text-base font-semibold">Allocation</h2>
              <div className="h-56">
                {allocation.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Add holdings to see allocation
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie dataKey="value" data={allocation} outerRadius={90} label>
                        {allocation.map((_, i) => <Cell key={i} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) =>
                        (Number(v) || 0).toLocaleString(undefined, { style: "currency", currency: settings.baseCurrency })
                      } />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-base font-semibold">Quick Start</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Click <b>Add Row</b> and enter <b>symbol</b> (e.g., DOL, ENB, VFV, QQC, XEQT, BTC, ETH, XRP), <b>type</b>, <b>quantity</b>, and <b>cost/Unit</b>.</li>
              <li>Open <b>Settings</b> → set <b>Base currency</b> to <b>CAD</b>. (Provider can stay on <b>Demo</b> for now.)</li>
              <li>Use <b>Import CSV</b> to bulk load if you prefer.</li>
              <li>Hit <b>Refresh Prices</b>. Values/P&L update instantly (using demo prices).</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { NextRequest, NextResponse } from "next/server";

const CG_ID: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", XRP: "ripple" };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const symbols: string[] = (body?.symbols || []).map((s: string) => s.toUpperCase());
    const baseCurrency = String(body?.baseCurrency || "CAD").toLowerCase();

    const out: Record<string, number> = {};

    // --- Crypto via CoinGecko (no key)
    const crypto = symbols.filter(s => CG_ID[s]);
    if (crypto.length) {
      const ids = crypto.map(s => CG_ID[s]).join(",");
      const u = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${baseCurrency}`;
      const r = await fetch(u, { next: { revalidate: 10 } });
      if (r.ok) {
        const j = await r.json();
        for (const s of crypto) {
          const id = CG_ID[s];
          const p = j?.[id]?.[baseCurrency];
          if (typeof p === "number" && p > 0) out[s] = p;
        }
      }
    }

    // --- Stocks/ETFs via Finnhub (needs key)
    const finnhubKey = process.env.FINNHUB_API_KEY || process.env.NEXT_PUBLIC_FINNHUB_API_KEY;
    const equities = symbols.filter(s => !CG_ID[s]);
    if (finnhubKey && equities.length) {
      const FIX: Record<string, string> = { DOL: "DOL.TO", ENB: "ENB.TO", VFV: "VFV.TO", QQC: "QQC.TO", XEQT: "XEQT.TO" };
      await Promise.all(
        equities.map(async (sym) => {
          const ticker = FIX[sym] ?? sym;
          try {
            const u = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${finnhubKey}`;
            const r = await fetch(u, { cache: "no-store" });
            if (!r.ok) return;
            const q = await r.json();
            const c = q?.c;
            if (typeof c === "number" && c > 0) out[sym] = c;
          } catch {}
        })
      );
    }

    return NextResponse.json({ prices: out });
  } catch {
    return NextResponse.json({ prices: {}, error: "bad-request" }, { status: 400 });
  }
}

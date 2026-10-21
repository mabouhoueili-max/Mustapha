# tradesim — live simulation trading with three agents

A paper-trading simulator for **stocks, ETFs, commodities and crypto**. No real
money and no broker account: orders fill against a simulated broker that charges
slippage and fees. Python 3.10+, standard library only.

## The three agents

| Agent | Role | What it does each tick |
|-------|------|------------------------|
| `market` — **MarketDataAgent** | Market data | Publishes a price snapshot for every asset. With `--feed live` it pulls real quotes (Coinbase for crypto, Yahoo Finance for the rest); otherwise it simulates prices (geometric Brownian motion with per-class volatility). |
| `trader` — **TraderAgent** | Strategy | Moving-average trend following: proposes a buy of ~10% of equity when MA10 rises above MA30 (by a small buffer band), and a sell of the whole position on the reverse cross. Proposes only; never trades directly. |
| `risk` — **RiskManagerAgent** | Risk control | Rules on every buy: resizes it to fit a 20% per-position cap, per-class caps (stocks 50%, ETFs 50%, commodities 30%, crypto 25%) and a 5% cash buffer, or rejects it. Acts on its own before the trader: 8% stop-loss (then a 20-tick buy cooldown on that symbol) and a 20% drawdown kill switch that liquidates and halts new buys. Sells are always allowed. |

Each tick runs: `market` publishes → `risk` forced exits → `trader` proposes →
`risk` approves/resizes/rejects → broker fills → equity recorded.

## Universe

| Class | Symbols (live source) | Lot size | Slippage | Fee |
|-------|-----------------------|----------|----------|-----|
| Stock | AAPL, MSFT, NVDA | 1 share | 2 bps | 0.5 bps |
| ETF | SPY, QQQ | 1 share | 1 bp | 0.3 bps |
| Commodity | GOLD (`GC=F`), OIL (`CL=F`) | 0.01 unit | 5 bps | 2 bps |
| Crypto | BTC (`BTC-USD`), ETH (`ETH-USD`) | 0.0001 | 10 bps | 10 bps |

Edit `DEFAULT_UNIVERSE` / `CLASS_RULES` in `tradesim/assets.py` to change them.

## Run it

```bash
cd trading-sim
python3 -m tradesim run --feed live                       # real prices, one poll a minute, until Ctrl-C
python3 -m tradesim run --feed live --symbols AAPL,SPY,GOLD,BTC --interval 30 --trades-csv fills.csv
python3 -m tradesim run --seed 7 --ticks 2000             # offline: simulated prices, runs instantly
```

### Live feed

| Asset class | Source | Fallback |
|-------------|--------|----------|
| Crypto | Coinbase public spot price (`api.coinbase.com`) | Yahoo Finance |
| Stocks, ETFs, commodities | Yahoo Finance chart API (`query1.finance.yahoo.com`) | `query2.finance.yahoo.com` |

No API keys. On start it prints a quote for every symbol (or why it failed) and
loads the last 30 one-minute bars from Yahoo, so the trader can act on the first
poll instead of waiting 30 minutes. In live mode nothing is ever simulated:

- a symbol whose quote fails keeps its last real price, marked `~` (stale); the
  trader ignores it and the risk manager refuses buys on it until a fresh quote arrives;
- a symbol that has never been quoted shows `no quote` and is not traded;
- if no symbol can be quoted at start-up, the run exits with an error naming the hosts to allow.

Know the limits: Yahoo's endpoint is unofficial and can rate-limit or change;
its quotes can be delayed up to ~15 minutes; stocks, ETFs and futures move only
during their trading hours, while crypto trades 24/7. `--ticks` defaults to 500
polls (about 8 hours at 60 s); Ctrl-C stops early and prints the final report.

Useful flags: `--interval` (seconds between polls), `--cash`, `--fast`, `--slow`,
`--target-weight`, `--max-position`, `--stop-loss`, `--max-drawdown`,
`--report-every`, `--trades-csv`. With the sim feed, `--seed` and
`--seconds-per-tick` control the generated prices.

## Tests

```bash
cd trading-sim && python3 -m unittest -v
```

This is a simulator for learning and testing strategies, not investment advice.
The bundled strategy is a simple example and loses money to fees in sideways markets.

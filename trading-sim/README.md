# tradesim — live simulation trading with three agents

A paper-trading simulator for **stocks, ETFs, commodities and crypto**. No real
money and no broker account: orders fill against a simulated broker that charges
slippage and fees. Python 3.10+, standard library only.

## The three agents

| Agent | Role | What it does each tick |
|-------|------|------------------------|
| `market` — **MarketDataAgent** | Market data | Publishes a price snapshot for every asset. With `--feed live` it pulls quotes from Yahoo Finance; any symbol it can't load is simulated (geometric Brownian motion with per-class volatility) and marked `*` in reports. |
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
python3 -m tradesim run                                   # 500 simulated hourly ticks
python3 -m tradesim run --seed 7 --ticks 2000 --report-every 250
python3 -m tradesim run --symbols AAPL,SPY,GOLD,BTC --trades-csv fills.csv
python3 -m tradesim run --feed live --interval 60 --ticks 480   # poll once a minute
```

Live mode: use `--feed live --interval 60 --ticks 480` to poll once a minute for
8 hours (Ctrl-C stops and prints the final report). Quotes come from Yahoo
Finance's unofficial chart endpoint and are delayed; stocks and ETFs only move
during market hours, while crypto trades 24/7. The 30-tick warm-up means the
trader waits 30 polls before its first proposal.

Useful flags: `--cash`, `--fast`, `--slow`, `--target-weight`, `--max-position`,
`--stop-loss`, `--max-drawdown`, `--seconds-per-tick` (simulated time per tick).

## Tests

```bash
cd trading-sim && python3 -m unittest -v
```

This is a simulator for learning and testing strategies, not investment advice.
The bundled strategy is a simple example and loses money to fees in sideways markets.

"""Command line: python -m tradesim run [options]"""

from __future__ import annotations

import argparse
import csv

from .agents import MarketDataAgent, RiskManagerAgent, TraderAgent
from .assets import DEFAULT_UNIVERSE
from .engine import Simulation
from .feeds import LiveFeed
from .portfolio import Portfolio


def build(args: argparse.Namespace) -> Simulation:
    assets = list(DEFAULT_UNIVERSE)
    if args.symbols:
        wanted = {s.upper() for s in args.symbols.split(",")}
        assets = [a for a in assets if a.symbol in wanted]
        if not assets:
            raise SystemExit(f"no known symbols in {args.symbols!r}")
    market = MarketDataAgent(assets, live=LiveFeed() if args.feed == "live" else None,
                             seconds_per_tick=args.seconds_per_tick, seed=args.seed)
    trader = TraderAgent(assets, fast=args.fast, slow=args.slow, target_weight=args.target_weight)
    risk = RiskManagerAgent(assets, max_position=args.max_position, stop_loss=args.stop_loss,
                            max_drawdown=args.max_drawdown)
    portfolio = Portfolio(cash=args.cash, assets={a.symbol: a for a in assets})
    return Simulation(market, trader, risk, portfolio)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="tradesim", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run", help="run the simulation")
    run.add_argument("--feed", choices=["sim", "live"], default="sim",
                     help="sim = generated prices; live = Yahoo Finance quotes, simulated on failure")
    run.add_argument("--ticks", type=int, default=500)
    run.add_argument("--interval", type=float, default=0.0, help="seconds to wait between ticks")
    run.add_argument("--report-every", type=int, default=100)
    run.add_argument("--seconds-per-tick", type=float, default=3600,
                     help="simulated market time per tick (sim feed)")
    run.add_argument("--seed", type=int, default=None)
    run.add_argument("--symbols", help="comma-separated subset, e.g. AAPL,SPY,GOLD,BTC")
    run.add_argument("--cash", type=float, default=100_000)
    run.add_argument("--fast", type=int, default=10)
    run.add_argument("--slow", type=int, default=30)
    run.add_argument("--target-weight", type=float, default=0.10)
    run.add_argument("--max-position", type=float, default=0.20)
    run.add_argument("--stop-loss", type=float, default=0.08)
    run.add_argument("--max-drawdown", type=float, default=0.20)
    run.add_argument("--trades-csv", help="write every fill to this CSV file")
    args = p.parse_args(argv)

    sim = build(args)
    print("Agents:")
    for agent in sim.agents:
        print(f"  {agent.name:<7} {agent.role}")

    def on_tick(s: Simulation, result) -> None:
        for f in result.fills:
            print(f"[{f.tick:>5}] FILL {f.side.value:<4} {f.quantity:g} {f.symbol} @ {f.price:,.2f}  ({f.reason})")
        if args.report_every and s.last.tick % args.report_every == 0:
            print(s.report())

    try:
        sim.run(args.ticks, interval=args.interval, on_tick=on_tick)
    except KeyboardInterrupt:
        print("\nstopped")
    if sim.last:
        print(sim.report())
    if args.trades_csv:
        with open(args.trades_csv, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["tick", "symbol", "side", "quantity", "price", "fee", "reason"])
            for f in sim.portfolio.fills:
                w.writerow([f.tick, f.symbol, f.side.value, f.quantity, f"{f.price:.6f}", f"{f.fee:.6f}", f.reason])
    return 0

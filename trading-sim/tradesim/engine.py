"""Runs the three agents tick by tick against a simulated broker."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from .agents import MarketDataAgent, RiskManagerAgent, TraderAgent
from .assets import AssetClass
from .messages import Fill, MarketSnapshot
from .portfolio import Portfolio


@dataclass
class TickResult:
    snapshot: MarketSnapshot
    fills: list[Fill] = field(default_factory=list)
    rejected: int = 0


class Simulation:
    def __init__(self, market: MarketDataAgent, trader: TraderAgent,
                 risk: RiskManagerAgent, portfolio: Portfolio) -> None:
        self.market, self.trader, self.risk = market, trader, risk
        self.portfolio = portfolio
        self.starting_equity = portfolio.cash
        self.last: MarketSnapshot | None = None

    @property
    def agents(self):
        return [self.market, self.trader, self.risk]

    def step(self) -> TickResult:
        snap = self.market.publish()
        self.last = snap
        result = TickResult(snap)
        pf = self.portfolio

        # 1. Risk manager acts first on stop-losses and the kill switch.
        exited = set()
        for order in self.risk.forced_exits(snap, pf):
            fill = pf.execute(snap.tick, order.symbol, order.side, order.quantity,
                              snap.prices[order.symbol], order.reason)
            if fill:
                result.fills.append(fill)
                exited.add(order.symbol)

        # 2. Trader proposes; 3. risk manager rules on each; 4. broker fills.
        for proposal in self.trader.propose(snap, pf):
            if proposal.symbol in exited:
                continue
            decision = self.risk.review(proposal, snap, pf)
            if not decision.approved:
                result.rejected += 1
                continue
            fill = pf.execute(snap.tick, proposal.symbol, proposal.side, decision.quantity,
                              snap.prices[proposal.symbol], proposal.reason)
            if fill:
                result.fills.append(fill)

        pf.equity_curve.append(pf.equity(snap.prices))
        return result

    def run(self, ticks: int, interval: float = 0.0, on_tick=None) -> None:
        for _ in range(ticks):
            result = self.step()
            if on_tick:
                on_tick(self, result)
            if interval:
                time.sleep(interval)

    # ---- reporting -------------------------------------------------------

    def exposure_by_class(self) -> dict[AssetClass, float]:
        prices = self.last.prices
        out = {c: 0.0 for c in AssetClass}
        for sym in self.portfolio.positions:
            out[self.market_asset(sym).asset_class] += self.portfolio.market_value(sym, prices)
        return out

    def market_asset(self, symbol: str):
        return next(a for a in self.market.assets if a.symbol == symbol)

    def max_drawdown(self) -> float:
        peak, worst = self.starting_equity, 0.0
        for eq in self.portfolio.equity_curve:
            peak = max(peak, eq)
            worst = max(worst, 1 - eq / peak)
        return worst

    def report(self, log_lines: int = 15) -> str:
        pf, prices = self.portfolio, self.last.prices
        equity = pf.equity(prices)
        lines = [
            "=" * 64,
            f"Tick {self.last.tick}  equity ${equity:,.2f}  "
            f"return {equity / self.starting_equity - 1:+.2%}  max drawdown {self.max_drawdown():.2%}",
            f"cash ${pf.cash:,.2f}  trades {len(pf.fills)}  fees ${pf.fees_paid:,.2f}  "
            f"{'HALTED' if self.risk.halted else 'trading'}",
            "",
            "Exposure by asset class:",
        ]
        for cls, value in self.exposure_by_class().items():
            lines.append(f"  {cls.value:<10} ${value:>12,.2f}  {value / equity:6.1%}")
        lines += ["", f"{'Symbol':<6} {'Class':<10} {'Price':>12} {'Qty':>12} {'Value':>12} {'P/L':>8}"]
        for asset in self.market.assets:
            pos = pf.positions.get(asset.symbol)
            price = prices[asset.symbol]
            src = "" if self.last.source[asset.symbol] == "live" else "*"
            if pos:
                pnl = price / pos.avg_cost - 1
                lines.append(f"{asset.symbol:<6} {asset.asset_class.value:<10} {price:>11,.2f}{src} "
                             f"{pos.quantity:>12g} {pos.quantity * price:>12,.2f} {pnl:>+8.1%}")
            else:
                lines.append(f"{asset.symbol:<6} {asset.asset_class.value:<10} {price:>11,.2f}{src}")
        lines.append("(* = simulated price)")
        logs = sorted(l for a in self.agents for l in a.log)[-log_lines:]
        if logs:
            lines += ["", "Recent agent activity:"] + [f"  {l}" for l in logs]
        return "\n".join(lines)

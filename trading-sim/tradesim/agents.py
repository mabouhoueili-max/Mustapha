"""The three agents.

MarketDataAgent  -- watches the market and publishes one price snapshot per tick.
TraderAgent      -- reads snapshots and proposes orders (moving-average trend strategy).
RiskManagerAgent -- approves, resizes or rejects every proposal, and forces exits
                    (stop-loss, drawdown kill switch) on its own.
"""

from __future__ import annotations

import math
import random
import time
from collections import deque

from .assets import Asset, AssetClass, round_lot
from .feeds import LiveFeed
from .messages import MarketSnapshot, OrderProposal, RiskDecision, Side
from .portfolio import Portfolio


class Agent:
    name = "agent"
    role = ""

    def __init__(self) -> None:
        self.log: list[str] = []

    def note(self, tick: int, text: str) -> None:
        self.log.append(f"[{tick:>5}] {self.name}: {text}")


class MarketDataAgent(Agent):
    name = "market"
    role = "Publishes prices for every asset: live quotes with --feed live, simulated otherwise."

    def __init__(self, assets: list[Asset], *, live: LiveFeed | None = None,
                 seconds_per_tick: float = 60.0, seed: int | None = None) -> None:
        super().__init__()
        self.assets = assets
        self.live = live
        self.dt = seconds_per_tick / (365 * 24 * 3600)  # fraction of a year
        self.rng = random.Random(seed)
        # Live mode starts with no prices: nothing is tradable until a real quote arrives.
        self.prices = {} if live else {a.symbol: a.start_price for a in assets}
        self.tick = 0
        self.clock = 0.0

    def _simulate(self, asset: Asset) -> float:
        """One geometric-Brownian-motion step with a little drift."""
        vol = asset.rules.annual_vol
        shock = self.rng.gauss(0, 1)
        step = (0.05 - 0.5 * vol ** 2) * self.dt + vol * math.sqrt(self.dt) * shock
        return self.prices[asset.symbol] * math.exp(step)

    def publish(self) -> MarketSnapshot:
        self.tick += 1
        if not self.live:
            self.clock += self.dt * 365 * 24 * 3600
            for asset in self.assets:
                self.prices[asset.symbol] = self._simulate(asset)
            return MarketSnapshot(self.tick, self.clock, dict(self.prices),
                                  {s: "sim" for s in self.prices})

        # Live: real quotes only. A failed quote keeps the last real price, marked stale.
        self.clock = time.time()
        quotes = self.live.quotes(self.assets)
        source = {}
        for asset in self.assets:
            if asset.symbol in quotes:
                self.prices[asset.symbol] = quotes[asset.symbol]
                source[asset.symbol] = "live"
            elif asset.symbol in self.prices:
                source[asset.symbol] = "stale"
        if self.live.last_errors:
            detail = "; ".join(f"{s} ({e})" for s, e in sorted(self.live.last_errors.items()))
            self.note(self.tick, f"no live quote for {detail}")
        return MarketSnapshot(self.tick, self.clock, dict(self.prices), source)

    def warmup_history(self, bars: int) -> dict[str, list[float]]:
        """Recent real 1-minute closes per symbol, so the trader can start at once."""
        if not self.live:
            return {}
        out = {}
        for asset in self.assets:
            closes = self.live.history(asset, bars)
            if closes:
                out[asset.symbol] = closes
        self.note(0, f"warm-up history loaded for {len(out)}/{len(self.assets)} symbols")
        return out


class TraderAgent(Agent):
    name = "trader"
    role = "Proposes trades: buys when the fast moving average crosses above the slow one, sells on the reverse."

    def __init__(self, assets: list[Asset], *, fast: int = 10, slow: int = 30,
                 target_weight: float = 0.10, band: float = 0.002) -> None:
        super().__init__()
        if fast >= slow:
            raise ValueError("fast window must be shorter than slow window")
        self.assets = {a.symbol: a for a in assets}
        self.fast, self.slow = fast, slow
        self.target_weight = target_weight
        self.band = band  # fast MA must clear the slow one by this fraction, to avoid whipsaws
        self.history = {s: deque(maxlen=slow) for s in self.assets}

    def seed_history(self, history: dict[str, list[float]]) -> None:
        for sym, closes in history.items():
            if sym in self.history:
                self.history[sym].extend(closes)

    def _averages(self, symbol: str) -> tuple[float, float] | None:
        h = self.history[symbol]
        if len(h) < self.slow:
            return None
        recent = list(h)
        return sum(recent[-self.fast:]) / self.fast, sum(recent) / self.slow

    def propose(self, snap: MarketSnapshot, portfolio: Portfolio) -> list[OrderProposal]:
        for sym, price in snap.prices.items():
            if snap.source.get(sym) in ("live", "sim"):
                self.history[sym].append(price)
        equity = portfolio.equity(snap.prices)
        orders = []
        for sym, asset in self.assets.items():
            if snap.source.get(sym) not in ("live", "sim"):
                continue  # no fresh price this tick: don't act on it
            avgs = self._averages(sym)
            if avgs is None:
                continue
            fast, slow = avgs
            held = portfolio.positions.get(sym)
            price = snap.prices[sym]
            if fast > slow * (1 + self.band) and not held:
                qty = round_lot(equity * self.target_weight / price, asset.rules.lot_size)
                if qty > 0:
                    orders.append(OrderProposal(sym, Side.BUY, qty,
                                                f"uptrend: MA{self.fast} {fast:.2f} > MA{self.slow} {slow:.2f}"))
            elif fast < slow * (1 - self.band) and held:
                orders.append(OrderProposal(sym, Side.SELL, held.quantity,
                                            f"downtrend: MA{self.fast} {fast:.2f} < MA{self.slow} {slow:.2f}"))
        for o in orders:
            self.note(snap.tick, f"propose {o.side.value} {o.quantity:g} {o.symbol} ({o.reason})")
        return orders


DEFAULT_CLASS_LIMITS = {
    AssetClass.STOCK: 0.50,
    AssetClass.ETF: 0.50,
    AssetClass.COMMODITY: 0.30,
    AssetClass.CRYPTO: 0.25,
}


class RiskManagerAgent(Agent):
    name = "risk"
    role = "Enforces position, asset-class and cash limits, stop-losses, and a drawdown kill switch."

    def __init__(self, assets: list[Asset], *, max_position: float = 0.20,
                 class_limits: dict[AssetClass, float] | None = None,
                 min_cash: float = 0.05, stop_loss: float = 0.08,
                 max_drawdown: float = 0.20, cooldown_ticks: int = 20) -> None:
        super().__init__()
        self.assets = {a.symbol: a for a in assets}
        self.max_position = max_position
        self.class_limits = class_limits or dict(DEFAULT_CLASS_LIMITS)
        self.min_cash = min_cash
        self.stop_loss = stop_loss
        self.max_drawdown = max_drawdown
        self.cooldown_ticks = cooldown_ticks
        self.cooldown_until: dict[str, int] = {}  # symbol -> tick when buys resume
        self.peak_equity = 0.0
        self.halted = False

    def _class_value(self, cls: AssetClass, portfolio: Portfolio, prices: dict[str, float]) -> float:
        return sum(portfolio.market_value(s, prices) for s in portfolio.positions
                   if self.assets[s].asset_class is cls)

    def forced_exits(self, snap: MarketSnapshot, portfolio: Portfolio) -> list[OrderProposal]:
        """Orders the risk manager raises on its own, before the trader is heard."""
        equity = portfolio.equity(snap.prices)
        self.peak_equity = max(self.peak_equity, equity)
        drawdown = 1 - equity / self.peak_equity if self.peak_equity else 0.0
        exits = []
        if not self.halted and drawdown >= self.max_drawdown:
            self.halted = True
            self.note(snap.tick, f"KILL SWITCH: drawdown {drawdown:.1%} >= {self.max_drawdown:.0%}; "
                                 "liquidating and halting new buys")
            for sym, pos in portfolio.positions.items():
                exits.append(OrderProposal(sym, Side.SELL, pos.quantity, "risk: drawdown kill switch"))
            return exits
        for sym, pos in portfolio.positions.items():
            loss = 1 - snap.prices[sym] / pos.avg_cost
            if loss >= self.stop_loss:
                self.note(snap.tick, f"stop-loss on {sym}: down {loss:.1%} from cost {pos.avg_cost:.2f}; "
                                     f"no buys for {self.cooldown_ticks} ticks")
                self.cooldown_until[sym] = snap.tick + self.cooldown_ticks
                exits.append(OrderProposal(sym, Side.SELL, pos.quantity, f"risk: stop-loss {loss:.1%}"))
        return exits

    def review(self, proposal: OrderProposal, snap: MarketSnapshot, portfolio: Portfolio) -> RiskDecision:
        decision = RiskDecision(proposal, approved=True, quantity=proposal.quantity)
        if proposal.side is Side.SELL:
            return decision  # reducing risk is always allowed

        if self.halted:
            return self._reject(decision, snap, "trading halted by kill switch")
        if snap.source.get(proposal.symbol) not in ("live", "sim"):
            return self._reject(decision, snap, "no fresh price")
        if snap.tick < self.cooldown_until.get(proposal.symbol, 0):
            return self._reject(decision, snap, "cooling down after stop-loss")

        asset = self.assets[proposal.symbol]
        price = snap.prices[proposal.symbol]
        equity = portfolio.equity(snap.prices)
        headroom = {
            f"position cap {self.max_position:.0%}":
                equity * self.max_position - portfolio.market_value(proposal.symbol, snap.prices),
            f"{asset.asset_class.value} cap {self.class_limits[asset.asset_class]:.0%}":
                equity * self.class_limits[asset.asset_class]
                - self._class_value(asset.asset_class, portfolio, snap.prices),
            f"cash buffer {self.min_cash:.0%}": portfolio.cash - equity * self.min_cash,
        }
        qty = proposal.quantity
        for limit, room in headroom.items():
            allowed = round_lot(max(room, 0) / price, asset.rules.lot_size)
            if allowed < qty:
                qty = allowed
                decision.notes.append(f"resized by {limit}")
        if qty <= 0:
            return self._reject(decision, snap, "; ".join(decision.notes) or "no room")
        decision.quantity = qty
        if decision.notes:
            self.note(snap.tick, f"resize buy {proposal.symbol} {proposal.quantity:g} -> {qty:g} "
                                 f"({'; '.join(decision.notes)})")
        return decision

    def _reject(self, decision: RiskDecision, snap: MarketSnapshot, why: str) -> RiskDecision:
        decision.approved = False
        decision.quantity = 0.0
        decision.notes.append(why)
        self.note(snap.tick, f"reject {decision.proposal.side.value} {decision.proposal.symbol}: {why}")
        return decision

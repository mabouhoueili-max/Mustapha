"""Simulated broker: cash, positions, fills with slippage and fees."""

from __future__ import annotations

from dataclasses import dataclass, field

from .assets import Asset, round_lot
from .messages import Fill, Side


@dataclass
class Position:
    quantity: float = 0.0
    avg_cost: float = 0.0


@dataclass
class Portfolio:
    cash: float
    assets: dict[str, Asset]
    positions: dict[str, Position] = field(default_factory=dict)
    fills: list[Fill] = field(default_factory=list)
    equity_curve: list[float] = field(default_factory=list)
    fees_paid: float = 0.0

    def position(self, symbol: str) -> Position:
        return self.positions.setdefault(symbol, Position())

    def market_value(self, symbol: str, prices: dict[str, float]) -> float:
        pos = self.positions.get(symbol)
        return pos.quantity * prices[symbol] if pos else 0.0

    def equity(self, prices: dict[str, float]) -> float:
        return self.cash + sum(self.market_value(s, prices) for s in self.positions)

    def fill_price(self, symbol: str, side: Side, mid: float) -> float:
        slip = self.assets[symbol].rules.slippage_bps / 10_000
        return mid * (1 + slip) if side is Side.BUY else mid * (1 - slip)

    def execute(self, tick: int, symbol: str, side: Side, quantity: float,
                mid: float, reason: str) -> Fill | None:
        """Fill an order at mid +/- slippage. Long-only: sells are capped at the
        position held and buys at the cash available."""
        asset = self.assets[symbol]
        quantity = round_lot(quantity, asset.rules.lot_size)
        price = self.fill_price(symbol, side, mid)
        fee_rate = asset.rules.fee_bps / 10_000
        pos = self.position(symbol)

        if side is Side.BUY:
            affordable = self.cash / (price * (1 + fee_rate))
            quantity = min(quantity, round_lot(affordable, asset.rules.lot_size))
        else:
            quantity = min(quantity, pos.quantity)
        if quantity <= 0:
            return None

        notional = quantity * price
        fee = notional * fee_rate
        if side is Side.BUY:
            new_qty = pos.quantity + quantity
            pos.avg_cost = (pos.avg_cost * pos.quantity + notional) / new_qty
            pos.quantity = new_qty
            self.cash -= notional + fee
        else:
            pos.quantity = round(pos.quantity - quantity, 10)
            self.cash += notional - fee
            if pos.quantity <= 0:
                del self.positions[symbol]
        self.fees_paid += fee
        fill = Fill(tick, symbol, side, quantity, price, fee, reason)
        self.fills.append(fill)
        return fill

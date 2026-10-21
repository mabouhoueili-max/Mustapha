"""Messages the three agents pass to each other."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"


@dataclass(frozen=True)
class MarketSnapshot:
    """Published by the market data agent once per tick."""
    tick: int
    timestamp: float
    prices: dict[str, float]
    source: dict[str, str]  # symbol -> "live" or "sim"


@dataclass(frozen=True)
class OrderProposal:
    """Sent by the trader agent to the risk manager."""
    symbol: str
    side: Side
    quantity: float
    reason: str


@dataclass
class RiskDecision:
    """The risk manager's ruling on one proposal (or an order it raised itself)."""
    proposal: OrderProposal
    approved: bool
    quantity: float
    notes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Fill:
    tick: int
    symbol: str
    side: Side
    quantity: float
    price: float
    fee: float
    reason: str

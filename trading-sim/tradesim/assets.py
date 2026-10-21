"""Tradable instruments and per-asset-class trading rules."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class AssetClass(str, Enum):
    STOCK = "stock"
    ETF = "etf"
    COMMODITY = "commodity"
    CRYPTO = "crypto"


@dataclass(frozen=True)
class ClassRules:
    lot_size: float        # smallest tradable quantity
    slippage_bps: float    # price impact applied to each fill
    fee_bps: float         # commission as a fraction of notional
    annual_vol: float      # volatility used by the simulated feed


CLASS_RULES: dict[AssetClass, ClassRules] = {
    AssetClass.STOCK: ClassRules(lot_size=1, slippage_bps=2, fee_bps=0.5, annual_vol=0.30),
    AssetClass.ETF: ClassRules(lot_size=1, slippage_bps=1, fee_bps=0.3, annual_vol=0.18),
    AssetClass.COMMODITY: ClassRules(lot_size=0.01, slippage_bps=5, fee_bps=2, annual_vol=0.25),
    AssetClass.CRYPTO: ClassRules(lot_size=0.0001, slippage_bps=10, fee_bps=10, annual_vol=0.70),
}


@dataclass(frozen=True)
class Asset:
    symbol: str          # internal symbol shown in reports
    name: str
    asset_class: AssetClass
    start_price: float   # seed price for the simulated feed
    live_symbol: str     # Yahoo Finance symbol for the live feed

    @property
    def rules(self) -> ClassRules:
        return CLASS_RULES[self.asset_class]


DEFAULT_UNIVERSE: list[Asset] = [
    Asset("AAPL", "Apple", AssetClass.STOCK, 230.0, "AAPL"),
    Asset("MSFT", "Microsoft", AssetClass.STOCK, 430.0, "MSFT"),
    Asset("NVDA", "Nvidia", AssetClass.STOCK, 130.0, "NVDA"),
    Asset("SPY", "S&P 500 ETF", AssetClass.ETF, 570.0, "SPY"),
    Asset("QQQ", "Nasdaq-100 ETF", AssetClass.ETF, 490.0, "QQQ"),
    Asset("GOLD", "Gold (oz)", AssetClass.COMMODITY, 2650.0, "GC=F"),
    Asset("OIL", "WTI crude (bbl)", AssetClass.COMMODITY, 72.0, "CL=F"),
    Asset("BTC", "Bitcoin", AssetClass.CRYPTO, 65000.0, "BTC-USD"),
    Asset("ETH", "Ether", AssetClass.CRYPTO, 2600.0, "ETH-USD"),
]


def round_lot(qty: float, lot: float) -> float:
    """Round a quantity down to a whole number of lots."""
    if qty <= 0:
        return 0.0
    lots = int(qty / lot + 1e-9)
    return round(lots * lot, 10)

"""Live quotes, no API keys needed.

- Crypto: Coinbase's public spot price API, then Yahoo Finance as a fallback.
- Stocks, ETFs, commodities: Yahoo Finance's chart endpoint (query1, then query2).

Quotes are delayed (Yahoo: up to ~15 min for some exchanges) and stocks/ETFs only
move during market hours. Any symbol that fails to load is left out of the result.
"""

from __future__ import annotations

import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Callable

from .assets import AssetClass

if TYPE_CHECKING:
    from .assets import Asset

YAHOO_HOSTS = ("query1.finance.yahoo.com", "query2.finance.yahoo.com")
YAHOO_CHART = "https://{host}/v8/finance/chart/{symbol}?range={range}&interval=1m"
COINBASE_SPOT = "https://api.coinbase.com/v2/prices/{symbol}/spot"


def _http_get(url: str, timeout: float) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 tradesim"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _positive(value) -> float | None:
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    return price if price > 0 else None


def parse_chart(payload: bytes) -> float | None:
    try:
        return _positive(json.loads(payload)["chart"]["result"][0]["meta"]["regularMarketPrice"])
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def parse_chart_closes(payload: bytes) -> list[float]:
    try:
        closes = json.loads(payload)["chart"]["result"][0]["indicators"]["quote"][0]["close"]
    except (KeyError, IndexError, TypeError, ValueError):
        return []
    return [p for p in map(_positive, closes or []) if p is not None]


def parse_coinbase(payload: bytes) -> float | None:
    try:
        return _positive(json.loads(payload)["data"]["amount"])
    except (KeyError, TypeError, ValueError):
        return None


class LiveFeed:
    def __init__(self, timeout: float = 5.0,
                 fetch: Callable[[str, float], bytes] | None = None) -> None:
        self.timeout = timeout
        self.fetch = fetch or (lambda url, timeout: _http_get(url, timeout))
        self.last_errors: dict[str, str] = {}  # symbol -> why its last quote failed

    def _get(self, url: str, parse):
        try:
            return parse(self.fetch(url, self.timeout)), None
        except Exception as exc:  # network errors, HTTP errors, timeouts
            return None, f"{type(exc).__name__}: {exc}"

    def _yahoo(self, asset: Asset, rng: str, parse):
        err = None
        for host in YAHOO_HOSTS:
            value, err = self._get(YAHOO_CHART.format(host=host, symbol=asset.live_symbol, range=rng), parse)
            if value:
                return value, None
        return None, err or "no price in Yahoo response"

    def _quote(self, asset: Asset) -> tuple[float | None, str | None]:
        if asset.asset_class is AssetClass.CRYPTO:
            price, err = self._get(COINBASE_SPOT.format(symbol=asset.live_symbol), parse_coinbase)
            if price:
                return price, None
        return self._yahoo(asset, "1d", parse_chart)

    def quotes(self, assets: list[Asset]) -> dict[str, float]:
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(self._quote, assets))
        self.last_errors = {a.symbol: err or "no price in response"
                            for a, (price, err) in zip(assets, results) if price is None}
        return {a.symbol: price for a, (price, _) in zip(assets, results) if price is not None}

    def history(self, asset: Asset, bars: int) -> list[float]:
        """Most recent 1-minute closes (oldest first), used to warm up the trader."""
        closes, _ = self._yahoo(asset, "5d", parse_chart_closes)
        return (closes or [])[-bars:]

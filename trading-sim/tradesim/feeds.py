"""Optional live quotes from Yahoo Finance's public chart endpoint (no API key).

Any symbol that fails to load is left out, and the market data agent
simulates it for that tick instead.
"""

from __future__ import annotations

import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from .assets import Asset

CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1m"


def _http_get(url: str, timeout: float) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 tradesim"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def parse_chart(payload: bytes) -> float | None:
    try:
        meta = json.loads(payload)["chart"]["result"][0]["meta"]
        price = float(meta["regularMarketPrice"])
    except (KeyError, IndexError, TypeError, ValueError):
        return None
    return price if price > 0 else None


class LiveFeed:
    def __init__(self, timeout: float = 5.0,
                 fetch: Callable[[str, float], bytes] = _http_get) -> None:
        self.timeout = timeout
        self.fetch = fetch

    def _quote(self, asset: Asset) -> float | None:
        try:
            return parse_chart(self.fetch(CHART_URL.format(symbol=asset.live_symbol), self.timeout))
        except Exception:
            return None

    def quotes(self, assets: list[Asset]) -> dict[str, float]:
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = pool.map(self._quote, assets)
        return {a.symbol: p for a, p in zip(assets, results) if p is not None}

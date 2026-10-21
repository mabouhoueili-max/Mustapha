import json
import unittest

from tradesim.agents import MarketDataAgent, RiskManagerAgent, TraderAgent
from tradesim.assets import DEFAULT_UNIVERSE, AssetClass, round_lot
from tradesim.cli import main
from tradesim.engine import Simulation
from tradesim.feeds import LiveFeed, parse_chart
from tradesim.messages import MarketSnapshot, OrderProposal, Side
from tradesim.portfolio import Portfolio

ASSETS = {a.symbol: a for a in DEFAULT_UNIVERSE}


def snap(prices, tick=1):
    return MarketSnapshot(tick, 0.0, prices, {s: "sim" for s in prices})


def portfolio(cash=100_000):
    return Portfolio(cash=cash, assets=ASSETS)


class AssetTests(unittest.TestCase):
    def test_round_lot(self):
        self.assertEqual(round_lot(10.9, 1), 10)
        self.assertEqual(round_lot(0.123456, 0.0001), 0.1234)
        self.assertEqual(round_lot(-1, 1), 0)

    def test_universe_covers_all_classes(self):
        self.assertEqual({a.asset_class for a in DEFAULT_UNIVERSE}, set(AssetClass))


class PortfolioTests(unittest.TestCase):
    def test_buy_then_sell_applies_slippage_and_fees(self):
        pf = portfolio()
        buy = pf.execute(1, "SPY", Side.BUY, 10, 500.0, "t")
        self.assertAlmostEqual(buy.price, 500 * 1.0001)
        self.assertAlmostEqual(pf.cash, 100_000 - 10 * buy.price - buy.fee)
        sell = pf.execute(2, "SPY", Side.SELL, 10, 500.0, "t")
        self.assertNotIn("SPY", pf.positions)
        self.assertLess(pf.cash, 100_000)  # round trip at a flat price loses costs
        self.assertAlmostEqual(pf.fees_paid, buy.fee + sell.fee)

    def test_buy_capped_by_cash_and_sell_by_position(self):
        pf = portfolio(cash=1_000)
        fill = pf.execute(1, "AAPL", Side.BUY, 100, 230.0, "t")
        self.assertEqual(fill.quantity, 4)
        fill = pf.execute(2, "AAPL", Side.SELL, 100, 230.0, "t")
        self.assertEqual(fill.quantity, 4)
        self.assertIsNone(pf.execute(3, "AAPL", Side.SELL, 1, 230.0, "t"))

    def test_fractional_crypto(self):
        pf = portfolio()
        fill = pf.execute(1, "BTC", Side.BUY, 0.123456, 60_000.0, "t")
        self.assertEqual(fill.quantity, 0.1234)


class MarketAgentTests(unittest.TestCase):
    def test_seeded_simulation_is_reproducible(self):
        a = MarketDataAgent(DEFAULT_UNIVERSE, seed=1)
        b = MarketDataAgent(DEFAULT_UNIVERSE, seed=1)
        self.assertEqual(a.publish().prices, b.publish().prices)

    def test_live_quotes_used_and_missing_ones_simulated(self):
        payload = json.dumps({"chart": {"result": [{"meta": {"regularMarketPrice": 61_234.5}}]}}).encode()

        def fetch(url, timeout):
            if "BTC-USD" in url:
                return payload
            raise OSError("offline")

        agent = MarketDataAgent(DEFAULT_UNIVERSE, live=LiveFeed(fetch=fetch), seed=1)
        s = agent.publish()
        self.assertEqual(s.prices["BTC"], 61_234.5)
        self.assertEqual(s.source["BTC"], "live")
        self.assertEqual(s.source["AAPL"], "sim")
        self.assertTrue(agent.log)

    def test_parse_chart_rejects_garbage(self):
        self.assertIsNone(parse_chart(b"{}"))
        self.assertIsNone(parse_chart(b"{\"chart\": {\"result\": null}}"))


class TraderTests(unittest.TestCase):
    def test_buys_uptrend_and_sells_downtrend(self):
        trader = TraderAgent([ASSETS["SPY"]], fast=2, slow=4, band=0)
        pf = portfolio()
        orders = []
        for i, price in enumerate([100, 100, 101, 102], 1):
            orders = trader.propose(snap({"SPY": price}, i), pf)
        self.assertEqual([o.side for o in orders], [Side.BUY])
        pf.execute(4, "SPY", Side.BUY, orders[0].quantity, 102, "t")
        for i, price in enumerate([99, 97], 5):
            orders = trader.propose(snap({"SPY": price}, i), pf)
        self.assertEqual([o.side for o in orders], [Side.SELL])

    def test_rejects_bad_windows(self):
        with self.assertRaises(ValueError):
            TraderAgent(DEFAULT_UNIVERSE, fast=30, slow=10)


class RiskTests(unittest.TestCase):
    def test_resizes_to_position_cap(self):
        risk = RiskManagerAgent(DEFAULT_UNIVERSE, max_position=0.10)
        d = risk.review(OrderProposal("SPY", Side.BUY, 100, "t"), snap({"SPY": 500.0}), portfolio())
        self.assertTrue(d.approved)
        self.assertEqual(d.quantity, 20)

    def test_crypto_class_cap(self):
        risk = RiskManagerAgent(DEFAULT_UNIVERSE, max_position=1.0)
        pf = portfolio()
        pf.execute(1, "BTC", Side.BUY, 0.4, 60_000.0, "t")  # ~24% in crypto
        prices = {"BTC": 60_000.0, "ETH": 3_000.0}
        d = risk.review(OrderProposal("ETH", Side.BUY, 5, "t"), snap(prices), pf)
        self.assertTrue(d.approved)
        self.assertLess(d.quantity, 0.5)  # only the ~1% left under the 25% crypto cap
        crypto_after = pf.market_value("BTC", prices) + d.quantity * prices["ETH"]
        self.assertLessEqual(crypto_after, 0.25 * pf.equity(prices) + 1e-6)
        pf.execute(2, "ETH", Side.BUY, d.quantity, prices["ETH"], "t")
        d = risk.review(OrderProposal("ETH", Side.BUY, 5, "t"), snap(prices), pf)
        self.assertFalse(d.approved)

    def test_stop_loss_and_cooldown(self):
        risk = RiskManagerAgent(DEFAULT_UNIVERSE, stop_loss=0.05, cooldown_ticks=10)
        pf = portfolio()
        pf.execute(1, "AAPL", Side.BUY, 10, 200.0, "t")
        exits = risk.forced_exits(snap({"AAPL": 185.0}, tick=2), pf)
        self.assertEqual([(e.symbol, e.side) for e in exits], [("AAPL", Side.SELL)])
        pf.execute(2, "AAPL", Side.SELL, 10, 185.0, "t")
        d = risk.review(OrderProposal("AAPL", Side.BUY, 1, "t"), snap({"AAPL": 185.0}, tick=5), pf)
        self.assertFalse(d.approved)
        d = risk.review(OrderProposal("AAPL", Side.BUY, 1, "t"), snap({"AAPL": 185.0}, tick=12), pf)
        self.assertTrue(d.approved)

    def test_kill_switch_liquidates_and_halts(self):
        risk = RiskManagerAgent(DEFAULT_UNIVERSE, max_drawdown=0.10, stop_loss=1.0)
        pf = portfolio()
        pf.execute(1, "BTC", Side.BUY, 1.5, 60_000.0, "t")
        risk.forced_exits(snap({"BTC": 60_000.0}, 1), pf)
        exits = risk.forced_exits(snap({"BTC": 50_000.0}, 2), pf)
        self.assertTrue(risk.halted)
        self.assertEqual(exits[0].side, Side.SELL)
        d = risk.review(OrderProposal("SPY", Side.BUY, 1, "t"), snap({"SPY": 500.0}, 3), pf)
        self.assertFalse(d.approved)

    def test_sells_always_allowed(self):
        risk = RiskManagerAgent(DEFAULT_UNIVERSE)
        risk.halted = True
        d = risk.review(OrderProposal("SPY", Side.SELL, 1, "t"), snap({"SPY": 500.0}), portfolio())
        self.assertTrue(d.approved)


class SimulationTests(unittest.TestCase):
    def test_full_run_respects_limits(self):
        market = MarketDataAgent(DEFAULT_UNIVERSE, seed=3, seconds_per_tick=3600)
        trader = TraderAgent(DEFAULT_UNIVERSE)
        risk = RiskManagerAgent(DEFAULT_UNIVERSE)
        sim = Simulation(market, trader, risk, portfolio())

        def check(s, result):
            eq = s.portfolio.equity(s.last.prices)
            self.assertGreaterEqual(s.portfolio.cash, -1e-6)
            crypto = s.exposure_by_class()[AssetClass.CRYPTO]
            self.assertLessEqual(crypto / eq, 0.25 * 1.15)  # cap at entry, plus price drift

        sim.run(400, on_tick=check)
        self.assertEqual(len(sim.portfolio.equity_curve), 400)
        self.assertTrue(sim.portfolio.fills)
        self.assertIn("Exposure by asset class", sim.report())

    def test_cli_runs(self):
        import contextlib, io, os, tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "fills.csv")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                rc = main(["run", "--ticks", "120", "--seed", "1", "--report-every", "0",
                           "--symbols", "AAPL,SPY,GOLD,BTC", "--trades-csv", path])
            self.assertEqual(rc, 0)
            self.assertIn("Agents:", out.getvalue())
            with open(path) as fh:
                self.assertTrue(fh.readline().startswith("tick,symbol"))


if __name__ == "__main__":
    unittest.main()

import datetime as dt
import os
import tempfile
import unittest
from unittest import mock

import time

from boatrace import fetch, parse, predict, secure, update

FX = os.path.join(os.path.dirname(__file__), "fixtures")


def fx(name):
    with open(os.path.join(FX, name + ".html"), encoding="utf-8") as f:
        return f.read()


class ParseTest(unittest.TestCase):
    def test_index(self):
        v = parse.parse_index(fx("index"))
        self.assertEqual([x["jcd"] for x in v], ["01", "12"])
        self.assertEqual(v[0]["name"], "桐生")
        self.assertEqual(v[0]["title"], "第1回 桐生カップ")
        self.assertEqual(v[0]["day"], "2日目")

    def test_racelist(self):
        r = parse.parse_racelist(fx("racelist"))
        self.assertEqual(len(r["deadlines"]), 12)
        self.assertEqual(r["distance"], 1800)
        b = r["boats"][0]
        self.assertEqual((b["waku"], b["toban"], b["name"], b["cls"]), (1, "4001", "峰竜太", "A1"))
        self.assertEqual((b["nat_win"], b["loc_win"], b["motor_no"], b["motor_2"]), (7.5, 6.7, 11, 33.0))
        self.assertEqual(b["avg_st"], 0.11)
        self.assertEqual(r["boats"][2]["f"], 1)
        self.assertEqual(b["age"], 31)

    def test_beforeinfo(self):
        info = parse.parse_beforeinfo(fx("beforeinfo"))
        self.assertEqual(info["boats"][3]["ex_time"], 6.70)
        self.assertEqual(info["boats"][1]["tilt"], -0.5)
        self.assertEqual([s["waku"] for s in info["start"]], [1, 3, 2, 4, 5, 6])
        self.assertLess(info["start"][5]["st"], 0)  # フライング
        self.assertEqual(info["weather"]["風速"], "3m")
        self.assertEqual(info["weather"]["wind_dir"], 5)
        self.assertTrue(parse.has_exhibition(info))

    def test_odds(self):
        o = parse.parse_odds3t(fx("odds3t"))
        self.assertEqual(len(o), 120)
        for k, v in o.items():
            self.assertEqual(int(k.replace("-", "")), int(v))
        self.assertEqual(parse.parse_oddstf(fx("oddstf"))[1], 1.4)

    def test_result(self):
        r = parse.parse_result(fx("raceresult"))
        self.assertEqual([o["waku"] for o in r["order"]], [1, 3, 2, 5, 4, 6])
        self.assertEqual(r["order"][0]["rank"], 1)
        self.assertEqual(r["trifecta"], "1-3-2")
        self.assertEqual(r["payout"], 1230)

    def test_racer_pages(self):
        recent = parse.parse_back3(fx("back3"))
        self.assertEqual(recent[0], {"venue": "大村", "date": None, "finish": "4"} | {"date": recent[0]["date"]})
        self.assertEqual([r["finish"] for r in recent[:6]], ["4", "F", "1", "3", "2", "1"])
        self.assertEqual(len(recent), 12)
        c = parse.parse_course(fx("course"))
        self.assertEqual(c[1]["3連対率"], 80.0)
        self.assertEqual(predict.best_course(c)["course"], 2)  # 全国平均との差が最も大きいコース


class PredictTest(unittest.TestCase):
    def race(self, **kw):
        boats = parse.parse_racelist(fx("racelist"))["boats"]
        return dict({"boats": boats}, **kw)

    def test_probs_sum_and_marks(self):
        p = predict.predict(self.race())
        self.assertAlmostEqual(sum(p["probs"].values()), 1.0, places=3)
        self.assertEqual(p["marks"][1], "◎")
        self.assertEqual(sorted(p["marks"].values()).count("◎"), 1)
        self.assertAlmostEqual(sum(predict.trifecta_probs(p["probs"]).values()), 1.0, places=6)

    def test_exhibition_changes_prediction(self):
        info = parse.parse_beforeinfo(fx("beforeinfo"))
        before = self.race()
        after = self.race(start=info["start"])
        for b in after["boats"]:
            b["ex_time"] = info["boats"][b["waku"]]["ex_time"]
        p0, p1 = predict.predict(before), predict.predict(after)
        self.assertGreater(p1["probs"][3], p0["probs"][3])  # 展示1位・2コース進入
        self.assertEqual(p1["course"][3], 2)

    def test_odds_ev(self):
        o3 = parse.parse_odds3t(fx("odds3t"))
        p = predict.predict(self.race(odds3t=o3, odds_win=parse.parse_oddstf(fx("oddstf"))))
        top = p["picks"][0]
        self.assertEqual(top["odds"], o3[top["combo"]])
        self.assertAlmostEqual(top["ev"], round(top["prob"] * top["odds"], 2))


class FetchTest(unittest.TestCase):
    def test_pmap_keeps_order_and_runs_in_parallel(self):
        def slow(x):
            time.sleep(0.2)
            return x * 2
        t0 = time.monotonic()
        self.assertEqual(fetch.pmap(slow, range(6)), [0, 2, 4, 6, 8, 10])
        self.assertLess(time.monotonic() - t0, 0.6)  # 順番に処理すれば1.2秒かかる

    def test_access_start_is_spaced(self):
        starts = []
        with mock.patch.object(fetch, "INTERVAL", 0.05), \
                mock.patch.object(fetch.urllib.request, "urlopen",
                                  side_effect=lambda *a, **k: starts.append(time.monotonic()) or mock.MagicMock()):
            fetch.pmap(lambda i: fetch.get("/x", i=i), range(6))
        starts.sort()
        self.assertTrue(all(b - a >= 0.045 for a, b in zip(starts, starts[1:])))


class BugfixTest(unittest.TestCase):
    def test_scratched_boat_excluded(self):
        boats = parse.parse_racelist(fx("racelist"))["boats"]
        o3 = {k: v for k, v in parse.parse_odds3t(fx("odds3t")).items() if "4" not in k}
        p = predict.predict({"boats": boats, "odds3t": o3})
        self.assertNotIn(4, p["probs"])
        self.assertTrue(all("4" not in x["combo"] for x in p["picks"]))
        self.assertAlmostEqual(sum(p["probs"].values()), 1.0, places=3)

    def test_password_change_rebuilds(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "a.json")
            with mock.patch.dict(os.environ, {"BOATRACE_PASSWORD": "old"}):
                update.save_json(path, {"x": 1})
            with mock.patch.dict(os.environ, {"BOATRACE_PASSWORD": "new"}):
                self.assertEqual(update.load_json(path, "default"), "default")

    def test_official_recent_not_double_counted(self):
        store = update.RacerStore.__new__(update.RacerStore)
        store.cache = {"4001": {"recent": [
            {"venue": "桐生", "date": "2026/10/26", "finish": "1"},
            {"venue": "大村", "date": "2026/10/10", "finish": "2"}]}}
        store.history = {"4001": [{"date": "20261028", "jcd": "01", "rno": 1, "finish": 3}]}
        recent = store.summary("4001")["recent"]
        self.assertEqual([(r["venue"], str(r["finish"])) for r in recent], [("桐生", "3"), ("大村", "2")])


class LongshotTest(unittest.TestCase):
    def race(self, **kw):
        return dict({"boats": parse.parse_racelist(fx("racelist"))["boats"]}, **kw)

    def test_without_odds_picks_outer_boat(self):
        p = predict.predict(self.race())
        ana = p["ana"]
        self.assertGreaterEqual(p["course"][ana["boat"]], 4)
        self.assertNotIn(p["marks"][ana["boat"]], ("◎", "○", "▲"))
        self.assertEqual(len(ana["picks"]), 3)
        normal = {x["combo"] for x in p["picks"]}
        for x in ana["picks"]:
            self.assertNotIn(x["combo"], normal)
            self.assertIn(str(ana["boat"]), x["combo"].split("-")[:2])

    def test_with_odds_picks_undervalued_boat_and_high_payouts(self):
        # 5号艇を極端な不人気にして、予想との差が最も大きくなるようにする
        win = {1: 1.2, 2: 4.0, 3: 6.0, 4: 15.0, 5: 300.0, 6: 80.0}
        o3 = {k: 10.0 * (i + 1) for i, k in enumerate(sorted(predict.trifecta_probs({w: 1 / 6 for w in range(1, 7)})))}
        p = predict.predict(self.race(odds_win=win, odds3t=o3))
        ana = p["ana"]
        self.assertEqual(ana["boat"], 5)
        self.assertIn("人気", ana["reason"])
        self.assertTrue(all(x["odds"] >= 20 for x in ana["picks"]))
        evs = [x["ev"] for x in ana["picks"]]
        self.assertEqual(evs, sorted(evs, reverse=True))


class LongshotAlwaysTest(unittest.TestCase):
    def test_every_race_gets_a_longshot_even_when_odds_match_the_model(self):
        boats = parse.parse_racelist(fx("racelist"))["boats"]
        p = predict.predict({"boats": boats, "odds_win": parse.parse_oddstf(fx("oddstf")),
                             "odds3t": parse.parse_odds3t(fx("odds3t"))})
        self.assertIsNotNone(p["ana"])
        self.assertNotIn(p["marks"][p["ana"]["boat"]], ("◎", "○", "▲"))


class UpdateTest(unittest.TestCase):
    """fetch を差し替えて prep → live（展示・オッズ・結果）の一連を確認する。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [mock.patch.object(update, "OUT_DIR", os.path.join(self.tmp.name, "out")),
                        mock.patch.object(update, "STATE_DIR", os.path.join(self.tmp.name, "state")),
                        mock.patch.object(update.fetch, "index", lambda hd: fx("index")),
                        mock.patch.object(update.fetch, "race_page", self.race_page),
                        mock.patch.object(update.fetch, "racer_page", lambda k, t: fx(k))]
        for p in self.patches:
            p.start()
        self.exhibited = False

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def race_page(self, kind, jcd, rno, hd):
        if kind == "beforeinfo" and not self.exhibited:
            return "<html></html>"
        if kind == "pcexpect":
            return None
        return fx(kind)

    def test_flow(self):
        hd = "20261028"
        day = update.prep(hd)
        update.write(day)
        r = day["venues"][0]["races"][0]
        self.assertEqual(r["stage"], "前日データ")
        self.assertEqual(r["deadline"], "10:00")
        self.assertEqual(len(day["racers"]["4001"]["recent"]), 10)
        pre_marks = dict(r["pre"]["marks"])

        jst = update.JST
        # 締切20分前・展示前: 前日データのまま、オッズは入る
        day = update.live(hd, now=dt.datetime(2026, 10, 28, 9, 40, tzinfo=jst))
        update.write(day)
        r = day["venues"][0]["races"][0]
        self.assertEqual(r["stage"], "前日データ")
        self.assertTrue(r["odds3t"])
        # 展示後
        self.exhibited = True
        day = update.live(hd, now=dt.datetime(2026, 10, 28, 9, 50, tzinfo=jst))
        update.write(day)
        r = day["venues"][0]["races"][0]
        self.assertEqual(r["stage"], "展示反映")
        self.assertEqual({str(k): v for k, v in r["pre"]["marks"].items()},
                         {str(k): v for k, v in pre_marks.items()})
        # レース後: 結果と的中判定、自前の記録
        day = update.live(hd, now=dt.datetime(2026, 10, 28, 10, 10, tzinfo=jst))
        update.write(day)
        r = day["venues"][0]["races"][0]
        self.assertEqual(r["result"]["trifecta"], "1-3-2")
        self.assertIn("live", r["hits"])
        self.assertGreaterEqual(day["hits"]["live"][0], 1)
        store = update.RacerStore()
        self.assertEqual(store.history["4001"][0]["finish"], 1)
        # 結果が出ないまま締切から90分を過ぎたレースは取りに行かない
        calls = []
        with mock.patch.object(update.fetch, "race_page", lambda k, j, r, h: calls.append((k, r)) or None):
            update.live(hd, now=dt.datetime(2026, 10, 28, 23, 0, tzinfo=jst))
        self.assertEqual(calls, [])
        self.assertEqual(store.summary("4003")["recent"][0]["course"], 2)


class SecureTest(unittest.TestCase):
    def test_roundtrip(self):
        data = {"date": "20261028", "名前": "峰竜太"}
        enc = secure.encrypt(data, "pw")
        self.assertTrue(secure.is_encrypted(enc))
        self.assertNotIn("峰", str(enc))
        self.assertEqual(secure.decrypt(enc, "pw"), data)
        with self.assertRaises(Exception):
            secure.decrypt(enc, "wrong")

    def test_past_days_are_dropped(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(update, "OUT_DIR", tmp), \
                mock.patch.object(update, "now_jst", lambda: dt.datetime(2026, 10, 28, 9, 0, tzinfo=update.JST)):
            for d in ("20261026", "20261027", "20261028", "20261029"):
                update.write({"date": d, "updated": "x", "venues": []})
            self.assertEqual(update.load_json(os.path.join(tmp, "index.json"), None)["dates"],
                             ["20261028", "20261029"])
            self.assertEqual(sorted(f for f in os.listdir(tmp) if f[0].isdigit()),
                             ["20261028.json", "20261029.json"])

    def test_files_encrypted_with_password(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"BOATRACE_PASSWORD": "pw"}), \
                mock.patch.object(update, "OUT_DIR", tmp):
            update.write({"date": "20261028", "updated": "x", "venues": []})
            with open(os.path.join(tmp, "20261028.json"), encoding="utf-8") as f:
                self.assertIn('"enc":"aes-gcm"', f.read())
            self.assertEqual(update.load_json(os.path.join(tmp, "20261028.json"), None)["date"], "20261028")
            self.assertTrue(update.load_json(os.path.join(tmp, "index.json"), None)["encrypted"])

    def test_actions_requires_password(self):
        env = {k: v for k, v in os.environ.items() if k != "BOATRACE_PASSWORD"}
        env["GITHUB_ACTIONS"] = "true"
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(update.main(["live"]), 1)


if __name__ == "__main__":
    unittest.main()

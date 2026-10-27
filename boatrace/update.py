"""予想ページ用のデータ（docs/boatrace/data/YYYYMMDD.json）を作る・更新する。

  python -m boatrace.update prep --date 20261028   # 前日〜朝: 出走表と選手データから前日予想
  python -m boatrace.update live                   # 当日: 展示・オッズ・結果を取り込んで直前予想へ更新

live は締切が近いレースだけを取りに行くので、10分おき程度に何度実行してもよい。
展示が取れない・サイトに繋がらないときは、前日予想をそのまま表示に使う。
"""
import argparse
import datetime as dt
import json
import os
import sys
import threading
import time

from . import fetch, parse, secure
from .predict import best_course, predict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "docs", "boatrace", "data")
STATE_DIR = os.path.join(ROOT, "boatrace", "state")
JST = dt.timezone(dt.timedelta(hours=9))

RESULT_GIVE_UP_MIN = 90  # 締切からこれだけ過ぎても結果が取れなければ諦める
RECENT_TTL_DAYS = 1   # 直近成績の取り直し間隔
COURSE_TTL_DAYS = 7   # コース別成績の取り直し間隔
HISTORY_KEEP = 40     # 選手ごとに残す自前の結果記録数
RACER_BUDGET_SEC = 25 * 60  # 選手ページの取得にかける上限。超えたら残りは前回の記録を使う


def now_jst():
    return dt.datetime.now(JST)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return default
    if secure.is_encrypted(data):
        try:
            return secure.decrypt(data, secure.password())
        except Exception:  # パスワード変更後の古いデータなど。読めないものは作り直す
            log(f"{os.path.basename(path)} を復号できないため作り直します")
            return default
    return data


def save_json(path, data, compact=True, encrypt=True):
    """BOATRACE_PASSWORD があれば暗号化して保存する（index.json のような目次は encrypt=False）。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pw = secure.password()
    if encrypt and pw:
        data = secure.encrypt(data, pw)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        if compact:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def day_path(hd):
    return os.path.join(OUT_DIR, f"{hd}.json")


def deadline_dt(hd, hhmm):
    if not hhmm:
        return None
    h, m = map(int, hhmm.split(":"))
    d = dt.datetime.strptime(hd, "%Y%m%d").replace(tzinfo=JST)
    return d + dt.timedelta(hours=h, minutes=m)


# ---------------------------------------------------------------- 選手データ

class RacerStore:
    """選手ごとの直近成績・コース別成績のキャッシュと、自前で貯める結果記録。"""

    def __init__(self):
        self.cache = load_json(os.path.join(STATE_DIR, "racers.json"), {})
        self.history = load_json(os.path.join(STATE_DIR, "history.json"), {})

    def save(self):
        save_json(os.path.join(STATE_DIR, "racers.json"), self.cache)
        save_json(os.path.join(STATE_DIR, "history.json"), self.history)

    def refresh(self, toban, today, online=True):
        c = self.cache.setdefault(toban, {})
        if online and _older(c.get("recent_at"), today, RECENT_TTL_DAYS):
            html = fetch.racer_page("back3", toban)
            if html:
                recent = parse.parse_back3(html)
                if recent:
                    c["recent"] = recent[:20]
                c["recent_at"] = today
        if online and _older(c.get("course_at"), today, COURSE_TTL_DAYS):
            html = fetch.racer_page("course", toban)
            if html:
                stats = parse.parse_course(html)
                if stats:
                    c["course_stats"] = {str(k): v for k, v in stats.items()}
                c["course_at"] = today
        return c

    def add_result(self, toban, rec):
        h = self.history.setdefault(toban, [])
        key = (rec["date"], rec["jcd"], rec["rno"])
        if any((r["date"], r["jcd"], r["rno"]) == key for r in h):
            return
        h.insert(0, rec)
        h.sort(key=lambda r: (r["date"], r.get("rno", 0)), reverse=True)
        del h[HISTORY_KEEP:]

    def summary(self, toban):
        """ページに載せる選手情報: 直近10走・得意コース・得意場。"""
        c = self.cache.get(toban, {})
        own = self.history.get(toban, [])
        # 自前の記録（コース・ST つき）を優先し、足りない分を公式の直近3節で補う
        recent = [{"date": r["date"], "venue": parse.VENUES.get(r["jcd"], r["jcd"]),
                   "course": r.get("course"), "st": r.get("st"), "finish": r["finish"]}
                  for r in own[:10]]
        official = [r for r in c.get("recent", []) if not _covered(r, own)]
        for r in official:
            if len(recent) >= 10:
                break
            recent.append({"date": r.get("date"), "venue": r["venue"], "finish": r["finish"]})
        course_stats = {int(k): v for k, v in (c.get("course_stats") or {}).items()}

        # 得意場: 自前記録・直近3節の場ごとの平均着順（3走以上）
        by_venue = {}
        for r in own + [dict(x, jcd=parse.VENUE_BY_NAME.get(x["venue"])) for x in official]:
            f = r.get("finish")
            if not (isinstance(f, int) or str(f).isdigit()):
                continue
            v = parse.VENUES.get(r.get("jcd")) or r.get("venue")
            by_venue.setdefault(v, []).append(int(f))
        venues = sorted(((v, len(fs), sum(fs) / len(fs)) for v, fs in by_venue.items() if len(fs) >= 3),
                        key=lambda x: x[2])
        # 得意コース（自前記録）: コースごとの平均着順
        by_course = {}
        for r in own:
            f = r.get("finish")
            if r.get("course") and (isinstance(f, int) or str(f).isdigit()):
                by_course.setdefault(r["course"], []).append(int(f))
        return {
            "recent": recent[:10],
            "course_stats": course_stats,
            "best_course": best_course(course_stats),
            "venue_stats": [{"venue": v, "n": n, "avg": round(a, 2)} for v, n, a in venues[:3]],
            "course_avg": {c: round(sum(fs) / len(fs), 2) for c, fs in sorted(by_course.items())},
        }


def _covered(official, own):
    """公式の直近3節の1走が、自前の記録にある節（同じ場で開始日から7日以内）に含まれるか。"""
    d = (official.get("date") or "").split("-")[0]
    try:
        start = dt.datetime.strptime(d, "%Y/%m/%d")
    except ValueError:
        return False
    jcd = parse.VENUE_BY_NAME.get(official.get("venue"))
    for r in own:
        if r.get("jcd") != jcd:
            continue
        day = dt.datetime.strptime(r["date"], "%Y%m%d")
        if 0 <= (day - start).days <= 7:
            return True
    return False


def _older(stamp, today, days):
    if not stamp:
        return True
    try:
        a = dt.datetime.strptime(stamp, "%Y%m%d")
        b = dt.datetime.strptime(today, "%Y%m%d")
    except ValueError:
        return True
    return (b - a).days >= days


# ---------------------------------------------------------------- 予想の組み立て

def race_input(race, racers):
    boats = []
    for b in race["boats"]:
        info = racers.get(b["toban"], {})
        bb = dict(b, recent=info.get("recent", []), course_stats=info.get("course_stats"))
        ex = (race.get("before") or {}).get("boats", {}).get(str(b["waku"])) or {}
        bb["ex_time"] = ex.get("ex_time")
        boats.append(bb)
    before = race.get("before") or {}
    return {
        "boats": boats,
        "start": before.get("start") or [],
        "weather": before.get("weather") or {},
        "odds_win": race.get("odds_win") or {},
        "odds3t": race.get("odds3t") or {},
        "pc": race.get("pc") or {},
    }


def repredict(race, racers):
    """前日予想（展示前）と最新予想を作り直す。前日予想は展示が入った後は固定する。"""
    if not race.get("boats"):
        return
    inp = race_input(race, racers)
    exhibited = parse.has_exhibition(race.get("before"))
    if not exhibited or not race.get("pre"):
        pre_inp = dict(inp, start=[], weather={},
                       boats=[dict(b, ex_time=None) for b in inp["boats"]])
        race["pre"] = predict(pre_inp)
    race["live"] = predict(inp)
    race["stage"] = "展示反映" if exhibited else "前日データ"
    _score_hits(race)


def _score_hits(race):
    res = race.get("result") or {}
    tri = res.get("trifecta")
    if not tri:
        return
    win = int(tri.split("-")[0])
    hits = {}
    for key in ("pre", "live"):
        p = race.get(key)
        if not p:
            continue
        top5 = [x["combo"] for x in p["picks"][:5]]
        hon = next((int(k) for k, m in p["marks"].items() if m == "◎"), None)
        hits[key] = {"win": hon == win, "trifecta": tri in top5}
    race["hits"] = hits


# ---------------------------------------------------------------- 取得処理

def prep(hd, online=True, with_racers=True):
    """前日予想を作る。既存データがあれば締切後の情報（展示・結果）は残す。"""
    old = load_json(day_path(hd), None)
    html = fetch.index(hd) if online else None
    venues = parse.parse_index(html) if html else []
    if not venues and old:
        log("開催一覧が取れないため既存データを使います")
        return old
    if not venues:
        log(f"{hd}: 開催情報を取得できませんでした")
        return None

    old_races = {(v["jcd"], r["rno"]): r for v in (old or {}).get("venues", []) for r in v["races"]}
    store = RacerStore()
    day = {"date": hd, "venues": [], "racers": {}}
    tasks = [(v["jcd"], rno) for v in venues if not v["canceled"] for rno in range(1, 13)]
    pages = dict(zip(tasks, fetch.pmap(lambda t: fetch.race_page("racelist", t[0], t[1], hd), tasks)))
    for v in venues:
        v["races"] = []
        if not v["canceled"]:
            for rno in range(1, 13):
                html = pages.get((v["jcd"], rno))
                rl = parse.parse_racelist(html) if html else None
                prev = old_races.get((v["jcd"], rno), {})
                if not rl or not rl["boats"]:
                    if prev:
                        v["races"].append(prev)
                    continue
                race = dict(prev)
                race.update({"rno": rno, "title": rl["race_title"], "distance": rl["distance"],
                             "boats": rl["boats"]})
                if rl["deadlines"] and len(rl["deadlines"]) >= rno:
                    race["deadline"] = rl["deadlines"][rno - 1]
                v["races"].append(race)
            log(f"{v['name']}: {len(v['races'])}R")
        day["venues"].append(v)

    tobans = {b["toban"] for v in day["venues"] for r in v["races"] for b in r.get("boats", [])}
    if with_racers:
        started = time.monotonic()
        order = sorted(tobans)
        chunk = 60
        for i in range(0, len(order), chunk):
            if time.monotonic() - started > RACER_BUDGET_SEC:
                log(f"選手データの取得を時間切れで打ち切りました（{i}/{len(order)}）。残りは次回取得します")
                break
            fetch.pmap(lambda t: store.refresh(t, hd, online), order[i:i + chunk])
            log(f"選手データ {min(i + chunk, len(order))}/{len(order)}")
            store.save()  # 途中で止まっても取れた分は次回に引き継ぐ
        store.save()
    day["racers"] = {t: store.summary(t) for t in tobans}

    # 公式のコンピュータ予想は当日の live で締切前に取る（前日には出ていないことが多い）
    for v in day["venues"]:
        for r in v["races"]:
            repredict(r, day["racers"])
    finish(day)
    return day


def live(hd, now=None, online=True):
    """当日の更新。締切前後のレースだけ展示・オッズ・結果を取り込む。"""
    now = now or now_jst()
    day = load_json(day_path(hd), None)
    if not day:
        day = prep(hd, online)
        if not day:
            return None
    store = RacerStore()
    lock = threading.Lock()
    todo = [(v, r) for v in day["venues"] for r in v["races"]
            if deadline_dt(hd, r.get("deadline")) is not None and not r.get("result")]
    recorded = fetch.pmap(lambda vr: _live_race(hd, vr[0], vr[1], now, day["racers"], store, lock), todo)
    changed_racers = any(recorded)
    if changed_racers:
        store.save()
    finish(day, now)
    return day


def _live_race(hd, v, r, now, racers, store, lock):
    """1レースぶんの展示・オッズ・結果を取り込む。結果を記録したら True。"""
    mins = (deadline_dt(hd, r["deadline"]) - now).total_seconds() / 60
    got = recorded = False
    if -3 <= mins <= 35:
        html = fetch.race_page("beforeinfo", v["jcd"], r["rno"], hd)
        info = parse.parse_beforeinfo(html) if html else None
        if info and parse.has_exhibition(info):
            info["boats"] = {str(k): x for k, x in info["boats"].items()}
            r["before"] = info
            got = True
        if not r.get("pc") and not r.get("pc_tried"):
            r["pc_tried"] = True
            html = fetch.race_page("pcexpect", v["jcd"], r["rno"], hd)
            pc = parse.parse_pcexpect(html) if html else None
            if pc and (pc["marks"] or pc["focus"]):
                r["pc"] = pc
    stale = _age_min(r.get("odds_at"), now)
    if -2 <= mins <= 60 or (60 < mins <= 180 and stale >= 30):
        html = fetch.race_page("oddstf", v["jcd"], r["rno"], hd)
        win = parse.parse_oddstf(html) if html else {}
        if win:
            r["odds_win"] = {str(k): x for k, x in win.items()}
            r["odds_at"] = now.strftime("%H:%M")
            got = True
        if mins <= 60:
            html = fetch.race_page("odds3t", v["jcd"], r["rno"], hd)
            o3 = parse.parse_odds3t(html) if html else {}
            if o3:
                r["odds3t"] = o3
                r["odds_at"] = now.strftime("%H:%M")
                got = True
    if -RESULT_GIVE_UP_MIN <= mins <= -6:
        html = fetch.race_page("raceresult", v["jcd"], r["rno"], hd)
        res = parse.parse_result(html) if html else None
        if res and res["order"]:
            r["result"] = res
            with lock:
                _record(store, hd, v["jcd"], r, res)
            recorded = got = True
    if got:
        r["updated"] = now.strftime("%H:%M")
        repredict(r, racers)
    return recorded


def _age_min(hhmm, now):
    if not hhmm:
        return 1e9
    h, m = map(int, hhmm.split(":"))
    t = now.replace(hour=h, minute=m, second=0, microsecond=0)
    return (now - t).total_seconds() / 60


def _record(store, hd, jcd, race, res):
    course_of = {s["waku"]: (s["course"], s.get("st")) for s in res.get("start", [])}
    for o in res["order"]:
        c, st = course_of.get(o["waku"], (None, None))
        store.add_result(o["toban"], {"date": hd, "jcd": jcd, "rno": race["rno"], "waku": o["waku"],
                                      "course": c, "st": st, "finish": o["rank"]})


def finish(day, now=None):
    now = now or now_jst()
    day["updated"] = now.strftime("%Y-%m-%d %H:%M")
    hits = {"pre": [0, 0, 0], "live": [0, 0, 0]}  # [レース数, ◎1着, 3連単的中]
    for v in day["venues"]:
        for r in v["races"]:
            for k, h in (r.get("hits") or {}).items():
                hits[k][0] += 1
                hits[k][1] += h["win"]
                hits[k][2] += h["trifecta"]
    day["hits"] = hits


def write(day):
    save_json(day_path(day["date"]), day)
    idx_path = os.path.join(OUT_DIR, "index.json")
    idx = load_json(idx_path, {"dates": []})
    dates = sorted(set(idx.get("dates", [])) | {day["date"]}, reverse=True)[:14]
    # 古い日のファイルは消す（2週間分だけ残す）
    for name in os.listdir(OUT_DIR):
        if name.endswith(".json") and name[:8].isdigit() and name[:8] not in dates:
            os.remove(os.path.join(OUT_DIR, name))
    save_json(idx_path, {"dates": dates, "updated": day["updated"], "encrypted": bool(secure.password())},
              compact=False, encrypt=False)


def main(argv=None):
    ap = argparse.ArgumentParser(description="ボートレース予想データの作成")
    ap.add_argument("mode", choices=["prep", "live"])
    ap.add_argument("--date", help="YYYYMMDD（省略時は今日。prep で --tomorrow なら翌日）")
    ap.add_argument("--tomorrow", action="store_true")
    ap.add_argument("--skip-racers", action="store_true", help="選手ページの取得を省く")
    a = ap.parse_args(argv)
    d = now_jst().date()
    if a.tomorrow:
        d += dt.timedelta(days=1)
    hd = a.date or d.strftime("%Y%m%d")
    if os.environ.get("GITHUB_ACTIONS") and not secure.password():
        log("BOATRACE_PASSWORD が未設定です。公開ページに平文のデータを置かないよう中止します")
        return 1
    day = prep(hd, with_racers=not a.skip_racers) if a.mode == "prep" else live(hd)
    if not day:
        return 1
    write(day)
    n = sum(len(v["races"]) for v in day["venues"])
    log(f"{hd}: {len(day['venues'])}場 {n}レース を書き出しました")
    log(fetch.summary())
    return 0


if __name__ == "__main__":
    sys.exit(main())

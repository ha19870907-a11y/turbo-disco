"""boatrace.jp からページを取得する。アクセスは間隔を空け、失敗時は数回だけ再試行する。

公式サイトは1件の応答に数秒〜10秒ほどかかるため、同時に WORKERS 件まで並行して取りに行く。
ただしアクセスの開始は INTERVAL 秒以上空けるので、サイトへの負荷は1秒あたり2件未満に収まる。
"""
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://www.boatrace.jp/owpc/pc"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
INTERVAL = 0.6  # アクセス開始の間隔（秒）
WORKERS = 6     # 同時に取りに行く件数
TIMEOUT = 20

_lock = threading.Lock()
_last = 0.0
stats = {"ok": 0, "fail": 0, "sec": 0.0}


def _wait_turn():
    global _last
    with _lock:
        wait = INTERVAL - (time.monotonic() - _last)
        if wait > 0:
            time.sleep(wait)
        _last = time.monotonic()


def get(path, **params):
    """path は '/race/racelist' のような BASE 以下のパス。失敗したら None。"""
    q = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{BASE}{path}?{q}" if q else f"{BASE}{path}"
    for attempt in range(2):
        _wait_turn()
        t0 = time.monotonic()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                body = r.read().decode("utf-8", "replace")
            with _lock:
                stats["ok"] += 1
                stats["sec"] += time.monotonic() - t0
            return body
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            with _lock:
                stats["sec"] += time.monotonic() - t0
            if isinstance(e, urllib.error.HTTPError) and e.code == 404:
                break
            time.sleep(2 * (attempt + 1))
    with _lock:
        stats["fail"] += 1
    return None


def pmap(fn, items, workers=WORKERS):
    """items の各要素に fn を並行して適用し、同じ順で結果を返す。"""
    items = list(items)
    if not items:
        return []
    with ThreadPoolExecutor(max_workers=min(workers, len(items))) as ex:
        return list(ex.map(fn, items))


def summary():
    n = stats["ok"] + stats["fail"]
    avg = stats["sec"] / n if n else 0
    return f"公式サイトへのアクセス {n}件（失敗 {stats['fail']}件、平均 {avg:.1f}秒）"


def index(hd):
    return get("/race/index", hd=hd)


def race_page(kind, jcd, rno, hd):
    """kind: racelist / beforeinfo / odds3t / oddstf / pcexpect / raceresult"""
    return get(f"/race/{kind}", rno=rno, jcd=jcd, hd=hd)


def racer_page(kind, toban):
    """kind: back3 (直近3節) / course (コース別成績)"""
    return get(f"/data/racersearch/{kind}", toban=toban)

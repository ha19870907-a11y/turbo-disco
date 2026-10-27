"""boatrace.jp からページを取得する。アクセスは間隔を空け、失敗時は数回だけ再試行する。"""
import time
import urllib.error
import urllib.request

BASE = "https://www.boatrace.jp/owpc/pc"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
INTERVAL = 0.6  # 連続アクセスの間隔（秒）
_last = 0.0


def get(path, **params):
    """path は '/race/racelist' のような BASE 以下のパス。失敗したら None。"""
    global _last
    q = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{BASE}{path}?{q}" if q else f"{BASE}{path}"
    for attempt in range(3):
        wait = INTERVAL - (time.time() - _last)
        if wait > 0:
            time.sleep(wait)
        _last = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if isinstance(e, urllib.error.HTTPError) and e.code == 404:
                return None
            time.sleep(2 * (attempt + 1))
    return None


def index(hd):
    return get("/race/index", hd=hd)


def race_page(kind, jcd, rno, hd):
    """kind: racelist / beforeinfo / odds3t / oddstf / pcexpect / raceresult"""
    return get(f"/race/{kind}", rno=rno, jcd=jcd, hd=hd)


def racer_page(kind, toban):
    """kind: back3 (直近3節) / course (コース別成績)"""
    return get(f"/data/racersearch/{kind}", toban=toban)

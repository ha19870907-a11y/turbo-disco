"""boatrace.jp の各ページから必要な値を取り出す。

公式サイトの HTML は予告なく変わるため、どの関数も「取れた分だけ返す」作りにしている。
取れなかった項目は None / 空のまま残し、予想側で前日データに置き換える。
"""
import re

from bs4 import BeautifulSoup

VENUES = {
    "01": "桐生", "02": "戸田", "03": "江戸川", "04": "平和島", "05": "多摩川", "06": "浜名湖",
    "07": "蒲郡", "08": "常滑", "09": "津", "10": "三国", "11": "びわこ", "12": "住之江",
    "13": "尼崎", "14": "鳴門", "15": "丸亀", "16": "児島", "17": "宮島", "18": "徳山",
    "19": "下関", "20": "若松", "21": "芦屋", "22": "福岡", "23": "唐津", "24": "大村",
}
VENUE_BY_NAME = {v: k for k, v in VENUES.items()}

_Z2H = str.maketrans("０１２３４５６７８９．－：／ＦＬＫＳ　", "0123456789.-:/FLKS ")
FINISH_TOKEN = re.compile(r"^(?:[1-6]|F|L|K|S|欠|失|転|落|エ|妨|不|沈)$")


def _soup(html):
    return BeautifulSoup(html or "", "html.parser")


def norm(s):
    return re.sub(r"\s+", " ", (s or "").translate(_Z2H)).strip()


def text(el):
    return norm(el.get_text(" ", strip=True)) if el is not None else ""


def lines(el):
    return [norm(s) for s in el.get_text("\n").split("\n") if norm(s)] if el is not None else []


def num(s):
    m = re.search(r"-?(?:\d+(?:\.\d+)?|\.\d+)", norm(s) if isinstance(s, str) else "")
    return float(m.group()) if m else None


def _boat_no(el):
    """is-boatColor1 のようなクラスから枠番を得る。"""
    for c in el.get("class", []) or []:
        m = re.match(r"is-boatColor([1-6])$", c)
        if m:
            return int(m.group(1))
    return None


def _first_boat_cell(tr):
    for td in tr.find_all(["td", "th"], recursive=False):
        n = _boat_no(td)
        if n:
            return n
    return None


def _boat_tbodies(sp):
    """1艇ぶんの tbody（枠番の色クラスを含むもの）を枠番つきで返す。"""
    out = []
    for tb in sp.find_all("tbody"):
        tr = tb.find("tr")
        if tr is None:
            continue
        n = _first_boat_cell(tr)
        if n:
            out.append((n, tb, tr))
    return out


# ---------------------------------------------------------------- 開催一覧

def parse_index(html):
    """本日の開催場一覧: [{jcd, name, title, day, canceled}]"""
    sp = _soup(html)
    seen, venues = set(), []
    for a in sp.find_all("a", href=re.compile(r"raceindex\?jcd=\d{2}")):
        jcd = re.search(r"jcd=(\d{2})", a["href"]).group(1)
        if jcd in seen or jcd not in VENUES:
            continue
        seen.add(jcd)
        box = a.find_parent("tbody") or a.find_parent("tr")
        title, day, canceled = "", "", False
        if box is not None:
            names = [text(x) for x in box.find_all("a", href=re.compile(r"raceindex"))]
            names = [n for n in names if n and n not in VENUES.values()]
            title = max(names, key=len) if names else ""
            t = text(box)
            m = re.search(r"(初日|\d+日目|最終日)", t)
            day = m.group(1) if m else ""
            canceled = "中止" in t
        venues.append({"jcd": jcd, "name": VENUES[jcd], "title": title, "day": day,
                       "canceled": canceled})
    return venues


# ---------------------------------------------------------------- 出走表

def _rates(td):
    vals = [num(x) for x in lines(td)]
    vals = [v for v in vals if v is not None]
    return (vals + [None, None, None])[:3]


def parse_racelist(html):
    """出走表: {deadlines:[12], race_title, distance, boats:[{...}x6]}"""
    sp = _soup(html)
    out = {"deadlines": [], "race_title": "", "distance": None, "boats": []}
    for cell in sp.find_all(["td", "th"]):
        if "締切予定時刻" in cell.get_text():
            tr = cell.find_parent("tr")
            out["deadlines"] = re.findall(r"\d{1,2}:\d{2}", text(tr))
            break
    h = sp.find(class_=re.compile(r"title16_titleDetail"))
    if h is not None:
        t = text(h)
        out["race_title"] = t
        m = re.search(r"(\d{3,4})m", t)
        out["distance"] = int(m.group(1)) if m else None

    for n, tb, tr in _boat_tbodies(sp):
        link = tr.find("a", href=re.compile(r"toban=\d{4}"))
        if link is None:
            continue
        tds = tr.find_all("td", recursive=False)
        idx = next(i for i, td in enumerate(tds) if td.find("a", href=re.compile(r"toban=")))
        info = text(tds[idx])
        b = {
            "waku": n,
            "toban": re.search(r"toban=(\d{4})", link["href"]).group(1),
            "name": re.sub(r"\s+", "", link.get_text()),
            "cls": (re.search(r"\b(A1|A2|B1|B2)\b", info) or [None, None])[1],
        }
        m = re.search(r"([^\s/\d]+)/([^\s/\d]+)", info)
        b["branch"], b["hometown"] = (m.group(1), m.group(2)) if m else (None, None)
        m = re.search(r"(\d+)歳", info)
        b["age"] = int(m.group(1)) if m else None
        m = re.search(r"([\d.]+)kg", info)
        b["weight"] = float(m.group(1)) if m else None

        rest = tds[idx + 1: idx + 6]
        if len(rest) >= 5:
            fl = " ".join(lines(rest[0]))
            m = re.search(r"F(\d+)", fl)
            b["f"] = int(m.group(1)) if m else 0
            m = re.search(r"L(\d+)", fl)
            b["l"] = int(m.group(1)) if m else 0
            m = re.search(r"(\d?\.\d{2})", fl)
            b["avg_st"] = float(m.group(1)) if m else None
            b["nat_win"], b["nat_2"], b["nat_3"] = _rates(rest[1])
            b["loc_win"], b["loc_2"], b["loc_3"] = _rates(rest[2])
            mno, b["motor_2"], b["motor_3"] = _rates(rest[3])
            bno, b["boat_2"], b["boat_3"] = _rates(rest[4])
            b["motor_no"] = int(mno) if mno is not None else None
            b["boat_no"] = int(bno) if bno is not None else None
        out["boats"].append(b)
    out["boats"].sort(key=lambda x: x["waku"])
    return out


# ---------------------------------------------------------------- 直前情報（展示）

def parse_beforeinfo(html):
    """直前情報: {boats:{枠:{ex_time,tilt,parts,...}}, start:[{course,waku,st}], weather:{}}"""
    sp = _soup(html)
    out = {"boats": {}, "start": [], "weather": {}}
    for n, tb, tr in _boat_tbodies(sp):
        tds = tr.find_all("td", recursive=False)
        try:
            idx = next(i for i, td in enumerate(tds) if td.find("a", href=re.compile(r"toban=")))
        except StopIteration:
            idx = 2
        cells = [text(td) for td in tds[idx + 1:]]
        b = {}
        # 体重, 展示タイム, チルト, プロペラ, 部品交換 の順。体重は kg を含む。
        if cells and "kg" in cells[0]:
            b["weight"] = num(cells[0])
            cells = cells[1:]
        if cells:
            v = num(cells[0])
            b["ex_time"] = v if v is not None and 6.0 <= v <= 8.0 else None
        if len(cells) > 1:
            v = num(cells[1])
            b["tilt"] = v if v is not None and -1.0 <= v <= 3.5 else None
        if len(cells) > 2:
            b["propeller"] = cells[2] or None
        if len(cells) > 3:
            b["parts"] = cells[3] or None
        trs = tb.find_all("tr")
        if len(trs) > 2:  # 3行目が調整重量
            v = num(text(trs[2].find("td")))
            b["adjust"] = v
        out["boats"][n] = b

    for i, unit in enumerate(sp.select(".table1_boatImage1"), start=1):
        no = unit.select_one("[class*=boatImage1Number]")
        tm = unit.select_one("[class*=boatImage1Time]")
        if no is None:
            continue
        w = int(num(text(no)) or 0)
        st_txt = text(tm)
        st = num(st_txt)
        if st is not None and st_txt.startswith("F"):
            st = -st
        out["start"].append({"course": i, "waku": w, "st": st, "raw": st_txt})

    for unit in sp.select(".weather1_bodyUnit"):
        title = text(unit.select_one(".weather1_bodyUnitLabelTitle"))
        data = text(unit.select_one(".weather1_bodyUnitLabelData"))
        if title:
            out["weather"][title] = data
        img = unit.select_one("[class*=is-wind]")
        if img is not None:
            for c in img.get("class", []):
                m = re.match(r"is-wind(\d+)$", c)
                if m:
                    out["weather"]["wind_dir"] = int(m.group(1))
        cls = " ".join(unit.get("class", []))
        if "is-weather" in cls and title:
            out["weather"]["天候"] = title
    return out


def has_exhibition(info):
    return bool(info) and any(b.get("ex_time") for b in info.get("boats", {}).values())


# ---------------------------------------------------------------- オッズ

def _odds_vals(sp):
    out = []
    for td in sp.select("td.oddsPoint"):
        out.append(num(text(td)))
    return out


def parse_odds3t(html):
    """3連単オッズ: {'1-2-3': 12.3, ...}。並びは 1着ごとの列 × 20行。"""
    vals = _odds_vals(_soup(html))
    if len(vals) < 120:
        return {}
    res = {}
    for i, v in enumerate(vals[:120]):
        row, first = divmod(i, 6)
        first += 1
        seconds = [b for b in range(1, 7) if b != first]
        second = seconds[row // 4]
        thirds = [b for b in range(1, 7) if b not in (first, second)]
        third = thirds[row % 4]
        if v is not None:
            res[f"{first}-{second}-{third}"] = v
    return res


def parse_oddstf(html):
    """単勝オッズ: {枠: odds}"""
    vals = _odds_vals(_soup(html))
    return {i + 1: v for i, v in enumerate(vals[:6]) if v is not None}


# ---------------------------------------------------------------- 公式コンピュータ予想

def parse_pcexpect(html):
    """{marks:{枠:'◎'}, focus:['1-2-3',...]}。取れなければ空。"""
    sp = _soup(html)
    marks = {}
    for n, tb, tr in _boat_tbodies(sp):
        m = re.search(r"[◎○▲△☆×]", text(tr))
        if m:
            marks[n] = m.group()
    focus = []
    for row in sp.select("[class*=numberSet]"):
        digits = [norm(x.get_text()) for x in row.select("[class*=numberSet1_number]")]
        digits = [d for d in digits if re.fullmatch(r"[1-6]", d)]
        if len(digits) == 3:
            focus.append("-".join(digits))
    if not focus:
        focus = ["-".join(m) for m in re.findall(r"([1-6])\s*-\s*([1-6])\s*-\s*([1-6])", text(sp))]
    return {"marks": marks, "focus": list(dict.fromkeys(focus))[:10]}


# ---------------------------------------------------------------- 結果

def parse_result(html):
    """{order:[{rank,waku,toban}], start:[{course,waku,st}], trifecta:'1-2-3', payout:int}"""
    sp = _soup(html)
    out = {"order": [], "start": [], "trifecta": None, "payout": None}
    for tr in sp.find_all("tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 3:
            continue
        w = _boat_no(tds[1]) if len(tds) > 1 else None
        link = tr.find("a", href=re.compile(r"toban=\d{4}"))
        if w and link:
            rk = text(tds[0])
            out["order"].append({
                "rank": int(rk) if rk.isdigit() else rk,
                "waku": w,
                "toban": re.search(r"toban=(\d{4})", link["href"]).group(1),
            })
    for i, unit in enumerate(sp.select(".table1_boatImage1"), start=1):
        no = unit.select_one("[class*=boatImage1Number]")
        tm = unit.select_one("[class*=boatImage1Time]")
        if no is None:
            continue
        st_txt = text(tm)
        st = num(st_txt)
        if st is not None and st_txt.startswith("F"):
            st = -st
        out["start"].append({"course": i, "waku": int(num(text(no)) or 0), "st": st})
    for td in sp.find_all("td"):
        if text(td) == "3連単":
            tr = td.find_parent("tr")
            digits = [norm(x.get_text()) for x in tr.select("[class*=numberSet1_number]")]
            if len(digits) >= 3:
                out["trifecta"] = "-".join(digits[:3])
            m = re.search(r"¥\s*([\d,]+)", tr.get_text())
            if m:
                out["payout"] = int(m.group(1).replace(",", ""))
            break
    return out


# ---------------------------------------------------------------- 選手データ

def parse_back3(html):
    """直近3節の成績。新しい順の [{venue, date, finish}]（1走ずつ）。"""
    sp = _soup(html)
    races = []
    for tr in sp.find_all("tr"):
        cells = [text(td) for td in tr.find_all("td", recursive=False)]
        if not cells:
            continue
        venue = next((c for c in cells if c in VENUE_BY_NAME), None)
        if venue is None:
            venue = next((v for v in VENUE_BY_NAME if any(v == c.split(" ")[0] for c in cells)), None)
        date = next((m.group() for c in cells for m in [re.search(r"\d{4}/\d{1,2}/\d{1,2}", c)] if m), None)
        results = None
        for c in cells:
            toks = c.split(" ")
            if len(toks) >= 2 and all(FINISH_TOKEN.match(t) for t in toks):
                results = toks
        if venue and results:
            # 節内は左が古い。新しい順に並べたいので反転する
            for r in reversed(results):
                races.append({"venue": venue, "date": date, "finish": r})
    return races


def parse_course(html):
    """コース別成績。{course(int): {見出し: 値}}"""
    sp = _soup(html)
    out = {}
    for table in sp.find_all("table"):
        heads = [text(th) for th in table.select("thead th")]
        title_el = table.find_previous(class_=re.compile(r"title"))
        title = text(title_el) if title_el is not None else ""
        for tr in table.select("tbody tr"):
            cells = [text(c) for c in tr.find_all(["th", "td"], recursive=False)]
            if not cells:
                continue
            m = re.match(r"^([1-6])(?:コース)?$", cells[0])
            if not m:
                continue
            c = int(m.group(1))
            vals = [num(x) for x in cells[1:]]
            row = out.setdefault(c, {})
            if heads and len(heads) == len(cells):
                for h, v in zip(heads[1:], vals):
                    if v is not None:
                        row[h] = v
            elif vals and vals[0] is not None:
                row[title or f"値{len(row)}"] = vals[0]
    return out

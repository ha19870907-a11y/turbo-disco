"""出走表・展示・オッズ・選手の過去成績から各艇の勝率を見積もり、印と買い目を出す。

点数は「コースの基本勝率（対数）」に各要素の加点・減点を足したもの。
softmax で1着確率にし、単勝オッズがあれば市場の見立てと混ぜる。
2・3着の確率は Harville 式（残った艇で勝率を按分）で求める。
"""
import math

# 全国平均のコース別1着率
COURSE_BASE = {1: 0.55, 2: 0.14, 3: 0.12, 4: 0.105, 5: 0.06, 6: 0.025}
CLASS_BONUS = {"A1": 0.30, "A2": 0.12, "B1": 0.0, "B2": -0.25}
MARKS = ["◎", "○", "▲", "△", "△", ""]
PC_MARK_BONUS = {"◎": 0.15, "○": 0.08, "▲": 0.04, "△": 0.02}
MARKET_WEIGHT = 0.4  # 単勝オッズから見た確率をどれだけ混ぜるか


def _avg(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def recent_finishes(races, n=10):
    """直近成績の着順（数値のみ）。F/L/欠などは6着扱い、欠場(K/欠)は除く。"""
    out = []
    for r in races[:n]:
        f = r.get("finish")
        if isinstance(f, int) or (isinstance(f, str) and f.isdigit()):
            out.append(int(f))
        elif f in ("K", "欠"):
            continue
        else:
            out.append(6)
    return out


# コース別の全国平均（%）。選手のコース別成績と比べる基準
_BASELINE = {
    "3連対": {1: 75, 2: 55, 3: 50, 4: 45, 5: 35, 6: 25},
    "2連対": {1: 65, 2: 35, 3: 30, 4: 25, 5: 17, 6: 8},
    "1着": {c: 100 * p for c, p in COURSE_BASE.items()},
}


def baseline(label, course):
    for key, table in _BASELINE.items():
        if key in (label or ""):
            return table[course]
    return None


def course_rate(course_stats, course):
    """コース別成績から（見出し, 値）を返す。3連対率 > 2連対率 > 1着率の順で探す。"""
    row = (course_stats or {}).get(course) or (course_stats or {}).get(str(course)) or {}
    for key in ("3連対", "2連対", "1着"):
        for k, v in row.items():
            if key in k and v is not None:
                return k, v
    return None, None


def best_course(course_stats):
    best = None
    for c in range(1, 7):
        label, v = course_rate(course_stats, c)
        if v is None:
            continue
        # コースごとに全国平均との差で比べる
        adj = v - baseline(label, c)
        if best is None or adj > best[2]:
            best = (c, label, adj, v)
    return {"course": best[0], "label": best[1], "value": best[3]} if best else None


def score_boat(b, ctx):
    """1艇の点数と、点数に効いた理由のリストを返す。"""
    reasons = []
    c = b.get("course") or b["waku"]
    s = math.log(COURSE_BASE.get(c, 0.05))

    nat = b.get("nat_win")
    if nat:
        s += 0.35 * (nat - 5.5)
        if nat >= 7.0:
            reasons.append(f"全国勝率{nat:.2f}")
    loc = b.get("loc_win")
    if loc and nat:
        d = loc - nat
        s += 0.15 * max(-2.0, min(2.0, d))
        if d >= 0.8:
            reasons.append(f"当地巧者(当地{loc:.2f})")
        elif d <= -1.0:
            reasons.append("当地は苦手傾向")
    s += CLASS_BONUS.get(b.get("cls"), 0.0)

    m2 = b.get("motor_2")
    if m2:
        s += 0.012 * (m2 - 35)
        if m2 >= 45:
            reasons.append(f"好モーター({m2:.0f}%)")
        elif m2 <= 25:
            reasons.append("モーター劣勢")

    st = b.get("avg_st")
    if st and st < 1:
        s += -4.0 * (st - 0.16)
        if st <= 0.13:
            reasons.append(f"平均ST{st:.2f}")
    if b.get("f"):
        s -= 0.15 * b["f"]
        reasons.append(f"F{b['f']}持ち")

    fin = recent_finishes(b.get("recent") or [])
    if len(fin) >= 3:
        a = sum(fin) / len(fin)
        s += -0.15 * (a - 3.5)
        if a <= 2.5:
            reasons.append(f"近況好調(平均{a:.1f}着)")
        elif a >= 4.5:
            reasons.append("近況不振")

    label, v = course_rate(b.get("course_stats"), c)
    if v is not None:
        d = v - baseline(label, c)
        s += 0.012 * d
        if d >= 10:
            reasons.append(f"{c}コース得意({label}{v:.0f}%)")

    # 展示（直前情報）
    ex = b.get("ex_time")
    med = ctx.get("ex_median")
    if ex and med:
        s += -2.5 * (ex - med)
        if b.get("ex_rank") == 1:
            reasons.append(f"展示タイム1位({ex:.2f})")
        elif b.get("ex_rank") and b.get("ex_rank") == ctx.get("ex_n"):
            reasons.append("展示タイム最下位")
    sst = b.get("ex_st")
    if sst is not None and abs(sst) < 1:
        if sst < 0:
            s -= 0.1
        else:
            s += -1.5 * (sst - 0.15)
            if sst <= 0.08:
                reasons.append(f"スタ展ST{sst:.2f}")

    pm = (ctx.get("pc_marks") or {}).get(b["waku"]) or (ctx.get("pc_marks") or {}).get(str(b["waku"]))
    if pm:
        s += PC_MARK_BONUS.get(pm, 0)

    if c != b["waku"]:
        reasons.append(f"{b['waku']}号艇が{c}コース進入")
    return s, reasons


def scratched(race):
    """欠場艇の枠番。3連単オッズがあれば、どの組番にも出てこない艇を欠場とみなす。"""
    odds3t = race.get("odds3t") or {}
    if len(odds3t) < 20:
        return set()
    seen = {int(x) for combo in odds3t for x in combo.split("-")}
    return {b["waku"] for b in race["boats"]} - seen


def _softmax(xs, temp=1.0):
    m = max(xs)
    e = [math.exp((x - m) / temp) for x in xs]
    t = sum(e)
    return [x / t for x in e]


def longshot(order, model, market, course, tri, odds3t, taken):
    """穴予想: 人気より力がある艇（オッズが無ければ外コースで一番強い艇）と、その艇が絡む高配当の3連単。"""
    cands = [k for k in order[3:] if model[k] >= 0.04]  # ◎○▲より下の艇から選ぶ
    if not cands:
        return None
    if market:
        boat = max(cands, key=lambda k: model[k] / max(market[k], 1e-3))
        if model[boat] > market[boat]:
            reason = f"予想{model[boat] * 100:.0f}%に対して人気は{market[boat] * 100:.0f}%。オッズ以上の力"
        else:
            reason = f"人気薄の中では最も期待できる（予想{model[boat] * 100:.0f}%・人気{market[boat] * 100:.0f}%）"
    else:
        outer = [k for k in cands if course[k] >= 4]
        boat = max(outer or cands, key=lambda k: model[k])
        reason = f"{course[boat]}コースから一発（予想{model[boat] * 100:.0f}%）"
    combos = [(c, p) for c, p in tri.items() if c not in taken and str(boat) in c.split("-")[:2]]
    if odds3t:
        combos = [(c, p, odds3t[c]) for c, p in combos if odds3t.get(c, 0) >= 20]
        combos.sort(key=lambda x: -x[1] * x[2])
        picks = [{"combo": c, "prob": round(p, 4), "odds": o, "ev": round(p * o, 2)} for c, p, o in combos[:3]]
    else:
        combos.sort(key=lambda x: -x[1])
        picks = [{"combo": c, "prob": round(p, 4), "odds": None, "ev": None} for c, p in combos[:3]]
    return {"boat": boat, "reason": reason, "picks": picks}


def trifecta_probs(p):
    """Harville 式で3連単120通りの確率。p は 枠→1着確率。"""
    out = {}
    boats = list(p)
    for i in boats:
        for j in boats:
            if j == i:
                continue
            for k in boats:
                if k in (i, j):
                    continue
                pij = p[i] * p[j] / max(1e-9, 1 - p[i])
                out[f"{i}-{j}-{k}"] = pij * p[k] / max(1e-9, 1 - p[i] - p[j])
    return out


def predict(race):
    """race: {boats:[...], start:[...], weather:{}, odds_win:{}, odds3t:{}, pc:{}}
    戻り値: {probs:{枠:p}, marks:{枠:印}, picks:[{combo,prob,odds,ev}], reasons:{枠:[...]}, confidence}
    """
    boats = [b for b in race["boats"] if b["waku"] not in scratched(race)]
    if len(boats) < 3:
        return None
    ctx = {"pc_marks": (race.get("pc") or {}).get("marks")}

    # 進入コース：スタート展示があればその並び、無ければ枠なり
    course_of = {s["waku"]: s["course"] for s in race.get("start") or [] if s.get("waku")}
    exs = [b.get("ex_time") for b in boats if b.get("ex_time")]
    if exs:
        ctx["ex_median"] = sorted(exs)[len(exs) // 2]
        ctx["ex_n"] = len(exs)
        order = sorted((b.get("ex_time"), b["waku"]) for b in boats if b.get("ex_time"))
        rank = {w: i + 1 for i, (_, w) in enumerate(order)}
    else:
        rank = {}
    st_of = {s["waku"]: s.get("st") for s in race.get("start") or [] if s.get("waku")}

    scores, reasons = {}, {}
    for b in boats:
        bb = dict(b, course=course_of.get(b["waku"], b["waku"]),
                  ex_rank=rank.get(b["waku"]), ex_st=st_of.get(b["waku"]))
        scores[b["waku"]], reasons[b["waku"]] = score_boat(bb, ctx)

    # 強風・高波のときは荒れやすいので確率をならす
    temp = 1.0
    w = race.get("weather") or {}
    wind = next((v for k, v in w.items() if "風速" in str(k)), None)
    wave = next((v for k, v in w.items() if "波" in str(k)), None)
    try:
        if wind and float(str(wind).replace("m", "")) >= 5:
            temp = 1.25
        if wave and float(str(wave).replace("cm", "")) >= 8:
            temp = max(temp, 1.3)
    except ValueError:
        pass

    keys = list(scores)
    model = dict(zip(keys, _softmax([scores[k] for k in keys], temp)))

    odds_win = {int(k): v for k, v in (race.get("odds_win") or {}).items() if v}
    probs, market = model, None
    if len(odds_win) >= len(keys) - 1 and odds_win:
        inv = {k: 1 / odds_win[k] for k in keys if odds_win.get(k)}
        t = sum(inv.values())
        market = {k: inv.get(k, 0) / t for k in keys}
        probs = {k: (1 - MARKET_WEIGHT) * model[k] + MARKET_WEIGHT * market[k] for k in keys}

    order = sorted(keys, key=lambda k: -probs[k])
    marks = {k: MARKS[i] for i, k in enumerate(order)}

    tri = trifecta_probs(probs)
    odds3t = race.get("odds3t") or {}
    top = sorted(tri.items(), key=lambda kv: -kv[1])[:8]
    picks = []
    for combo, p in top:
        o = odds3t.get(combo)
        picks.append({"combo": combo, "prob": round(p, 4), "odds": o,
                      "ev": round(p * o, 2) if o else None})
    # オッズがあれば、期待値の高い穴目も2点まで追加
    if odds3t:
        value = sorted(((c, p, odds3t[c]) for c, p in tri.items()
                        if c in odds3t and p * odds3t[c] >= 1.2 and p >= 0.01
                        and c not in {x["combo"] for x in picks}),
                       key=lambda x: -x[1] * x[2])[:2]
        for c, p, o in value:
            picks.append({"combo": c, "prob": round(p, 4), "odds": o, "ev": round(p * o, 2),
                          "value": True})

    ana = longshot(order, model, market, {k: course_of.get(k, k) for k in keys}, tri, odds3t,
                   {x["combo"] for x in picks})

    return {
        "ana": ana,
        "probs": {k: round(probs[k], 4) for k in keys},
        "model_probs": {k: round(model[k], 4) for k in keys},
        "marks": marks,
        "picks": picks,
        "reasons": {k: reasons[k] for k in keys},
        "confidence": round(probs[order[0]], 3),
        "course": {k: course_of.get(k, k) for k in keys},
    }

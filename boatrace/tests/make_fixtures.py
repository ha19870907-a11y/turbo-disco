"""テスト用の HTML を生成する（boatrace.jp の構造を簡略化して再現したもの）。"""
import os

D = os.path.join(os.path.dirname(__file__), "fixtures")
NAMES = ["峰　竜太", "毒島　誠", "桐生　順平", "石野　貴之", "白井　英治", "馬場　貴也"]
CLS = ["A1", "A1", "A2", "B1", "A1", "B2"]


def racelist():
    rows = []
    for i in range(6):
        w = i + 1
        rows.append(f"""<tbody class="is-fs12"><tr>
<td class="is-boatColor{w} is-fs14" rowspan="4">{"１２３４５６"[i]}</td>
<td rowspan="4"><a href="/owpc/pc/data/racersearch/profile?toban={4000+w}"><img src="x.jpg"></a></td>
<td rowspan="4"><div class="is-fs11">{4000+w}<span>/</span><span>{CLS[i]}</span></div>
<div class="is-fs18 is-fBold"><a href="/owpc/pc/data/racersearch/profile?toban={4000+w}">{NAMES[i]}</a></div>
<div class="is-fs11">佐賀/佐賀<br>3{w}歳/52.{w}kg</div></td>
<td class="is-lineH2" rowspan="4">F{1 if w==3 else 0}<br>L0<br>0.1{w}</td>
<td class="is-lineH2" rowspan="4">{8-w*0.5:.2f}<br>50.00<br>70.00</td>
<td class="is-lineH2" rowspan="4">{7-w*0.3:.2f}<br>45.00<br>65.00</td>
<td class="is-lineH2" rowspan="4">{10+w}<br>{30+w*3:.2f}<br>50.00</td>
<td class="is-lineH2" rowspan="4">{50+w}<br>33.00<br>50.00</td>
</tr><tr><td>1</td></tr></tbody>""")
    dl = "".join(f"<td>{10+i//2}:{(i%2)*30:02d}</td>" for i in range(12))
    return f"""<html><body><h3 class="title16_titleDetail__add2020">予選　　1800m</h3>
<table><tbody><tr><td class="is-thColor">締切予定時刻</td>{dl}</tr></tbody></table>
<div class="table1"><table>{''.join(rows)}</table></div></body></html>"""


def beforeinfo():
    rows, st = [], []
    ex = [6.80, 6.75, 6.70, 6.85, 6.90, 6.95]
    for i in range(6):
        w = i + 1
        rows.append(f"""<tbody class="is-fs12"><tr>
<td class="is-boatColor{w}" rowspan="4">{w}</td><td rowspan="4"><a href="/owpc/pc/data/racersearch/profile?toban={4000+w}"><img></a></td>
<td rowspan="4"><a href="/owpc/pc/data/racersearch/profile?toban={4000+w}">{NAMES[i]}</a></td>
<td rowspan="2">52.0kg</td><td rowspan="4">{ex[i]:.2f}</td><td rowspan="4">-0.5</td>
<td rowspan="4"></td><td rowspan="4"></td></tr><tr><td>R</td></tr>
<tr><td>0.0</td></tr><tr><td>x</td></tr></tbody>""")
    order = [1, 3, 2, 4, 5, 6]  # 3号艇が2コースへ
    for w in order:
        t = "F.01" if w == 6 else f".1{w}"
        st.append(f'<div class="table1_boatImage1"><span class="table1_boatImage1Number is-type{w}">{w}</span>'
                  f'<span class="table1_boatImage1Time">{t}</span></div>')
    weather = """<div class="weather1"><div class="weather1_bodyUnit is-direction"><p class="weather1_bodyUnitImage is-wind5"></p></div>
<div class="weather1_bodyUnit is-weather"><div class="weather1_bodyUnitLabel"><span class="weather1_bodyUnitLabelTitle">晴</span></div></div>
<div class="weather1_bodyUnit is-wind"><div class="weather1_bodyUnitLabel"><span class="weather1_bodyUnitLabelTitle">風速</span><span class="weather1_bodyUnitLabelData">3m</span></div></div>
<div class="weather1_bodyUnit is-wave"><div class="weather1_bodyUnitLabel"><span class="weather1_bodyUnitLabelTitle">波高</span><span class="weather1_bodyUnitLabelData">2cm</span></div></div></div>"""
    return f"<html><body><table>{''.join(rows)}</table>{''.join(st)}{weather}</body></html>"


def odds3t():
    cells = []
    for row in range(20):
        tds = []
        for first in range(1, 7):
            seconds = [b for b in range(1, 7) if b != first]
            second = seconds[row // 4]
            thirds = [b for b in range(1, 7) if b not in (first, second)]
            third = thirds[row % 4]
            val = first * 100 + second * 10 + third  # 組番がそのまま値になるダミー
            tds.append(f'<td class="is-boatColor{second}">{second}</td><td class="is-boatColor{third}">{third}</td><td class="oddsPoint">{val}.0</td>')
        cells.append("<tr>" + "".join(tds) + "</tr>")
    return f"<table><tbody>{''.join(cells)}</tbody></table>"


def oddstf():
    win = "".join(f'<tr><td class="is-boatColor{w}">{w}</td><td class="oddsPoint">{[1.4,4.5,6.0,12.0,25.0,60.0][w-1]}</td></tr>' for w in range(1, 7))
    plc = "".join(f'<tr><td class="is-boatColor{w}">{w}</td><td class="oddsPoint">1.0-1.5</td></tr>' for w in range(1, 7))
    return f"<table><tbody>{win}</tbody></table><table><tbody>{plc}</tbody></table>"


def result():
    order = [1, 3, 2, 5, 4, 6]
    rows = "".join(f'<tbody><tr><td>{"１２３４５６"[i]}</td><td class="is-boatColor{w}">{w}</td>'
                   f'<td><a href="/owpc/pc/data/racersearch/profile?toban={4000+w}">x</a></td><td>1\'50"0</td></tr></tbody>'
                   for i, w in enumerate(order))
    st = "".join(f'<div class="table1_boatImage1"><span class="table1_boatImage1Number">{w}</span>'
                 f'<span class="table1_boatImage1Time">.1{w}</span></div>' for w in [1, 3, 2, 4, 5, 6])
    pay = ('<table><tbody><tr><td rowspan="2">3連単</td><td><div class="numberSet1">'
           '<span class="numberSet1_number is-type1">1</span><span class="numberSet1_text">-</span>'
           '<span class="numberSet1_number is-type3">3</span><span class="numberSet1_text">-</span>'
           '<span class="numberSet1_number is-type2">2</span></div></td><td><span class="is-payout1">¥1,230</span></td></tr></tbody></table>')
    return f"<table>{rows}</table>{st}{pay}"


def index():
    rows = ""
    for jcd, title in [("01", "第1回 桐生カップ"), ("12", "住之江ナイター")]:
        rows += (f'<tbody><tr><td><a href="/owpc/pc/race/raceindex?jcd={jcd}&hd=20261028"><img alt="x"></a></td>'
                 f'<td><a href="/owpc/pc/race/raceindex?jcd={jcd}&hd=20261028">{title}</a></td><td>２日目</td></tr></tbody>')
    return f"<table>{rows}</table>"


def back3():
    return """<table><thead><tr><th>期間</th><th>場</th><th>タイトル</th><th>成績</th></tr></thead><tbody>
<tr><td>2026/10/20-10/25</td><td>大村</td><td>一般</td><td>１ ２ ３ １ Ｆ ４</td></tr>
<tr><td>2026/10/01-10/06</td><td>桐生</td><td>G1</td><td>２ ２ ５ １ ６ 欠</td></tr>
</tbody></table>"""


def course():
    rows = "".join(f"<tr><td>{c}コース</td><td>{30+c}</td><td>{90-c*10}.0%</td><td>0.1{c}</td></tr>" for c in range(1, 7))
    return f"""<h3 class="title7">コース別成績</h3><table><thead><tr><th>コース</th><th>進入回数</th><th>3連対率</th><th>平均ST</th></tr></thead>
<tbody>{rows}</tbody></table>"""


def write_all():
    os.makedirs(D, exist_ok=True)
    for name, fn in [("racelist", racelist), ("beforeinfo", beforeinfo), ("odds3t", odds3t), ("oddstf", oddstf),
                     ("raceresult", result), ("index", index), ("back3", back3), ("course", course)]:
        with open(os.path.join(D, name + ".html"), "w", encoding="utf-8") as f:
            f.write(fn())


if __name__ == "__main__":
    write_all()

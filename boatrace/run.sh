#!/usr/bin/env bash
# GitHub Actions から呼ぶ。予想データを作って main に公開する。
#   prep           当日の前日予想を作り直す
#   prep-tomorrow  翌日の前日予想を作る
#   live           締切が近いレースの展示・オッズ・結果を1回反映する
#   loop           live を10分ごとに22時（日本時間）まで繰り返す。ジョブの上限時間の手前で
#                  次の loop を起動して引き継ぎ、レースが終わったら翌日の前日予想を作る
set -u

LOOP_SLEEP=${LOOP_SLEEP:-600}         # loop の間隔（秒）
LOOP_MINUTES=${LOOP_MINUTES:-330}     # 1回のジョブで loop を続ける長さ（ジョブの上限350分より短く）
LOOP_END_HM=${LOOP_END_HM:-2200}      # この時刻（日本時間）を過ぎたら loop を終える

jst_hm() { TZ=Asia/Tokyo date +%H%M; }

publish() {
  git add docs/boatrace/data boatrace/state
  git diff --cached --quiet && return 0
  git commit -q -m "ボートレース予想を更新 $(TZ=Asia/Tokyo date '+%m/%d %H:%M')"
  for _ in 1 2 3; do
    git pull -q --rebase && git push -q && return 0
    sleep 5
  done
  return 1
}

update() { python -m boatrace.update "$@" && publish; }

case "${1:-live}" in
  prep) update prep ${DATE:+--date "$DATE"} ;;
  prep-tomorrow) update prep --tomorrow ;;
  live) update live ${DATE:+--date "$DATE"} ;;
  loop)
    # 朝に始まったときは、まず当日の前日予想を作り直す（欠場などを反映）
    [ "$(jst_hm)" -lt 0900 ] && update prep
    end=$(( $(date +%s) + LOOP_MINUTES * 60 ))
    while [ "$(jst_hm)" -lt "$LOOP_END_HM" ] && [ "$(date +%s)" -lt "$end" ]; do
      update live || echo "更新に失敗しました。次の回で再試行します"
      sleep "$LOOP_SLEEP"
    done
    if [ "$(jst_hm)" -lt "$LOOP_END_HM" ]; then
      gh workflow run boatrace.yml --ref main -f mode=loop   # 上限時間の手前で次の loop に引き継ぐ
    else
      update prep --tomorrow
    fi
    ;;
  *) echo "不明なモード: $1" >&2; exit 2 ;;
esac

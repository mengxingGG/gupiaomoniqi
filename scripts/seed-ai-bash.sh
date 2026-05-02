#!/bin/bash
cd /root/your_workspace_path/gupiaomoniqi-prod/股票模拟器2.0
DB="data/stock_simulator.db"
NAMES="data/ai_names.json"

profiles=( "贪婪激进:追涨杀跌+杠杆倍投,高风险无止损" "谨慎保守:均值回归+止盈止损,低频小仓" "平衡稳健:动量网格,中仓动态" "波动猎手:ATR突破,高频短线" "价值投资者:低估买高估卖,长持" "反向思维:逆势恐慌买" "技术派:MA RSI多帧" "量化机器:统计套利对冲" "新闻敏感:事件情绪快速" "耐心等待:突破箱体忽略" )

jq -r '.[] | .aiName' $NAMES | nl -nrz | while IFS=$'\t' read i name; do
  p=$((i % 10))
  psych="${profiles[p]%%:*}"
  strat="${profiles[p]#*:}"
  cash=$(echo "scale=2; 1000000 + $RANDOM * 99 / 32767 * 10000000" | bc -l)
  sqlite3 $DB "INSERT OR IGNORE INTO ai_traders (id, name, psychology_type, strategy_type, cash, total_assets) VALUES ('ai_$i', '$name', '$psych', '$strat', $cash, $cash);"
  echo "Seeded $((i+1))/5000: $name ($psych)"
done
echo "✅ Done!"

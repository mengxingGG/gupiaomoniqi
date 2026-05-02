#!/bin/bash
cd /root/your_workspace_path/gupiaomoniqi-prod/股票模拟器2.0
DB="data/stock_simulator.db"
surnames=(李 王 张 刘 陈 杨 赵 黄 周 吴 徐 孙 胡 朱 高 林 何 郭 马 罗)
given=(伟 军 洋 勇 毅 俊 峰 强 宇 明 涛 飞 亮 磊 浩 华 斌 凯 鹏 博)
profiles=( "贪婪激进:追涨杀跌+杠杆倍投,高风险无止损" "谨慎保守:均值回归+止盈止损,低频小仓" "平衡稳健:动量网格,中仓动态" "波动猎手:ATR突破,高频短线" "价值投资者:低估买高估卖,长持" "反向思维:逆势恐慌买" "技术派:MA RSI多帧" "量化机器:统计套利对冲" "新闻敏感:事件情绪快速" "耐心等待:突破箱体忽略" )

count=0
while [ $count -lt 5000 ]; do
  batch=()
  for ((j=0; j<10 && count<5000; j++)); do
    s=${surnames[$RANDOM % ${#surnames[@]}]}
    g=${given[$RANDOM % ${#given[@]}]}
    name="${s}${g}"
    p=$((count % 10))
    psych="${profiles[p]%%:*}"
    strat="${profiles[p]#*:}"
    cash=$(echo "scale=2; 1000000 + $RANDOM * 99 / 32767 * 10000000" | bc -l)
    id="ai_${count}"
    sqlite3 $DB "INSERT OR IGNORE INTO ai_traders (id, name, psychology_type, strategy_type, cash, total_assets) VALUES ('$id', '$name', '$psych', '$strat', $cash, $cash);"
    batch+=("$name ($psych)")
    ((count++))
  done
  echo "Seeded $count/5000: ${batch[*]}"
  sleep 3
done
echo "✅ 5000 AI traders ready!"

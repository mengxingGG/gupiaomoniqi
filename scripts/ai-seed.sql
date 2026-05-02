-- Batch insert/update AI profiles
.read data/ai_names.json | while read name; do
  p=$(( $RANDOM % 10 ));
  case $p in
    0) psych="贪婪激进"; strat="追涨杀跌+杠杆倍投,高风险无止损";;
    1) psych="谨慎保守"; strat="均值回归+止盈止损,低频小仓";;
    2) psych="平衡稳健"; strat="动量网格,中仓动态";;
    3) psych="波动猎手"; strat="ATR突破,高频短线";;
    4) psych="价值投资者"; strat="低估买高估卖,长持";;
    5) psych="反向思维"; strat="逆势恐慌买";;
    6) psych="技术派"; strat="MA RSI多帧";;
    7) psych="量化机器"; strat="统计套利对冲";;
    8) psych="新闻敏感"; strat="事件情绪快速";;
    9) psych="耐心等待"; strat="突破箱体忽略";;
  esac
  UPDATE ai_traders SET psychology_type = '$psych', strategy_type = '$strat' WHERE name = '$name';
done;

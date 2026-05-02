UPDATE ai_traders SET psychology_type = CASE 
  (CAST(SUBSTR(id, 4) AS INTEGER) % 10)
  WHEN 0 THEN '贪婪激进' WHEN 1 THEN '谨慎保守' WHEN 2 THEN '平衡稳健'
  WHEN 3 THEN '波动猎手' WHEN 4 THEN '价值投资者' WHEN 5 THEN '反向思维'
  WHEN 6 THEN '技术派' WHEN 7 THEN '量化机器' WHEN 8 THEN '新闻敏感'
  ELSE '耐心等待' END,
strategy_type = CASE 
  (CAST(SUBSTR(id, 4) AS INTEGER) % 10)
  WHEN 0 THEN '追涨杀跌+杠杆倍投,高风险无止损' WHEN 1 THEN '均值回归+止盈止损,低频小仓'
  WHEN 2 THEN '动量网格,中仓动态' WHEN 3 THEN 'ATR突破,高频短线'
  WHEN 4 THEN '低估买高估卖,长持' WHEN 5 THEN '逆势恐慌买'
  WHEN 6 THEN 'MA RSI多帧' WHEN 7 THEN '统计套利对冲' WHEN 8 THEN '事件情绪快速'
  ELSE '突破箱体忽略' END;
SELECT COUNT(*) FROM ai_traders WHERE psychology_type IS NOT NULL;

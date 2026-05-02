import fs from 'fs';
import path from 'path';
import { dbUtils } from '../server/src/db/index.js';

const aiNamesFile = path.join(process.cwd(), 'data', 'ai_names.json');
const aiNames = JSON.parse(fs.readFileSync(aiNamesFile, 'utf8'));

const profiles = [
  { psychology: '贪婪激进', strategy: '追涨杀跌+杠杆倍投, 高风险高回报, 无止损' },
  { psychology: '谨慎保守', strategy: '均值回归+止盈止损, 低频小仓位, 风险控制优先' },
  { psychology: '平衡稳健', strategy: '动量趋势跟踪+网格, 中等仓位, 动态调整' },
  { psychology: '波动猎手', strategy: '波动突破+ATR止损, 高频短线, 捕捉极端' },
  { psychology: '价值投资者', strategy: '低估买入高估卖出, 长线持仓, 基本面驱动' },
  { psychology: '反向思维', strategy: '逆势操作+恐慌买入贪婪卖出, 逆张线交易' },
  { psychology: '技术派', strategy: 'MA交叉+RSI背离, 多时间框架确认' },
  { psychology: '量化机器', strategy: '统计套利+配对交易, 低相关资产对冲' },
  { psychology: '新闻敏感', strategy: '事件驱动+情绪分析, 突发新闻快速反应' },
  { psychology: '耐心等待', strategy: '突破等待+箱体震荡忽略, 完美入场' }
];

let count = 0;
while (count < aiNames.length) {
  const batchSize = Math.min(10, aiNames.length - count);
  for (let i = 0; i < batchSize; i++) {
    const index = count + i;
    const item = aiNames[index];
    const profile = profiles[index % profiles.length];
    const id = `ai_${index.toString().padStart(4, '0')}`;
    const cash = 1000000 + Math.random() * 99000000;
    dbUtils.run('INSERT OR IGNORE INTO ai_traders (id, name, psychology_type, strategy_type, cash, total_assets) VALUES (?, ?, ?, ?, ?, ?)', [id, item.aiName, profile.psychology, profile.strategy, cash, cash]);
  }
  count += batchSize;
  console.log(`Seeded ${count}/${aiNames.length}`);
  if (count < aiNames.length) {
    await new Promise(r => setTimeout(r, 5000));
  }
}

console.log('✅ All 5000 AI traders seeded!');

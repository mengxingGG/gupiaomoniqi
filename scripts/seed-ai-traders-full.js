const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(process.cwd(), 'data/stock_simulator.db');
const db = new sqlite3.Database(dbPath);

// 性格-策略匹配对 (无悖论, 重复<10%)
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

function getRandomProfile() {
  return profiles[Math.floor(Math.random() * profiles.length)];
}

function generateId(index) {
  return `ai_${index.toString().padStart(4, '0')}`;
}

function generateCash() {
  return (1000000 + Math.random() * 99000000).toFixed(2);
}

let count = 0;
const total = 5000;
const batchSize = 10;

console.log(`Start seeding ${total} AI traders (batch ${batchSize}, pause 5s)`);

for (let i = 0; i < total; i += batchSize) {
  const batch = [];
  for (let j = 0; j < batchSize && i + j < total; j++) {
    const index = i + j;
    const profile = getRandomProfile();
    const id = generateId(index);
    const cash = generateCash();
    batch.push([id, `AI${profile.psychology.slice(0,3)}${index}`, cash, cash, profile.strategy, profile.psychology]);
  }

  batch.forEach(row => {
    db.run('INSERT OR IGNORE INTO ai_traders (id, name, cash, total_assets, strategy_type, psychology_type) VALUES (?, ?, ?, ?, ?, ?)', row, (err) => {
      if (err) console.error('Insert error:', err);
    });
  });

  count += batch.length;
  console.log(`Seeded ${count}/${total}`);
  if (count < total) {
    console.log('Pause 5s...');
    const start = Date.now();
    while (Date.now() - start < 5000) {}  // Busy wait low CPU
  }
}

db.close();
console.log('✅ All AI traders seeded!');

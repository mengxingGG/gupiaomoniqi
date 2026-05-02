const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(path.join(process.cwd(), 'data/stock_simulator.db'));

const profiles = [
  ['贪婪激进', '追涨杀跌+杠杆倍投,高风险无止损'],
  ['谨慎保守', '均值回归+止盈止损,低频小仓'],
  ['平衡稳健', '动量网格,中仓动态'],
  ['波动猎手', 'ATR突破,高频短线'],
  ['价值投资者', '低估买高估卖,长持'],
  ['反向思维', '逆势恐慌买'],
  ['技术派', 'MA RSI多帧'],
  ['量化机器', '统计套利对冲'],
  ['新闻敏感', '事件情绪快速'],
  ['耐心等待', '突破箱体忽略']
];

db.each('SELECT id FROM ai_traders ORDER BY id', (err, row) => {
  if (err) throw err;
  const i = parseInt(row.id.split('_')[1]);
  const p = profiles[i % 10];
  db.run('UPDATE ai_traders SET psychology_type = ?, strategy_type = ? WHERE id = ?', p[0], p[1], row.id, (err) => {
    if (err) console.error(err);
  });
}, () => {
  console.log('✅ All AI profiles updated!');
  db.close();
});

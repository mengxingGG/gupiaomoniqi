import fs from 'fs';
import path from 'path';
import { dbUtils } from '../server/src/db/index.js';

const aiNamesFile = path.join(process.cwd(), 'data', 'ai_names.json');
const aiNames = JSON.parse(fs.readFileSync(aiNamesFile, 'utf8'));

const strategyTypes = ['trend', 'mean_revert', 'momentum', 'vol_breakout', 'grid'];
const psychologyTypes = ['aggressive', 'conservative', 'balanced'];

aiNames.forEach((item: any, index: number) => {
  const id = `ai_${index.toString().padStart(4, '0')}`;
  const aiName = item.aiName;
  const strategy = strategyTypes[Math.floor(Math.random() * strategyTypes.length)];
  const psychology = psychologyTypes[Math.floor(Math.random() * psychologyTypes.length)];
  const initialCash = 1000000 + Math.random() * 99000000; // 1M-100M
  const cash = initialCash;

  dbUtils.run(`
    INSERT OR IGNORE INTO ai_traders (id, name, cash, total_assets, strategy_type, psychology_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, aiName, cash, cash, strategy, psychology]);
});

console.log(`✅ Seeded ${aiNames.length} AI traders`);

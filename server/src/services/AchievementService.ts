import { dbUtils } from '../db/index.js';

// 成就定义
export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  condition: (playerId: string) => boolean;
}

// 成就列表
const achievementDefinitions: AchievementDefinition[] = [
  {
    id: 'first_trade',
    name: '初出茅庐',
    description: '完成第一笔交易',
    condition: (playerId: string) => {
      const row = dbUtils.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM transactions WHERE player_id = ?', [playerId]
      );
      return (row?.cnt || 0) >= 1;
    },
  },
  {
    id: 'ten_trades',
    name: '小试牛刀',
    description: '完成10笔交易',
    condition: (playerId: string) => {
      const row = dbUtils.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM transactions WHERE player_id = ?', [playerId]
      );
      return (row?.cnt || 0) >= 10;
    },
  },
  {
    id: 'hundred_trades',
    name: '交易达人',
    description: '完成100笔交易',
    condition: (playerId: string) => {
      const row = dbUtils.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM transactions WHERE player_id = ?', [playerId]
      );
      return (row?.cnt || 0) >= 100;
    },
  },
  {
    id: 'first_stock',
    name: '股东一枚',
    description: '买入第一只股票',
    condition: (playerId: string) => {
      const row = dbUtils.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM positions WHERE player_id = ?', [playerId]
      );
      return (row?.cnt || 0) >= 1;
    },
  },
  {
    id: 'five_stocks',
    name: '分散投资',
    description: '同时持有5只股票',
    condition: (playerId: string) => {
      const row = dbUtils.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM positions WHERE player_id = ?', [playerId]
      );
      return (row?.cnt || 0) >= 5;
    },
  },
  {
    id: 'millionaire',
    name: '百万富翁',
    description: '总资产超过100万',
    condition: (playerId: string) => {
      const player = dbUtils.queryOne<{ total_assets: number }>(
        'SELECT total_assets FROM players WHERE id = ?', [playerId]
      );
      return (player?.total_assets || 0) >= 1000000;
    },
  },
  {
    id: 'ten_million',
    name: '千万富翁',
    description: '总资产超过1000万',
    condition: (playerId: string) => {
      const player = dbUtils.queryOne<{ total_assets: number }>(
        'SELECT total_assets FROM players WHERE id = ?', [playerId]
      );
      return (player?.total_assets || 0) >= 10000000;
    },
  },
  {
    id: 'profit_10',
    name: '盈利10%',
    description: '收益率达到10%',
    condition: (playerId: string) => {
      const player = dbUtils.queryOne<{ total_assets: number; initial_cash: number }>(
        'SELECT total_assets, initial_cash FROM players WHERE id = ?', [playerId]
      );
      if (!player) return false;
      return ((player.total_assets - player.initial_cash) / player.initial_cash * 100) >= 10;
    },
  },
  {
    id: 'profit_50',
    name: '盈利50%',
    description: '收益率达到50%',
    condition: (playerId: string) => {
      const player = dbUtils.queryOne<{ total_assets: number; initial_cash: number }>(
        'SELECT total_assets, initial_cash FROM players WHERE id = ?', [playerId]
      );
      if (!player) return false;
      return ((player.total_assets - player.initial_cash) / player.initial_cash * 100) >= 50;
    },
  },
  {
    id: 'profit_100',
    name: '翻倍',
    description: '收益率达到100%',
    condition: (playerId: string) => {
      const player = dbUtils.queryOne<{ total_assets: number; initial_cash: number }>(
        'SELECT total_assets, initial_cash FROM players WHERE id = ?', [playerId]
      );
      if (!player) return false;
      return ((player.total_assets - player.initial_cash) / player.initial_cash * 100) >= 100;
    },
  },
  {
    id: 'borrow_first',
    name: '负债前行',
    description: '第一次借款',
    condition: (playerId: string) => {
      const row = dbUtils.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM loans WHERE player_id = ?', [playerId]
      );
      return (row?.cnt || 0) >= 1;
    },
  },
  {
    id: 'repay_first',
    name: '有借有还',
    description: '还清第一笔贷款',
    condition: (playerId: string) => {
      const row = dbUtils.queryOne<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM loans WHERE player_id = ? AND status = ?', [playerId, 'REPAID']
      );
      return (row?.cnt || 0) >= 1;
    },
  },
];

export class AchievementService {
  // 检查并解锁成就
  checkAchievements(playerId: string): string[] {
    const newlyUnlocked: string[] = [];

    const existing = dbUtils.query<{ achievement_id: string }>(
      'SELECT achievement_id FROM achievements WHERE player_id = ?', [playerId]
    );
    const unlockedIds = new Set(existing.map(a => a.achievement_id));

    for (const def of achievementDefinitions) {
      if (unlockedIds.has(def.id)) continue;

      const isUnlocked = def.condition(playerId);
      if (isUnlocked) {
        dbUtils.run(
          'INSERT OR IGNORE INTO achievements (id, player_id, achievement_id, unlocked_at) VALUES (?, ?, ?, ?)',
          [playerId + '_' + def.id, playerId, def.id, Date.now()]
        );
        newlyUnlocked.push(def.id);
      }
    }

    return newlyUnlocked;
  }

  // 获取玩家成就列表
  getAchievements(playerId: string) {
    const unlocked = dbUtils.query<{ achievement_id: string; unlocked_at: number }>(
      'SELECT achievement_id, unlocked_at FROM achievements WHERE player_id = ?', [playerId]
    );
    const unlockedMap = new Map(unlocked.map(a => [a.achievement_id, a.unlocked_at]));

    return achievementDefinitions.map(def => ({
      id: def.id,
      name: def.name,
      description: def.description,
      unlocked: unlockedMap.has(def.id),
      unlockedAt: unlockedMap.get(def.id),
    }));
  }
}

export const achievementService = new AchievementService();

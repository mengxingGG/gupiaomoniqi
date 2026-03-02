import { dbUtils } from '../db/index.js';
import fs from 'fs';
import path from 'path';

interface GiftCodeConfig {
  code: string;
  amount: number;
  description: string;
  maxUses?: number; // -1 = 无限次，省略或其他值 = 每人一次
}

// 加载礼包码配置
function loadGiftCodes(): GiftCodeConfig[] {
  const possiblePaths = [
    './data/gift-codes.json',
    '../data/gift-codes.json',
    '../../data/gift-codes.json',
    path.join(process.cwd(), 'data', 'gift-codes.json'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8');
      const parsed = JSON.parse(content);
      // 支持 { giftCodes: [...] } 或 [...] 两种格式
      const arr: any[] = parsed.giftCodes || parsed;
      return arr.map((c: any) => ({
        code: c.code,
        amount: c.amount ?? c.reward ?? 0,
        description: c.description || '',
        maxUses: c.maxUses,
      }));
    }
  }

  return [];
}

export class GiftCodeService {
  // 兑换礼包码
  redeem(playerId: string, code: string): { amount: number; player: any } {
    const normalizedCode = code.trim().toUpperCase();

    // 加载礼包码配置
    const giftCodes = loadGiftCodes();
    const giftCode = giftCodes.find(c => c.code === normalizedCode);

    if (!giftCode) {
      throw new Error('INVALID_CODE');
    }

    // 检查是否已使用（maxUses !== -1 时每人只能用一次）
    if (giftCode.maxUses !== -1) {
      const usage = dbUtils.queryOne<any>(
        'SELECT * FROM gift_code_usage WHERE player_id = ? AND code = ?',
        [playerId, normalizedCode]
      );
      if (usage) {
        throw new Error('CODE_ALREADY_USED');
      }
    }

    // 获取玩家
    const player = dbUtils.queryOne<any>(
      'SELECT * FROM players WHERE id = ?',
      [playerId]
    );
    if (!player) {
      throw new Error('PLAYER_NOT_FOUND');
    }

    // 记录使用（INSERT OR REPLACE 防止重复键冲突）
    dbUtils.run(
      'INSERT OR REPLACE INTO gift_code_usage (player_id, code, used_at) VALUES (?, ?, ?)',
      [playerId, normalizedCode, Date.now()]
    );

    // 添加资金
    dbUtils.run(
      'UPDATE players SET cash = cash + ?, updated_at = ? WHERE id = ?',
      [giftCode.amount, Date.now(), playerId]
    );

    const updatedPlayer = dbUtils.queryOne<any>(
      'SELECT * FROM players WHERE id = ?',
      [playerId]
    );

    return {
      amount: giftCode.amount,
      player: updatedPlayer,
    };
  }
}

export const giftCodeService = new GiftCodeService();

import { dbUtils } from '../db/index.js';

export class RankingService {
  // 获取排行榜
  getRanking(limit: number = 20): any[] {
    const allPlayers = dbUtils.query<any>('SELECT * FROM players');
    const allAccounts = dbUtils.query<any>('SELECT id, display_name FROM accounts');

    const accountMap = new Map(allAccounts.map((a: any) => [a.id, a.display_name]));

    const rankings = allPlayers.map((player: any) => {
      const displayName = accountMap.get(player.id) || '未知';
      const profit = player.total_assets - player.initial_cash;
      const profitPercent = (profit / player.initial_cash) * 100;

      return {
        playerId: player.id,
        displayName,
        totalAssets: player.total_assets,
        cash: player.cash,
        profit,
        profitPercent,
      };
    });

    // 按总资产排序
    rankings.sort((a: any, b: any) => b.totalAssets - a.totalAssets);

    return rankings.slice(0, limit).map((r: any, i: number) => ({
      ...r,
      rank: i + 1,
    }));
  }
}

export const rankingService = new RankingService();

import { dbUtils } from '../db/index.js';

export class RankingService {
  private cachedRanking: any[] = [];
  private cachedAIRanking: any[] = [];
  private lastUpdate: number = 0;
  private lastAIUpdate: number = 0;
  private cacheInterval: number = 10 * 60 * 1000; // 10 分钟缓存

  // 获取排行榜（包含真实玩家和 AI 交易者）
  getRanking(limit: number = 100): any[] {
    // 限制最多 100 名
    limit = Math.min(limit, 100);
    
    const now = Date.now();
    
    // 检查缓存是否过期
    if (now - this.lastUpdate > this.cacheInterval || this.cachedRanking.length === 0) {
      this.cachedRanking = this.computeRanking();
      this.lastUpdate = now;
      console.log('📊 排行榜缓存已更新');
    }
    
    return this.cachedRanking.slice(0, limit);
  }

  // 计算排行榜
  private computeRanking(): any[] {
    // 获取真实玩家
    const allPlayers = dbUtils.query<any>('SELECT * FROM players');
    const allAccounts = dbUtils.query<any>('SELECT id, display_name FROM accounts');
    const accountMap = new Map(allAccounts.map((a: any) => [a.id, a.display_name]));

    const rankings: any[] = [];

    // 添加真实玩家
    for (const player of allPlayers) {
      const displayName = accountMap.get(player.id) || '未知';
      const profit = player.total_assets - player.initial_cash;
      const profitPercent = (profit / player.initial_cash) * 100;

      rankings.push({
        playerId: player.id,
        displayName,
        totalAssets: player.total_assets,
        cash: player.cash,
        profit,
        profitPercent,
        isAI: false,
      });
    }

    // 获取 AI 交易者
    const aiTraders = dbUtils.query<any>('SELECT id, name, cash, total_assets, is_smart FROM ai_traders WHERE total_assets > 0');
    const initialCash = 500000; // AI 初始资金假设值

    for (const trader of aiTraders) {
      const profit = trader.total_assets - initialCash;
      const profitPercent = (profit / initialCash) * 100;

      rankings.push({
        playerId: trader.id,
        displayName: trader.name,
        totalAssets: trader.total_assets,
        cash: trader.cash,
        profit,
        profitPercent,
        isAI: true,
        isSmart: trader.is_smart === 1,
      });
    }

    // 按总资产排序
    rankings.sort((a: any, b: any) => b.totalAssets - a.totalAssets);

    return rankings.map((r: any, i: number) => ({
      ...r,
      rank: i + 1,
    }));
  }

  // 获取 AI 交易者排行榜
  getAIRanking(limit: number = 100): any[] {
    limit = Math.min(limit, 100);
    
    const now = Date.now();
    
    // 检查缓存是否过期
    if (now - this.lastAIUpdate > this.cacheInterval || this.cachedAIRanking.length === 0) {
      this.cachedAIRanking = this.computeAIRanking();
      this.lastAIUpdate = now;
      console.log('🤖 AI 排行榜缓存已更新');
    }
    
    return this.cachedAIRanking.slice(0, limit);
  }

  // 计算 AI 排行榜
  private computeAIRanking(): any[] {
    const aiTraders = dbUtils.query<any>(
      'SELECT id, name, cash, total_assets, strategy_type, is_smart, total_trades, win_count, loss_count FROM ai_traders WHERE total_assets > 0 ORDER BY total_assets DESC LIMIT 100'
    );

    const initialCash = 500000;

    return aiTraders.map((trader: any, i: number) => {
      const profit = trader.total_assets - initialCash;
      const profitPercent = (profit / initialCash) * 100;
      const winRate = trader.total_trades > 0 ? (trader.win_count / trader.total_trades * 100) : 0;

      return {
        rank: i + 1,
        traderId: trader.id,
        displayName: trader.name,
        totalAssets: trader.total_assets,
        cash: trader.cash,
        profit,
        profitPercent,
        strategyType: trader.strategy_type,
        isSmart: trader.is_smart === 1,
        totalTrades: trader.total_trades,
        winRate: winRate.toFixed(1),
      };
    });
  }

  // 强制刷新缓存
  refreshCache(): void {
    this.lastUpdate = 0;
    this.lastAIUpdate = 0;
    console.log('🔄 排行榜缓存已清除，下次请求时刷新');
  }
}

export const rankingService = new RankingService();
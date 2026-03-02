import { dbUtils } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

const FEE_RATE = 0.0003;

interface StockRow {
  code: string;
  name: string;
  market: string;
  current_price: number;
  previous_close: number;
  high_price: number;
  low_price: number;
  volume: number;
  turnover: number;
}

interface PlayerRow {
  id: string;
  cash: number;
  initial_cash: number;
  total_assets: number;
  trading_day: number;
  is_paused: number;
  updated_at: number;
}

interface PositionRow {
  id: string;
  player_id: string;
  stock_code: string;
  stock_name: string;
  market: string;
  quantity: number;
  available_quantity: number;
  average_cost: number;
  total_cost: number;
  buy_date: number;
}

interface OrderRow {
  id: string;
  player_id: string;
  stock_code: string;
  stock_name: string;
  type: string;
  order_mode: string;
  quantity: number;
  price: number | null;
  executed_price: number | null;
  status: string;
  fee: number;
  created_at: number;
  executed_at: number | null;
}

export interface TradeInput {
  playerId: string;
  stockCode: string;
  quantity: number;
  orderMode: 'MARKET' | 'LIMIT';
  price?: number;
}

// 计算玩家总资产（现金 + 持仓市值）
function calcTotalAssets(playerId: string, cash: number): number {
  const positions = dbUtils.query<PositionRow>(
    'SELECT p.quantity, s.current_price FROM positions p JOIN stocks s ON p.stock_code = s.code WHERE p.player_id = ?',
    [playerId]
  );
  const positionsValue = positions.reduce((sum, p) => sum + p.quantity * (p as any).current_price, 0);
  return cash + positionsValue;
}

export class TradeService {
  // 买入
  buy(input: TradeInput): { order: any; player: PlayerRow } {
    const { playerId, stockCode, quantity, orderMode, price } = input;

    // 1. 验证股票是否存在
    const stock = dbUtils.queryOne<StockRow>(
      'SELECT * FROM stocks WHERE code = ?',
      [stockCode]
    );
    if (!stock) {
      throw new Error('STOCK_NOT_FOUND');
    }

    // 2. 获取当前玩家资金
    const player = dbUtils.queryOne<PlayerRow>(
      'SELECT * FROM players WHERE id = ?',
      [playerId]
    );
    if (!player) {
      throw new Error('PLAYER_NOT_FOUND');
    }

    // 3. 计算成交价格
    const executionPrice = orderMode === 'MARKET' ? stock.current_price : (price || stock.current_price);

    // 4. 计算所需资金
    const totalCost = executionPrice * quantity;
    const fee = totalCost * FEE_RATE;
    const totalWithFee = totalCost + fee;

    // 5. 验证资金是否充足
    if (player.cash < totalWithFee) {
      throw new Error('INSUFFICIENT_FUNDS');
    }

    const now = Date.now();

    // 6. 创建订单
    const orderId = uuidv4();
    const newOrder: OrderRow = {
      id: orderId,
      player_id: playerId,
      stock_code: stockCode,
      stock_name: stock.name,
      type: 'BUY',
      order_mode: orderMode,
      quantity,
      price: orderMode === 'LIMIT' ? price! : null,
      executed_price: executionPrice,
      status: 'EXECUTED',
      fee,
      created_at: now,
      executed_at: now,
    };

    dbUtils.transaction(() => {
      dbUtils.run(
        'INSERT INTO orders (id, player_id, stock_code, stock_name, type, order_mode, quantity, price, executed_price, status, fee, created_at, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [newOrder.id, newOrder.player_id, newOrder.stock_code, newOrder.stock_name, newOrder.type, newOrder.order_mode, newOrder.quantity, newOrder.price, newOrder.executed_price, newOrder.status, newOrder.fee, newOrder.created_at, newOrder.executed_at]
      );

      // 7. 更新或创建持仓
      const existingPosition = dbUtils.queryOne<PositionRow>(
        'SELECT * FROM positions WHERE player_id = ? AND stock_code = ?',
        [playerId, stockCode]
      );

      if (!existingPosition) {
        dbUtils.run(
          'INSERT INTO positions (id, player_id, stock_code, stock_name, market, quantity, available_quantity, average_cost, total_cost, buy_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [uuidv4(), playerId, stockCode, stock.name, stock.market, quantity, quantity, executionPrice, totalCost, now]
        );
      } else {
        const newQuantity = existingPosition.quantity + quantity;
        const newTotalCost = existingPosition.total_cost + totalCost;
        const newAvgCost = newTotalCost / newQuantity;
        dbUtils.run(
          'UPDATE positions SET quantity = ?, available_quantity = ?, average_cost = ?, total_cost = ? WHERE id = ?',
          [newQuantity, existingPosition.available_quantity + quantity, newAvgCost, newTotalCost, existingPosition.id]
        );
      }

      // 8. 更新玩家资金
      dbUtils.run(
        'UPDATE players SET cash = cash - ?, updated_at = ? WHERE id = ?',
        [totalWithFee, now, playerId]
      );
      dbUtils.run(
        'INSERT INTO transactions (id, player_id, stock_code, stock_name, type, quantity, price, total, fee, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), playerId, stockCode, stock.name, 'BUY', quantity, executionPrice, totalCost, fee, now]
      );
    });

    // 10. 重新获取更新后的玩家数据并计算总资产
    const updatedPlayer = dbUtils.queryOne<PlayerRow>(
      'SELECT * FROM players WHERE id = ?',
      [playerId]
    );

    const totalAssets = calcTotalAssets(playerId, updatedPlayer!.cash);
    dbUtils.run(
      'UPDATE players SET total_assets = ? WHERE id = ?',
      [totalAssets, playerId]
    );
    updatedPlayer!.total_assets = totalAssets;

    return {
      order: newOrder,
      player: updatedPlayer!,
    };
  }

  // 卖出
  sell(input: TradeInput): { order: any; player: PlayerRow } {
    const { playerId, stockCode, quantity, orderMode, price } = input;

    // 1. 验证持仓
    const position = dbUtils.queryOne<PositionRow>(
      'SELECT * FROM positions WHERE player_id = ? AND stock_code = ?',
      [playerId, stockCode]
    );
    if (!position) {
      throw new Error('NO_POSITION');
    }

    // 2. 验证可卖出数量
    if (position.available_quantity < quantity) {
      throw new Error('INSUFFICIENT_AVAILABLE_QUANTITY');
    }

    // 3. 获取股票
    const stock = dbUtils.queryOne<StockRow>(
      'SELECT * FROM stocks WHERE code = ?',
      [stockCode]
    );
    if (!stock) {
      throw new Error('STOCK_NOT_FOUND');
    }

    // 4. 计算成交价格
    const executionPrice = orderMode === 'MARKET' ? stock.current_price : (price || stock.current_price);

    // 5. 计算所得
    const totalProceeds = executionPrice * quantity;
    const fee = totalProceeds * FEE_RATE;
    const netProceeds = totalProceeds - fee;

    // 6. 获取玩家
    const player = dbUtils.queryOne<PlayerRow>(
      'SELECT * FROM players WHERE id = ?',
      [playerId]
    );
    if (!player) {
      throw new Error('PLAYER_NOT_FOUND');
    }

    const now = Date.now();

    // 7. 创建订单
    const orderId = uuidv4();
    const newOrder: OrderRow = {
      id: orderId,
      player_id: playerId,
      stock_code: stockCode,
      stock_name: stock.name,
      type: 'SELL',
      order_mode: orderMode,
      quantity,
      price: orderMode === 'LIMIT' ? price! : null,
      executed_price: executionPrice,
      status: 'EXECUTED',
      fee,
      created_at: now,
      executed_at: now,
    };

    dbUtils.transaction(() => {
      dbUtils.run(
        'INSERT INTO orders (id, player_id, stock_code, stock_name, type, order_mode, quantity, price, executed_price, status, fee, created_at, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [newOrder.id, newOrder.player_id, newOrder.stock_code, newOrder.stock_name, newOrder.type, newOrder.order_mode, newOrder.quantity, newOrder.price, newOrder.executed_price, newOrder.status, newOrder.fee, newOrder.created_at, newOrder.executed_at]
      );

      // 8. 更新持仓
      const newQuantity = position.quantity - quantity;
      if (newQuantity <= 0) {
        dbUtils.run('DELETE FROM positions WHERE id = ?', [position.id]);
      } else {
        const newTotalCost = position.total_cost * (newQuantity / position.quantity);
        dbUtils.run(
          'UPDATE positions SET quantity = ?, available_quantity = ?, total_cost = ? WHERE id = ?',
          [newQuantity, position.available_quantity - quantity, newTotalCost, position.id]
        );
      }

      // 9. 更新玩家资金
      dbUtils.run(
        'UPDATE players SET cash = cash + ?, updated_at = ? WHERE id = ?',
        [netProceeds, now, playerId]
      );

      // 10. 创建交易记录
      dbUtils.run(
        'INSERT INTO transactions (id, player_id, stock_code, stock_name, type, quantity, price, total, fee, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), playerId, stockCode, stock.name, 'SELL', quantity, executionPrice, totalProceeds, fee, now]
      );
    });

    // 11. 重新获取玩家数据并计算总资产
    const updatedPlayer = dbUtils.queryOne<PlayerRow>(
      'SELECT * FROM players WHERE id = ?',
      [playerId]
    );

    const totalAssets = calcTotalAssets(playerId, updatedPlayer!.cash);
    dbUtils.run(
      'UPDATE players SET total_assets = ? WHERE id = ?',
      [totalAssets, playerId]
    );
    updatedPlayer!.total_assets = totalAssets;

    return {
      order: newOrder,
      player: updatedPlayer!,
    };
  }

  // 撤单
  cancel(orderId: string, playerId: string): { order: any; player: PlayerRow } {
    const order = dbUtils.queryOne<OrderRow>(
      'SELECT * FROM orders WHERE id = ? AND player_id = ?',
      [orderId, playerId]
    );
    if (!order) {
      throw new Error('ORDER_NOT_FOUND');
    }
    if (order.status !== 'PENDING') {
      throw new Error('ORDER_NOT_PENDING');
    }

    const now = Date.now();

    // 更新订单状态
    dbUtils.run(
      'UPDATE orders SET status = ?, executed_at = ? WHERE id = ?',
      ['CANCELLED', now, orderId]
    );

    // 如果是买单，返还资金（本金 + 手续费）
    if (order.type === 'BUY' && order.executed_price) {
      const refundAmount = order.executed_price * order.quantity + order.fee;
      dbUtils.run(
        'UPDATE players SET cash = cash + ?, updated_at = ? WHERE id = ?',
        [refundAmount, now, playerId]
      );
    }

    const updatedPlayer = dbUtils.queryOne<PlayerRow>(
      'SELECT * FROM players WHERE id = ?',
      [playerId]
    );

    return {
      order: { ...order, status: 'CANCELLED' },
      player: updatedPlayer!,
    };
  }

  // 获取订单列表
  getOrders(playerId: string): OrderRow[] {
    return dbUtils.query<OrderRow>(
      'SELECT * FROM orders WHERE player_id = ? ORDER BY created_at DESC',
      [playerId]
    );
  }

  // 获取持仓列表
  getPositions(playerId: string): PositionRow[] {
    return dbUtils.query<PositionRow>(
      'SELECT * FROM positions WHERE player_id = ?',
      [playerId]
    );
  }

  // 获取交易记录
  getTransactions(playerId: string, limit: number = 50): any[] {
    return dbUtils.query(
      'SELECT * FROM transactions WHERE player_id = ? ORDER BY created_at DESC LIMIT ?',
      [playerId, limit]
    );
  }
}

export const tradeService = new TradeService();

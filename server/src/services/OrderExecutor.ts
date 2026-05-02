import { dbUtils } from '../db/index.js';

const FEE_RATE = 0.0003;

// 判断是否为 T+0 市场
function isT0Market(market: string): boolean {
  return market.endsWith('_T0');
}

// 检查并执行待成交的限价单
export function checkAndExecutePendingOrders() {
  // 获取所有待成交的限价单
  const pendingOrders = dbUtils.query<any>(
    `SELECT o.*, s.current_price, s.name as stock_name, s.market
     FROM orders o 
     JOIN stocks s ON o.stock_code = s.code 
     WHERE o.status = 'PENDING'`
  );

  for (const order of pendingOrders) {
    const currentPrice = order.current_price;
    const limitPrice = order.price;
    let shouldExecute = false;

    if (order.type === 'BUY') {
      // 买单：股价 <= 限价时成交
      shouldExecute = currentPrice <= limitPrice;
    } else if (order.type === 'SELL') {
      // 卖单：股价 >= 限价时成交
      shouldExecute = currentPrice >= limitPrice;
    }

    if (shouldExecute) {
      executeOrder(order);
    }
  }
}

// 执行订单
function executeOrder(order: any) {
  const now = Date.now();
  const executedPrice = order.price; // 按限价成交

  dbUtils.transaction(() => {
    if (order.type === 'BUY') {
      // 扣除资金
      const totalCost = executedPrice * order.quantity;
      const fee = totalCost * FEE_RATE;
      const totalWithFee = totalCost + fee;

      dbUtils.run(
        'UPDATE players SET cash = cash - ?, updated_at = ? WHERE id = ?',
        [totalWithFee, now, order.player_id]
      );

      // 更新或创建持仓
      const existingPosition = dbUtils.queryOne<any>(
        'SELECT * FROM positions WHERE player_id = ? AND stock_code = ?',
        [order.player_id, order.stock_code]
      );

      if (!existingPosition) {
        dbUtils.run(
          `INSERT INTO positions (id, player_id, stock_code, stock_name, market, quantity, available_quantity, average_cost, total_cost, buy_date) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [order.player_id + '_' + order.stock_code, order.player_id, order.stock_code, order.stock_name, order.market, order.quantity, isT0Market(order.market) ? order.quantity : 0, executedPrice, totalCost, now]
        );
      } else {
        const newQuantity = existingPosition.quantity + order.quantity;
        const newTotalCost = existingPosition.total_cost + totalCost;
        const newAvgCost = newTotalCost / newQuantity;
        dbUtils.run(
          'UPDATE positions SET quantity = ?, available_quantity = ?, average_cost = ?, total_cost = ? WHERE id = ?',
          [newQuantity, isT0Market(order.market) ? existingPosition.available_quantity + order.quantity : existingPosition.available_quantity, newAvgCost, newTotalCost, existingPosition.id]
        );
      }

      // 记录成交
      dbUtils.run(
        'INSERT INTO transactions (id, player_id, stock_code, stock_name, type, quantity, price, total, fee, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [order.player_id + '_' + order.id, order.player_id, order.stock_code, order.stock_name, 'BUY', order.quantity, executedPrice, totalCost, fee, now]
      );

    } else if (order.type === 'SELL') {
      // 增加资金
      const totalProceeds = executedPrice * order.quantity;
      const fee = totalProceeds * FEE_RATE;
      const netProceeds = totalProceeds - fee;

      dbUtils.run(
        'UPDATE players SET cash = cash + ?, updated_at = ? WHERE id = ?',
        [netProceeds, now, order.player_id]
      );

      // 更新持仓
      const position = dbUtils.queryOne<any>(
        'SELECT * FROM positions WHERE player_id = ? AND stock_code = ?',
        [order.player_id, order.stock_code]
      );

      if (position) {
        const newQuantity = position.quantity - order.quantity;
        if (newQuantity <= 0) {
          dbUtils.run('DELETE FROM positions WHERE id = ?', [position.id]);
        } else {
          const costReduction = position.average_cost * order.quantity;
          const newAvailableQuantity = Math.max(0, position.available_quantity - order.quantity);
          dbUtils.run(
            'UPDATE positions SET quantity = ?, available_quantity = ?, total_cost = total_cost - ? WHERE id = ?',
            [newQuantity, newAvailableQuantity, costReduction, position.id]
          );
        }
      }

      // 记录成交
      dbUtils.run(
        'INSERT INTO transactions (id, player_id, stock_code, stock_name, type, quantity, price, total, fee, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [order.player_id + '_' + order.id, order.player_id, order.stock_code, order.stock_name, 'SELL', order.quantity, executedPrice, totalProceeds, fee, now]
      );
    }

    // 更新订单状态
    dbUtils.run(
      'UPDATE orders SET status = ?, executed_price = ?, executed_at = ? WHERE id = ?',
      ['EXECUTED', executedPrice, now, order.id]
    );
  });

  // 更新总资产
  const player = dbUtils.queryOne<any>('SELECT * FROM players WHERE id = ?', [order.player_id]);
  if (player) {
    const positions = dbUtils.query<any>(
      'SELECT p.quantity, s.current_price FROM positions p JOIN stocks s ON p.stock_code = s.code WHERE p.player_id = ?',
      [order.player_id]
    );
    const positionsValue = positions.reduce((sum, p) => sum + p.quantity * p.current_price, 0);
    const totalAssets = player.cash + positionsValue;
    dbUtils.run('UPDATE players SET total_assets = ? WHERE id = ?', [totalAssets, order.player_id]);
  }

  console.log(`✅ 限价单成交: ${order.type} ${order.stock_code} ${order.quantity}股 @ ${executedPrice}`);
}

// 启动订单检查定时器
export function startOrderExecutor(intervalMs = 5000) {
  console.log(`📋 启动订单执行器 (interval: ${intervalMs}ms)`);

  setInterval(() => {
    try {
      checkAndExecutePendingOrders();
    } catch (error) {
      console.error('订单执行器错误:', error);
    }
  }, intervalMs);
}

import { v4 as uuidv4 } from 'uuid';
import { dbUtils } from '../db/index.js';

export class LoanService {
  // 借款
  borrow(playerId: string, amount: number): { loan: any; player: any } {
    if (amount <= 0) {
      throw new Error('INVALID_AMOUNT');
    }

    const player = dbUtils.queryOne<any>(
      'SELECT * FROM players WHERE id = ?',
      [playerId]
    );
    if (!player) {
      throw new Error('PLAYER_NOT_FOUND');
    }

    // 计算可借款上限
    const maxLoan = player.total_assets * 0.5;
    const currentDebt = dbUtils.query<any>(
      'SELECT SUM(principal + interest) as debt FROM loans WHERE player_id = ? AND status = ?',
      [playerId, 'ACTIVE']
    )[0]?.debt || 0;

    if (currentDebt + amount > maxLoan) {
      throw new Error('LOAN_LIMIT_EXCEEDED');
    }

    const now = Date.now();
    const loanId = uuidv4();

    dbUtils.run(
      'INSERT INTO loans (id, player_id, principal, interest, annual_rate, status, borrow_date, last_interest_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [loanId, playerId, amount, 0, 0.17, 'ACTIVE', now, now]
    );

    dbUtils.run(
      'UPDATE players SET cash = cash + ?, updated_at = ? WHERE id = ?',
      [amount, now, playerId]
    );

    const updatedPlayer = dbUtils.queryOne<any>(
      'SELECT * FROM players WHERE id = ?',
      [playerId]
    );

    return {
      loan: {
        id: loanId,
        player_id: playerId,
        principal: amount,
        interest: 0,
        annual_rate: 0.17,
        status: 'ACTIVE',
        borrow_date: now,
        last_interest_at: now,
      },
      player: updatedPlayer,
    };
  }

  // 还款
  repay(playerId: string, loanId: string, amount: number): { loan: any; player: any } {
    if (amount <= 0) {
      throw new Error('INVALID_AMOUNT');
    }

    const loan = dbUtils.queryOne<any>(
      'SELECT * FROM loans WHERE id = ?',
      [loanId]
    );
    if (!loan) {
      throw new Error('LOAN_NOT_FOUND');
    }
    if (loan.player_id !== playerId) {
      throw new Error('UNAUTHORIZED');
    }
    if (loan.status === 'REPAID') {
      throw new Error('LOAN_ALREADY_REPAID');
    }

    const totalDue = loan.principal + loan.interest;
    const repayAmount = Math.min(amount, totalDue);

    const now = Date.now();

    if (repayAmount >= totalDue) {
      dbUtils.run(
        'UPDATE loans SET status = ? WHERE id = ?',
        ['REPAID', loanId]
      );
    } else {
      const ratio = repayAmount / totalDue;
      dbUtils.run(
        'UPDATE loans SET principal = principal * (1 - ?), interest = interest * (1 - ?) WHERE id = ?',
        [ratio, ratio, loanId]
      );
    }

    dbUtils.run(
      'UPDATE players SET cash = cash - ?, updated_at = ? WHERE id = ?',
      [repayAmount, now, playerId]
    );

    const updatedPlayer = dbUtils.queryOne<any>(
      'SELECT * FROM players WHERE id = ?',
      [playerId]
    );

    const updatedLoan = dbUtils.queryOne<any>(
      'SELECT * FROM loans WHERE id = ?',
      [loanId]
    );

    return {
      loan: updatedLoan,
      player: updatedPlayer,
    };
  }

  // 获取借贷记录
  getLoans(playerId: string): any[] {
    return dbUtils.query(
      'SELECT * FROM loans WHERE player_id = ? ORDER BY borrow_date DESC',
      [playerId]
    );
  }
}

export const loanService = new LoanService();

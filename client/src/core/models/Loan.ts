/**
 * 借贷数据模型定义
 */

// 借贷数据接口
export interface Loan {
  id: string;
  playerId: string;
  principal: number;      // 本金
  interest: number;       // 累计利息
  annualRate: number;    // 年利率
  borrowDate: number;
  lastInterestDate: number;
  status: LoanStatus;
}

// 借贷状态
export enum LoanStatus {
  ACTIVE = 'ACTIVE',     // 活动中
  REPAID = 'REPAID',     // 已还清
  OVERDUE = 'OVERDUE',   // 逾期
}

// 借款结果
export interface BorrowResult {
  success: boolean;
  loan?: Loan;
  message?: string;
}

// 还款结果
export interface RepayResult {
  success: boolean;
  repaidAmount: number;
  remainingDebt: number;
  message?: string;
}

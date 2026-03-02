import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { dbUtils } from '../db/index.js';

export interface UserPayload {
  userId: string;
  username: string;
  displayName: string;
}

export interface PlayerData {
  id: string;
  cash: number;
  initialCash: number;
  totalAssets: number;
  tradingDay: number;
  isPaused: number;
  updatedAt: number;
}

export interface RegisterInput {
  username: string;
  password: string;
  displayName: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

interface AccountRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  created_at: number;
  last_login_at: number | null;
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

function mapPlayer(row: PlayerRow): PlayerData {
  return {
    id: row.id,
    cash: row.cash,
    initialCash: row.initial_cash,
    totalAssets: row.total_assets,
    tradingDay: row.trading_day,
    isPaused: row.is_paused,
    updatedAt: row.updated_at,
  };
}

export class AuthService {
  // 注册新用户
  async register(input: RegisterInput): Promise<{ token: string; user: UserPayload; player: PlayerData }> {
    const { username, password, displayName } = input;

    // 检查用户名是否已存在
    const existing = dbUtils.queryOne<AccountRow>(
      'SELECT id FROM accounts WHERE username = ?',
      [username]
    );
    if (existing) {
      throw new Error('USERNAME_EXISTS');
    }

    // 密码哈希
    const passwordHash = await bcrypt.hash(password, 10);

    // 创建账户
    const userId = uuidv4();
    const now = Date.now();

    dbUtils.run(
      'INSERT INTO accounts (id, username, password_hash, display_name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, username, passwordHash, displayName, now, now]
    );

    // 创建玩家档案
    dbUtils.run(
      'INSERT INTO players (id, cash, initial_cash, total_assets, trading_day, is_paused, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, 1000000, 1000000, 1000000, 1, 0, now]
    );

    // 获取玩家数据
    const player = dbUtils.queryOne<PlayerRow>(
      'SELECT * FROM players WHERE id = ?',
      [userId]
    );

    return {
      token: '', // Token 由调用处生成
      user: { userId, username, displayName },
      player: mapPlayer(player!),
    };
  }

  // 用户登录
  async login(input: LoginInput): Promise<{ token: string; user: UserPayload; player: PlayerData }> {
    const { username, password } = input;

    // 查找用户
    const account = dbUtils.queryOne<AccountRow>(
      'SELECT * FROM accounts WHERE username = ?',
      [username]
    );
    if (!account) {
      throw new Error('INVALID_CREDENTIALS');
    }

    // 验证密码
    const valid = await bcrypt.compare(password, account.password_hash);
    if (!valid) {
      throw new Error('INVALID_CREDENTIALS');
    }

    // 更新最后登录时间
    dbUtils.run(
      'UPDATE accounts SET last_login_at = ? WHERE id = ?',
      [Date.now(), account.id]
    );

    // 获取玩家数据
    const player = dbUtils.queryOne<PlayerRow>(
      'SELECT * FROM players WHERE id = ?',
      [account.id]
    );

    return {
      token: '',
      user: {
        userId: account.id,
        username: account.username,
        displayName: account.display_name,
      },
      player: mapPlayer(player!),
    };
  }

  // 获取当前用户信息
  getMe(userId: string): { user: UserPayload; player: PlayerData } | null {
    const account = dbUtils.queryOne<AccountRow>(
      'SELECT * FROM accounts WHERE id = ?',
      [userId]
    );
    if (!account) return null;

    const player = dbUtils.queryOne<PlayerRow>(
      'SELECT * FROM players WHERE id = ?',
      [userId]
    );

    return {
      user: {
        userId: account.id,
        username: account.username,
        displayName: account.display_name,
      },
      player: mapPlayer(player!),
    };
  }

  // 删除账号
  deleteAccount(userId: string): void {
    dbUtils.transaction(() => {
      dbUtils.run('DELETE FROM positions WHERE player_id = ?', [userId]);
      dbUtils.run('DELETE FROM orders WHERE player_id = ?', [userId]);
      dbUtils.run('DELETE FROM transactions WHERE player_id = ?', [userId]);
      dbUtils.run('DELETE FROM players WHERE id = ?', [userId]);
      dbUtils.run('DELETE FROM accounts WHERE id = ?', [userId]);
    });
  }
}

export const authService = new AuthService();

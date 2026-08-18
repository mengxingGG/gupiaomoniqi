import { unwatchFile, watchFile, type Stats } from "node:fs";

export interface RootConfigWatcher {
  stop(): Promise<void>;
}

export interface StartRootConfigWatcherOptions {
  path: string;
  onChange: () => Promise<void> | void;
  onError?: (error: unknown) => void;
  intervalMs?: number;
  debounceMs?: number;
}

export function startRootConfigWatcher(
  options: StartRootConfigWatcherOptions,
): RootConfigWatcher {
  const intervalMs = Math.max(20, options.intervalMs ?? 500);
  const debounceMs = Math.max(10, options.debounceMs ?? 200);
  let stopped = false;
  let debounceTimer: NodeJS.Timeout | null = null;
  let reloadQueue = Promise.resolve();

  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // 配置错误的日志回调不能反过来终止文件监听。
    }
  };
  const enqueueReload = (): void => {
    reloadQueue = reloadQueue
      .then(async () => {
        if (!stopped) {
          await options.onChange();
        }
      })
      .catch(reportError);
  };
  const scheduleReload = (): void => {
    if (stopped) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      enqueueReload();
    }, debounceMs);
    debounceTimer.unref();
  };
  const listener = (current: Stats, previous: Stats): void => {
    if (statsSignature(current) !== statsSignature(previous)) {
      scheduleReload();
    }
  };

  // watchFile 可以安全观察尚不存在的目标；文件创建、原子替换和删除都会触发。
  watchFile(options.path, { persistent: false, interval: intervalMs }, listener);

  return {
    async stop(): Promise<void> {
      if (stopped) {
        await reloadQueue;
        return;
      }
      stopped = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      unwatchFile(options.path, listener);
      await reloadQueue;
    },
  };
}

function statsSignature(stats: Stats): string {
  return [
    stats.mtimeMs,
    stats.ctimeMs,
    stats.size,
    stats.ino,
    stats.nlink,
  ].join(":");
}

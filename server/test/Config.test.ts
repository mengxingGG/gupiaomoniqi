import { describe, expect, it } from "vitest";
import { recommendVirtualRuntimeProfile } from "../src/config.js";

describe("virtual runtime profile", () => {
  it("2核4G 机器会自动收敛 AI 负载", () => {
    const profile = recommendVirtualRuntimeProfile({
      cpuCount: 2,
      totalMemoryBytes: 4 * 1024 * 1024 * 1024,
    });

    expect(profile.aiTraderCount).toBeLessThan(3_000);
    expect(profile.aiActivePerRound).toBeLessThanOrEqual(64);
    expect(profile.aiRoundIntervalMs).toBeGreaterThanOrEqual(4_000);
  });
});

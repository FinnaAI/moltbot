import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GatewayReloadPlan } from "./config-reload.js";
import { createGatewayReloadHandlers } from "./server-reload-handlers.js";

vi.mock("../hooks/gmail-watcher.js", () => ({
  startGmailWatcher: vi.fn(),
  stopGmailWatcher: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../infra/outbound/target-resolver.js", () => ({
  resetDirectoryCache: vi.fn(),
}));
vi.mock("../infra/restart.js", () => ({
  authorizeGatewaySigusr1Restart: vi.fn(),
  setGatewaySigusr1RestartPolicy: vi.fn(),
}));
vi.mock("../process/command-queue.js", () => ({
  setCommandLaneConcurrency: vi.fn(),
}));
vi.mock("../config/agent-limits.js", () => ({
  resolveAgentMaxConcurrent: () => 1,
  resolveSubagentMaxConcurrent: () => 1,
}));
vi.mock("../process/lanes.js", () => ({
  CommandLane: { Cron: "cron", Main: "main", Subagent: "subagent" },
}));
vi.mock("./hooks.js", () => ({
  resolveHooksConfig: vi.fn(),
}));
vi.mock("./server-browser.js", () => ({
  startBrowserControlServerIfEnabled: vi.fn(),
}));
vi.mock("./server-cron.js", () => ({
  buildGatewayCronService: vi.fn(),
}));

function makePlan(overrides: Partial<GatewayReloadPlan> = {}): GatewayReloadPlan {
  return {
    restartGateway: true,
    restartReasons: ["gateway.mode changed"],
    changedPaths: ["gateway.mode"],
    reloadHooks: false,
    restartHeartbeat: false,
    restartCron: false,
    restartBrowserControl: false,
    restartGmailWatcher: false,
    restartChannels: new Set(),
    hotReasons: [],
    noopPaths: [],
    ...overrides,
  };
}

function makeConfig() {
  return { commands: { restart: true } } as ReturnType<
    typeof import("../config/config.js").loadConfig
  >;
}

const noop = vi.fn();
const noopLog = { info: noop, warn: noop, error: noop };

function makeHandlers(hasActiveWizard: () => boolean) {
  return createGatewayReloadHandlers({
    deps: {} as never,
    broadcast: noop,
    getState: () => ({
      hooksConfig: {} as never,
      heartbeatRunner: { updateConfig: noop } as never,
      cronState: {
        cron: { stop: noop, start: vi.fn().mockResolvedValue(undefined) },
        storePath: "",
      } as never,
      browserControl: null,
    }),
    setState: noop,
    startChannel: vi.fn().mockResolvedValue(undefined),
    stopChannel: vi.fn().mockResolvedValue(undefined),
    hasActiveWizard,
    logHooks: noopLog,
    logBrowser: noopLog,
    logChannels: noopLog,
    logCron: noopLog,
    logReload: noopLog,
  });
}

describe("wizard restart deferral", () => {
  let sigusr1Emitted: boolean;
  let sigusr1Listener: () => void;

  beforeEach(() => {
    sigusr1Emitted = false;
    sigusr1Listener = () => {
      sigusr1Emitted = true;
    };
    process.on("SIGUSR1", sigusr1Listener);
  });

  beforeEach(() => {
    return () => {
      process.removeListener("SIGUSR1", sigusr1Listener);
    };
  });

  it("should defer restart when wizard is active", () => {
    const { requestGatewayRestart } = makeHandlers(() => true);
    requestGatewayRestart(makePlan(), makeConfig());
    expect(sigusr1Emitted).toBe(false);
  });

  it("should fire restart when no wizard is active", () => {
    const { requestGatewayRestart } = makeHandlers(() => false);
    requestGatewayRestart(makePlan(), makeConfig());
    expect(sigusr1Emitted).toBe(true);
  });

  it("should flush deferred restart after wizard completes", () => {
    let wizardActive = true;
    const { requestGatewayRestart, flushDeferredRestart } = makeHandlers(() => wizardActive);

    requestGatewayRestart(makePlan(), makeConfig());
    expect(sigusr1Emitted).toBe(false);

    wizardActive = false;
    flushDeferredRestart();
    expect(sigusr1Emitted).toBe(true);
  });

  it("should be a no-op if flush is called with no deferred restart", () => {
    const { flushDeferredRestart } = makeHandlers(() => false);
    flushDeferredRestart();
    expect(sigusr1Emitted).toBe(false);
  });

  it("should keep latest plan when multiple restarts are deferred", () => {
    const { requestGatewayRestart, flushDeferredRestart } = makeHandlers(() => true);

    const plan1 = makePlan({ restartReasons: ["first change"] });
    const plan2 = makePlan({ restartReasons: ["second change"] });

    requestGatewayRestart(plan1, makeConfig());
    requestGatewayRestart(plan2, makeConfig());

    expect(sigusr1Emitted).toBe(false);
  });

  it("should only fire once after flush even if deferred twice", () => {
    let wizardActive = true;
    const { requestGatewayRestart, flushDeferredRestart } = makeHandlers(() => wizardActive);

    requestGatewayRestart(makePlan(), makeConfig());
    requestGatewayRestart(makePlan(), makeConfig());

    wizardActive = false;
    flushDeferredRestart();
    expect(sigusr1Emitted).toBe(true);

    sigusr1Emitted = false;
    flushDeferredRestart();
    expect(sigusr1Emitted).toBe(false);
  });
});

import fs from "node:fs";
import os from "node:os";

import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import { resolveStorePath } from "../../config/sessions.js";
import { resolveGatewayAuth } from "../auth.js";
import { formatError } from "../server-utils.js";
import type { GatewayRequestHandlers } from "./types.js";

type CheckStatus = "pass" | "warn" | "fail" | "skip";

interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message?: string;
  detail?: string;
}

function check(name: string, status: CheckStatus, message?: string, detail?: string): DoctorCheck {
  return { name, status, ...(message ? { message } : {}), ...(detail ? { detail } : {}) };
}

function existsDir(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function canWriteDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export const doctorHandlers: GatewayRequestHandlers = {
  "doctor.run": async ({ respond, context }) => {
    const checks: DoctorCheck[] = [];

    let cfg;
    try {
      cfg = loadConfig();
    } catch (err) {
      checks.push(check("config", "fail", "Failed to load config", String(err)));
      respond(true, { ok: false, checks });
      return;
    }

    // 1. Gateway mode
    const mode = cfg.gateway?.mode;
    if (!mode) {
      checks.push(check("gateway-mode", "fail", "gateway.mode is not set"));
    } else {
      checks.push(check("gateway-mode", "pass", `Mode: ${mode}`));
    }

    // 2. Auth / token presence
    try {
      const auth = resolveGatewayAuth({
        authConfig: cfg.gateway?.auth,
        tailscaleMode: cfg.gateway?.tailscale?.mode ?? "off",
      });
      const hasSecret =
        (auth.mode === "token" && !!auth.token?.trim()) ||
        (auth.mode === "password" && !!auth.password?.trim());
      if (hasSecret) {
        checks.push(check("gateway-auth", "pass", `Auth mode: ${auth.mode}`));
      } else {
        checks.push(
          check("gateway-auth", "warn", `Auth mode "${auth.mode}" has no credential configured`),
        );
      }
    } catch (err) {
      checks.push(check("gateway-auth", "fail", "Failed to resolve auth", String(err)));
    }

    // 3. State directory integrity
    const stateDir = resolveStateDir(process.env, os.homedir);
    if (!existsDir(stateDir)) {
      checks.push(check("state-dir", "fail", `State directory missing: ${stateDir}`));
    } else if (!canWriteDir(stateDir)) {
      checks.push(check("state-dir", "warn", `State directory not writable: ${stateDir}`));
    } else {
      checks.push(check("state-dir", "pass", stateDir));
    }

    // 4. Config file permissions (unix only)
    if (process.platform !== "win32") {
      try {
        const stat = fs.statSync(stateDir);
        if ((stat.mode & 0o077) !== 0) {
          checks.push(
            check(
              "state-permissions",
              "warn",
              "State directory permissions too open (recommend 700)",
            ),
          );
        } else {
          checks.push(check("state-permissions", "pass", "Permissions OK"));
        }
      } catch {
        checks.push(check("state-permissions", "skip", "Could not check permissions"));
      }
    } else {
      checks.push(check("state-permissions", "skip", "Skipped on Windows"));
    }

    // 5. Session store
    const agentId = resolveDefaultAgentId(cfg);
    const storePath = resolveStorePath(cfg.session?.store, { agentId });
    const storeDir = fs.existsSync(storePath) ? "exists" : "missing";
    if (storeDir === "exists") {
      checks.push(check("session-store", "pass", storePath));
    } else {
      checks.push(check("session-store", "warn", `Session store not found: ${storePath}`));
    }

    // 6. Channel health (reuse the gateway's health cache/refresh)
    try {
      const snap = await context.refreshHealthSnapshot({ probe: false });
      const channelCount = snap.channelOrder?.length ?? 0;
      const configuredChannels = snap.channelOrder?.filter((id) => {
        const ch = snap.channels[id] as { configured?: boolean } | undefined;
        return ch?.configured === true;
      });
      checks.push(
        check(
          "channels",
          "pass",
          `${configuredChannels?.length ?? 0}/${channelCount} channels configured`,
        ),
      );
    } catch (err) {
      checks.push(check("channels", "fail", "Health snapshot failed", formatError(err)));
    }

    // 7. Hooks config
    const hooks = cfg.hooks;
    if (hooks && typeof hooks === "object" && Object.keys(hooks).length > 0) {
      const hookKeys = Object.keys(hooks);
      checks.push(check("hooks", "pass", `${hookKeys.length} hook(s): ${hookKeys.join(", ")}`));
    } else {
      checks.push(check("hooks", "skip", "No hooks configured"));
    }

    // 8. Workspace / disk
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    if (existsDir(workspaceDir)) {
      if (canWriteDir(workspaceDir)) {
        checks.push(check("workspace", "pass", workspaceDir));
      } else {
        checks.push(check("workspace", "warn", `Workspace not writable: ${workspaceDir}`));
      }
    } else {
      checks.push(check("workspace", "warn", `Workspace directory missing: ${workspaceDir}`));
    }

    // 9. Memory plugin
    const memoryEnabled = cfg.plugins?.entries?.memory?.enabled;
    if (memoryEnabled === true) {
      checks.push(check("memory-plugin", "pass", "Enabled"));
    } else if (memoryEnabled === false) {
      checks.push(check("memory-plugin", "skip", "Disabled"));
    } else {
      checks.push(check("memory-plugin", "skip", "Not configured"));
    }

    const ok = checks.every((c) => c.status !== "fail");
    respond(true, { ok, checks });
  },
};

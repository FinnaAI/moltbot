import crypto from "node:crypto";
import { spawn, type IPty } from "@lydell/node-pty";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

interface TerminalSession {
  id: string;
  pty: IPty;
  idleTimer: ReturnType<typeof setTimeout>;
}

let activeSession: TerminalSession | null = null;

function resetIdleTimer(session: TerminalSession, context: GatewayRequestContext) {
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    destroySession(session, context);
  }, IDLE_TIMEOUT_MS);
}

function destroySession(session: TerminalSession, context: GatewayRequestContext) {
  clearTimeout(session.idleTimer);
  try {
    session.pty.kill();
  } catch {
    // already dead
  }
  if (activeSession?.id === session.id) {
    activeSession = null;
  }
  context.broadcast("terminal.closed", { sessionId: session.id }, { dropIfSlow: true });
}

export const terminalHandlers: GatewayRequestHandlers = {
  "terminal.open": ({ params, respond, context }) => {
    if (activeSession) {
      destroySession(activeSession, context);
    }

    const cols = typeof (params as { cols?: unknown }).cols === "number"
      ? Math.max(1, Math.floor((params as { cols: number }).cols))
      : 80;
    const rows = typeof (params as { rows?: unknown }).rows === "number"
      ? Math.max(1, Math.floor((params as { rows: number }).rows))
      : 24;

    const sessionId = crypto.randomUUID();
    let pty: IPty;
    try {
      pty = spawn("/bin/bash", [], {
        name: "xterm-256color",
        cols,
        rows,
        env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, `failed to spawn PTY: ${err}`));
      return;
    }

    const session: TerminalSession = {
      id: sessionId,
      pty,
      idleTimer: setTimeout(() => {}, 0),
    };
    activeSession = session;
    resetIdleTimer(session, context);

    pty.onData((data) => {
      context.broadcast(
        "terminal.output",
        { sessionId: session.id, data },
        { dropIfSlow: true },
      );
    });

    pty.onExit(() => {
      if (activeSession?.id === session.id) {
        clearTimeout(session.idleTimer);
        activeSession = null;
        context.broadcast("terminal.closed", { sessionId: session.id }, { dropIfSlow: true });
      }
    });

    respond(true, { sessionId, cols, rows });
  },

  "terminal.input": ({ params, respond, context }) => {
    const { sessionId, data } = params as { sessionId?: string; data?: string };
    if (!sessionId || typeof data !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sessionId and data required"));
      return;
    }
    if (!activeSession || activeSession.id !== sessionId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no active terminal session"));
      return;
    }
    activeSession.pty.write(data);
    resetIdleTimer(activeSession, context);
    respond(true);
  },

  "terminal.resize": ({ params, respond, context }) => {
    const { sessionId, cols, rows } = params as { sessionId?: string; cols?: number; rows?: number };
    if (!sessionId || typeof cols !== "number" || typeof rows !== "number") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sessionId, cols, and rows required"));
      return;
    }
    if (!activeSession || activeSession.id !== sessionId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no active terminal session"));
      return;
    }
    activeSession.pty.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
    resetIdleTimer(activeSession, context);
    respond(true);
  },

  "terminal.close": ({ params, respond, context }) => {
    const { sessionId } = params as { sessionId?: string };
    if (!sessionId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sessionId required"));
      return;
    }
    if (!activeSession || activeSession.id !== sessionId) {
      respond(true);
      return;
    }
    destroySession(activeSession, context);
    respond(true);
  },
};

export function cleanupTerminalSessions() {
  if (activeSession) {
    clearTimeout(activeSession.idleTimer);
    try {
      activeSession.pty.kill();
    } catch {
      // already dead
    }
    activeSession = null;
  }
}

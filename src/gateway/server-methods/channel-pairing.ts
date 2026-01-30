import { normalizeChannelId } from "../../channels/plugins/index.js";
import { listPairingChannels, notifyPairingApproved } from "../../channels/plugins/pairing.js";
import { loadConfig } from "../../config/config.js";
import {
  approveChannelPairingCode,
  listChannelPairingRequests,
  type PairingChannel,
} from "../../pairing/pairing-store.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const channelPairingHandlers: GatewayRequestHandlers = {
  "channel.pairing.list": async ({ params, respond }) => {
    const rawChannel = (params as { channel?: unknown }).channel;
    const channelId =
      typeof rawChannel === "string" ? normalizeChannelId(rawChannel) : null;
    if (!channelId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "channel required"),
      );
      return;
    }
    const channels = listPairingChannels();
    if (!channels.includes(channelId)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `channel ${channelId} does not support pairing`,
        ),
      );
      return;
    }
    const requests = await listChannelPairingRequests(
      channelId as PairingChannel,
    );
    respond(true, { channel: channelId, requests });
  },

  "channel.pairing.approve": async ({ params, respond }) => {
    const rawChannel = (params as { channel?: unknown }).channel;
    const rawCode = (params as { code?: unknown }).code;
    const notify = (params as { notify?: unknown }).notify === true;

    const channelId =
      typeof rawChannel === "string" ? normalizeChannelId(rawChannel) : null;
    if (!channelId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "channel required"),
      );
      return;
    }
    const code = typeof rawCode === "string" ? rawCode.trim() : "";
    if (!code) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "code required"),
      );
      return;
    }

    const result = await approveChannelPairingCode({
      channel: channelId as PairingChannel,
      code,
    });
    if (!result) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `no pending pairing request for code: ${code}`,
        ),
      );
      return;
    }

    if (notify) {
      const cfg = loadConfig();
      await notifyPairingApproved({
        channelId,
        id: result.id,
        cfg,
      }).catch(() => {});
    }

    respond(true, {
      channel: channelId,
      approved: true,
      id: result.id,
    });
  },
};

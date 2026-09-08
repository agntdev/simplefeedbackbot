import { describe, expect, it } from "vitest";
import type { Ctx } from "../src/bot.js";
import { acknowledgeBroadcast, broadcastAcks, recordBroadcast, saveUser } from "../src/feedback/store.js";

function context(id: number, username: string): Ctx {
  return {
    from: { id, is_bot: false, first_name: username, username },
    session: {},
  } as unknown as Ctx;
}

describe("broadcast acknowledgements", () => {
  it("keeps one acknowledgement per selected recipient", async () => {
    const ctx = context(9, "alex");
    await saveUser(ctx);
    const broadcast = await recordBroadcast(ctx, {
      initiator_id: 9,
      timestamp: 100,
      recipients_count: 1,
      delivered_count: 1,
      recipient_ids: [9],
      status: "sent",
      text: "Service update",
      attachments: [],
      buttons: [],
    });

    expect(await acknowledgeBroadcast(ctx, broadcast.id)).toBe("saved");
    expect(await acknowledgeBroadcast(ctx, broadcast.id)).toBe("duplicate");
    expect(await broadcastAcks(ctx, broadcast.id)).toEqual([
      { broadcast_id: broadcast.id, user_id: 9, username: "alex", timestamp: expect.any(Number) },
    ]);
  });
});

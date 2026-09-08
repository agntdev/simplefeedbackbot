import { afterEach, describe, expect, it } from "vitest";
import type { Ctx } from "../src/bot.js";
import { addThreadEntry, exportItems, markThreadStatus, setClockForTests, submit } from "../src/feedback/store.js";

function context(): Ctx {
  return { from: { id: 11, is_bot: false, first_name: "Morgan" }, session: {} } as unknown as Ctx;
}

describe("feedback conversation records", () => {
  afterEach(() => setClockForTests());

  it("keeps acknowledgements and admin replies with their delivery status in exports", async () => {
    const ctx = context();
    setClockForTests(() => 2_000);
    const feedback = await submit(ctx, { text: "A note", attachments: [] });
    const acknowledgement = await addThreadEntry(ctx, feedback!.id, { type: "ack", timestamp: 2_000, sent_status: "pending", body_text: "Receipt", attachments: [] });
    const reply = await addThreadEntry(ctx, feedback!.id, { type: "admin_reply", timestamp: 2_001, sent_status: "pending", admin_id: 99, admin_display_name: "Alex", body_text: "Thank you", attachments: [] });
    await markThreadStatus(ctx, feedback!.id, acknowledgement!.id, "sent");
    await markThreadStatus(ctx, feedback!.id, reply!.id, "failed");

    expect((await exportItems(ctx))[0].thread).toMatchObject([
      { type: "ack", sent_status: "sent" },
      { type: "admin_reply", admin_id: 99, body_text: "Thank you", sent_status: "failed" },
    ]);
  });
});

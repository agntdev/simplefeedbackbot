import { afterEach, describe, expect, it } from "vitest";
import type { Ctx } from "../src/bot.js";
import { RETENTION_MS, exportItems, setClockForTests, softDelete, submit } from "../src/feedback/store.js";

function context(): Ctx {
  return {
    from: { id: 7, is_bot: false, first_name: "Avery" },
    session: {},
  } as unknown as Ctx;
}

describe("feedback retention", () => {
  afterEach(() => setClockForTests());

  it("keeps a soft-deleted item for 30 days and then purges it", async () => {
    const ctx = context();
    setClockForTests(() => 1_000);
    const item = await submit(ctx, { text: "Keep this briefly", attachments: [] });
    expect(item?.id).toBe(1);
    expect(await softDelete(ctx, 1)).toBe(true);

    setClockForTests(() => 1_000 + RETENTION_MS - 1);
    expect(await exportItems(ctx)).toHaveLength(1);

    setClockForTests(() => 1_000 + RETENTION_MS);
    expect(await exportItems(ctx)).toHaveLength(0);
  });
});

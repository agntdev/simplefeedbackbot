import { afterEach, describe, expect, it } from "vitest";
import { buildBot } from "../src/bot.js";
import { parseBotSpec, runSpec } from "../src/toolkit/index.js";

describe("administrator main menu", () => {
  const previousAdminId = process.env.ADMIN_CHAT_ID;

  afterEach(() => {
    if (previousAdminId === undefined) delete process.env.ADMIN_CHAT_ID;
    else process.env.ADMIN_CHAT_ID = previousAdminId;
  });

  it("shows Broadcast on the Russian main menu for the injected owner", async () => {
    process.env.ADMIN_CHAT_ID = "1";
    const result = await runSpec(await buildBot("test-token"), parseBotSpec({
      name: "owner sees broadcast",
      steps: [
        { send: { text: "/start" }, expect: [{ method: "sendMessage" }] },
        { send: { callback: "lang:ru" }, expect: [{ method: "editMessageText" }] },
      ],
    }));

    expect(result.ok).toBe(true);
    const menu = result.steps[1].captured.find((call) => call.method === "editMessageText");
    const keyboard = menu?.payload.reply_markup as { inline_keyboard?: Array<Array<{ text?: string; callback_data?: string }>> };
    expect(keyboard.inline_keyboard?.flat()).toContainEqual({ text: "Рассылка", callback_data: "admin:broadcast" });
  });
});

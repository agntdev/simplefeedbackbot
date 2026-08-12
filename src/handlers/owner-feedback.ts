import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, isOwner, registerMainMenuItem, requireOwner } from "../toolkit/index.js";
import { exportItems, purgeDeleted } from "../feedback/store.js";

registerMainMenuItem({ label: "Export feedback", data: "fb:export", order: 90 });
const composer = new Composer<Ctx>();

function csvCell(value: string | number | undefined): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(items: Awaited<ReturnType<typeof exportItems>>): string {
  const header = ["reference_id", "user_id", "username", "submitted_at", "text", "attachments", "status", "last_edited", "deleted_at"];
  const rows = items.map((item) => [item.id, item.user_id, item.username, new Date(item.timestamp).toISOString(), item.text, item.attachments.map((a) => a.kind).join("; "), item.status, item.last_edited ? new Date(item.last_edited).toISOString() : "", item.deleted_at ? new Date(item.deleted_at).toISOString() : ""].map(csvCell).join(","));
  return [header.join(","), ...rows].join("\n");
}

composer.callbackQuery("fb:export", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isOwner(ctx)) { await requireOwner(ctx); return; }
  const items = await exportItems(ctx);
  await ctx.replyWithDocument(new InputFile(new TextEncoder().encode(toCsv(items)), "feedback-export.csv"), { caption: items.length ? "Your feedback export is ready." : "There is no feedback to export yet." });
  await ctx.editMessageText("Export created.", { reply_markup: inlineKeyboard([[inlineButton("Purge expired feedback", "fb:purge"), inlineButton("Back to menu", "menu:main")]]) });
});

composer.callbackQuery("fb:purge", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isOwner(ctx)) { await requireOwner(ctx); return; }
  const removed = await purgeDeleted(ctx);
  await ctx.editMessageText(removed === 0 ? "No expired deleted feedback to remove." : `Removed ${removed} expired feedback item${removed === 1 ? "" : "s"}.`, { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) });
});

export default composer;

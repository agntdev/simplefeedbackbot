import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { addThreadEntry, editingFeedbackId, markThreadStatus, messageContent, now, replyingFeedbackId, saveUser, setEditingFeedbackId, submit, update } from "../feedback/store.js";

registerMainMenuItem({ label: "Submit feedback", data: "fb:submit", order: 10 });
const composer = new Composer<Ctx>();
const prompt = "Send your feedback as text, a photo, a voice message, or a file.";

function receiptText(id: number, attachmentKinds: string[]): string {
  const date = new Date(now()).toLocaleString("ru-RU", { timeZone: "UTC" });
  const subject = attachmentKinds.length ? `сообщение с ${attachmentKinds.join(", ")} получено` : "ваш отзыв получен";
  return `Спасибо — ${subject} (ID: ${id}) ${date}.`;
}

composer.command("send", async (ctx) => { await saveUser(ctx); await ctx.reply(prompt); });
composer.callbackQuery("fb:submit", async (ctx) => {
  await ctx.answerCallbackQuery(); await saveUser(ctx);
  await ctx.editMessageText(prompt, { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) });
});
composer.on("message", async (ctx, next) => {
  const content = messageContent(ctx);
  if (!content || (ctx.message?.text?.startsWith("/") ?? false)) return next();
  await saveUser(ctx);
  const editingId = editingFeedbackId(ctx);
  if (replyingFeedbackId(ctx) !== undefined) return next();
  if (editingId !== undefined) {
    const item = await update(ctx, editingId, content);
    setEditingFeedbackId(ctx, undefined);
    await ctx.reply(item ? `Feedback #${item.id} has been updated.` : "That feedback item is no longer available.");
    return;
  }
  const item = await submit(ctx, content);
  if (!item) { await ctx.reply("Couldn't save your feedback. Please try again."); return; }
  const text = receiptText(item.id, content.attachments.map((attachment) => attachment.kind));
  const ack = await addThreadEntry(ctx, item.id, { type: "ack", timestamp: now(), sent_status: "pending", body_text: text, attachments: [] });
  try {
    await ctx.reply(text);
    if (ack) await markThreadStatus(ctx, item.id, ack.id, "sent");
  } catch {
    if (ack) await markThreadStatus(ctx, item.id, ack.id, "failed");
  }
});

export default composer;

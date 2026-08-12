import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { editingFeedbackId, messageContent, saveUser, setEditingFeedbackId, submit, update } from "../feedback/store.js";

registerMainMenuItem({ label: "Submit feedback", data: "fb:submit", order: 10 });
const composer = new Composer<Ctx>();
const prompt = "Send your feedback as text, a photo, a voice message, or a file.";

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
  if (editingId !== undefined) {
    const item = await update(ctx, editingId, content);
    setEditingFeedbackId(ctx, undefined);
    await ctx.reply(item ? `Feedback #${item.id} has been updated.` : "That feedback item is no longer available.");
    return;
  }
  const item = await submit(ctx, content);
  await ctx.reply(item ? `Feedback received. Your reference is #${item.id}.` : "Couldn't save your feedback. Please try again.");
});

export default composer;

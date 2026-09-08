import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { addThreadEntry, editingFeedbackId, markThreadStatus, messageContent, now, replyingFeedbackId, saveUser, setEditingFeedbackId, submit, update } from "../feedback/store.js";
import { tr } from "../i18n.js";

registerMainMenuItem({ label: "Ask a question", data: "fb:submit", order: 10 });
const composer = new Composer<Ctx>();
async function submitKeyboard(ctx: Ctx) { return inlineKeyboard([[inlineButton(await tr(ctx, "photo"), "fb:type:photo"), inlineButton(await tr(ctx, "video"), "fb:type:video"), inlineButton(await tr(ctx, "text"), "fb:type:text")], [inlineButton(await tr(ctx, "backMenu"), "menu:main")]]); }

async function receiptText(ctx: Ctx, id: number): Promise<string> {
  return tr(ctx, "receipt", { id });
}

composer.command("send", async (ctx) => { await saveUser(ctx); await ctx.reply(await tr(ctx, "prompt"), { reply_markup: await submitKeyboard(ctx) }); });
composer.callbackQuery("fb:submit", async (ctx) => {
  await ctx.answerCallbackQuery(); await saveUser(ctx);
  await ctx.editMessageText(await tr(ctx, "prompt"), { reply_markup: await submitKeyboard(ctx) });
});
composer.callbackQuery(/^fb:type:(photo|video|text)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const type = ctx.match[1] as "photo" | "video" | "text";
  ctx.session.feedbackType = type;
  const instruction = await tr(ctx, type === "photo" ? "sendPhoto" : type === "video" ? "sendVideo" : "sendText");
  await ctx.editMessageText(instruction, { reply_markup: inlineKeyboard([[inlineButton(await tr(ctx, "cancel"), "fb:type:cancel")]]) });
});
composer.callbackQuery("fb:type:cancel", async (ctx) => {
  await ctx.answerCallbackQuery(); ctx.session.feedbackType = undefined;
  await ctx.editMessageText(await tr(ctx, "cancelled"), { reply_markup: inlineKeyboard([[inlineButton(await tr(ctx, "submit"), "fb:submit")]]) });
});
composer.on("message", async (ctx, next) => {
  const content = messageContent(ctx);
  if (!content || (ctx.message?.text?.startsWith("/") ?? false)) return next();
  const selected = ctx.session.feedbackType;
  if (selected === "text" && !content.text.trim()) { await ctx.reply(await tr(ctx, "sendText")); return; }
  if (selected === "photo" && !content.attachments.some((attachment) => attachment.kind === "photo")) { await ctx.reply(await tr(ctx, "sendPhoto")); return; }
  if (selected === "video" && !content.attachments.some((attachment) => attachment.kind === "video")) { await ctx.reply(await tr(ctx, "sendVideo")); return; }
  await saveUser(ctx);
  const editingId = editingFeedbackId(ctx);
  if (replyingFeedbackId(ctx) !== undefined) return next();
  if (editingId !== undefined) {
    const item = await update(ctx, editingId, content);
    setEditingFeedbackId(ctx, undefined);
    await ctx.reply(item ? await tr(ctx, "updated", { id: item.id }) : await tr(ctx, "unavailable"));
    return;
  }
  const item = await submit(ctx, content);
  if (!item) { await ctx.reply((await tr(ctx, "cancelled")) === "Отправка отменена." ? "Не удалось сохранить вопрос. Попробуйте ещё раз." : "Couldn't save your question. Please try again."); return; }
  const text = await receiptText(ctx, item.id);
  const automaticReply = "Принято в обработку, с вами свяжутся в течение ближайшего времени";
  const ack = await addThreadEntry(ctx, item.id, { type: "ack", timestamp: now(), sent_status: "pending", body_text: automaticReply, attachments: [] });
  ctx.session.feedbackType = undefined;
  try {
    await ctx.reply(text);
    await ctx.reply(automaticReply);
    if (ack) await markThreadStatus(ctx, item.id, ack.id, "sent");
  } catch {
    if (ack) await markThreadStatus(ctx, item.id, ack.id, "failed");
  }
  const owner = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
  if (owner) {
    try { await ctx.api.sendMessage(owner, `New question #${item.id} is ready for review.`); } catch { /* The owner may have blocked the bot; the saved item remains in the desk. */ }
  }
});

export default composer;

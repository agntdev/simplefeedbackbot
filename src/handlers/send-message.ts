import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { addThreadEntry, editingFeedbackId, markThreadStatus, messageContent, now, replyingFeedbackId, saveUser, setEditingFeedbackId, submit, update } from "../feedback/store.js";

registerMainMenuItem({ label: "Submit feedback", data: "fb:submit", order: 10 });
const composer = new Composer<Ctx>();
const prompt = "Choose a format, or send text, a photo, video, voice message, or file.";
const submitKeyboard = inlineKeyboard([
  [inlineButton("Фото", "fb:type:photo"), inlineButton("Видео", "fb:type:video"), inlineButton("Текст", "fb:type:text")],
  [inlineButton("Back to menu", "menu:main")],
]);

function receiptText(id: number, attachmentKinds: string[]): string {
  const date = new Date(now()).toLocaleString("ru-RU", { timeZone: "UTC" });
  const subject = attachmentKinds.length ? `сообщение с ${attachmentKinds.join(", ")} получено` : "ваш отзыв получен";
  return `Спасибо — ${subject} (ID: ${id}) ${date}.`;
}

composer.command("send", async (ctx) => { await saveUser(ctx); await ctx.reply(prompt, { reply_markup: submitKeyboard }); });
composer.callbackQuery("fb:submit", async (ctx) => {
  await ctx.answerCallbackQuery(); await saveUser(ctx);
  await ctx.editMessageText(prompt, { reply_markup: submitKeyboard });
});
composer.callbackQuery(/^fb:type:(photo|video|text)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const type = ctx.match[1] as "photo" | "video" | "text";
  ctx.session.feedbackType = type;
  const instruction = type === "photo" ? "Send the photo you want to submit." : type === "video" ? "Send the video you want to submit." : "Type the feedback you want to submit.";
  await ctx.editMessageText(instruction, { reply_markup: inlineKeyboard([[inlineButton("Cancel", "fb:type:cancel")]]) });
});
composer.callbackQuery("fb:type:cancel", async (ctx) => {
  await ctx.answerCallbackQuery(); ctx.session.feedbackType = undefined;
  await ctx.editMessageText("Submission cancelled.", { reply_markup: inlineKeyboard([[inlineButton("Submit feedback", "fb:submit")]]) });
});
composer.on("message", async (ctx, next) => {
  const content = messageContent(ctx);
  if (!content || (ctx.message?.text?.startsWith("/") ?? false)) return next();
  const selected = ctx.session.feedbackType;
  if (selected === "text" && !content.text.trim()) { await ctx.reply("Send text for this feedback."); return; }
  if (selected === "photo" && !content.attachments.some((attachment) => attachment.kind === "photo")) { await ctx.reply("Send a photo for this feedback."); return; }
  if (selected === "video" && !content.attachments.some((attachment) => attachment.kind === "video")) { await ctx.reply("Send a video for this feedback."); return; }
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
  ctx.session.feedbackType = undefined;
  try {
    await ctx.reply(text);
    if (ack) await markThreadStatus(ctx, item.id, ack.id, "sent");
  } catch {
    if (ack) await markThreadStatus(ctx, item.id, ack.id, "failed");
  }
});

export default composer;

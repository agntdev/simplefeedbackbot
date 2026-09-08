import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { isAdmin, requireAdmin } from "../feedback/admin.js";
import { adminDetailView } from "../feedback/presentation.js";
import { addThreadEntry, allItems, anyItem, exportItems, markThreadStatus, messageContent, now, purgeDeleted, replyingFeedbackId, setReplyingFeedbackId, type Attachment, type FeedbackItem, type FeedbackThreadEntry } from "../feedback/store.js";

const composer = new Composer<Ctx>();

function csvCell(value: string | number | undefined): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(items: FeedbackItem[]): string {
  const header = ["reference_id", "user_id", "username", "username_url", "submitted_at", "text", "attachments", "status", "last_edited", "deleted_at", "thread"];
  const rows = items.map((item) => [item.id, item.user_id, item.username, item.username ? `https://t.me/${item.username}` : `tg://user?id=${item.user_id}`, new Date(item.timestamp).toISOString(), item.text, item.attachments.map((a) => a.kind).join("; "), item.status, item.last_edited ? new Date(item.last_edited).toISOString() : "", item.deleted_at ? new Date(item.deleted_at).toISOString() : "", JSON.stringify(item.thread ?? [])].map(csvCell).join(","));
  return [header.join(","), ...rows].join("\n");
}

async function showAdminList(ctx: Ctx, page: number): Promise<void> {
  const items = await allItems(ctx);
  const perPage = 5;
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Math.max(0, page), pages - 1);
  if (!items.length) {
    await ctx.editMessageText("No feedback has been submitted yet.", { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) });
    return;
  }
  const rows = items.slice(current * perPage, (current + 1) * perPage).map((item) => [inlineButton(`Feedback #${item.id}`, `fb:admin:view:${item.id}`)]);
  const nav = [] as ReturnType<typeof inlineButton>[];
  if (current > 0) nav.push(inlineButton("Previous", `fb:admin:${current - 1}`));
  if (current < pages - 1) nav.push(inlineButton("Next", `fb:admin:${current + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([inlineButton("Back to menu", "menu:main")]);
  await ctx.editMessageText(`Feedback for review (${current + 1}/${pages})`, { reply_markup: inlineKeyboard(rows) });
}

function adminName(ctx: Ctx): string {
  return [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "Administrator";
}

async function deliverAttachment(ctx: Ctx, chatId: number, attachment: Attachment): Promise<void> {
  if (!attachment.fileId) throw new Error("Attachment is unavailable.");
  if (attachment.kind === "photo") await ctx.api.sendPhoto(chatId, attachment.fileId);
  else if (attachment.kind === "voice") await ctx.api.sendVoice(chatId, attachment.fileId);
  else await ctx.api.sendDocument(chatId, attachment.fileId);
}

async function deliverReply(ctx: Ctx, item: FeedbackItem, entry: FeedbackThreadEntry): Promise<boolean> {
  const intro = `Reply from admin ${entry.admin_display_name ?? ""}:`.trim();
  try {
    await ctx.api.sendMessage(item.user_id, entry.body_text ? `${intro}\n${entry.body_text}` : intro);
    for (const attachment of entry.attachments) await deliverAttachment(ctx, item.user_id, attachment);
    await markThreadStatus(ctx, item.id, entry.id, "sent");
    return true;
  } catch {
    await markThreadStatus(ctx, item.id, entry.id, "failed");
    return false;
  }
}

composer.callbackQuery(/^fb:admin:(\d+)$/, async (ctx) => {
  if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; }
  await ctx.answerCallbackQuery();
  await showAdminList(ctx, Number(ctx.match[1]));
});

composer.callbackQuery(/^fb:admin:view:(\d+)$/, async (ctx) => {
  if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; }
  await ctx.answerCallbackQuery();
  const item = await anyItem(ctx, Number(ctx.match[1]));
  if (!item) { await ctx.editMessageText("That feedback item isn't available."); return; }
  const view = adminDetailView(item);
  await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
});

composer.callbackQuery(/^fb:reply:(\d+)$/, async (ctx) => {
  if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; }
  await ctx.answerCallbackQuery();
  const item = await anyItem(ctx, Number(ctx.match[1]));
  if (!item || item.status !== "active") { await ctx.editMessageText("That feedback item isn't available."); return; }
  setReplyingFeedbackId(ctx, item.id);
  await ctx.editMessageText(`Send your reply for feedback #${item.id}. You can include text, a photo, a voice message, or a file.`, { reply_markup: inlineKeyboard([[inlineButton("Cancel reply", "fb:replycancel")]]) });
});

composer.callbackQuery("fb:replycancel", async (ctx) => {
  if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; }
  await ctx.answerCallbackQuery();
  setReplyingFeedbackId(ctx, undefined);
  await ctx.editMessageText("Reply cancelled.");
});

composer.on("message", async (ctx, next) => {
  const feedbackId = replyingFeedbackId(ctx);
  if (feedbackId === undefined) return next();
  if (!(await isAdmin(ctx))) { setReplyingFeedbackId(ctx, undefined); await ctx.reply("Only an admin can send replies."); return; }
  const content = messageContent(ctx);
  if (!content || (ctx.message?.text?.startsWith("/") ?? false)) return next();
  const item = await anyItem(ctx, feedbackId);
  setReplyingFeedbackId(ctx, undefined);
  if (!item || item.status !== "active") { await ctx.reply("That feedback item isn't available."); return; }
  const entry = await addThreadEntry(ctx, item.id, { type: "admin_reply", timestamp: now(), sent_status: "pending", admin_id: ctx.from?.id, admin_display_name: adminName(ctx), body_text: content.text, attachments: content.attachments });
  if (!entry) { await ctx.reply("Couldn't save that reply. Please try again."); return; }
  await ctx.reply(await deliverReply(ctx, item, entry) ? "Your reply was sent." : "The reply was saved, but it couldn't be delivered. Tap Retry delivery in the feedback details.");
});

composer.callbackQuery(/^fb:retry:(\d+):(\d+)$/, async (ctx) => {
  if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; }
  await ctx.answerCallbackQuery();
  const item = await anyItem(ctx, Number(ctx.match[1]));
  const entry = item?.thread?.find((candidate) => candidate.id === Number(ctx.match[2]) && candidate.type === "admin_reply");
  if (!item || !entry || entry.sent_status !== "failed") { await ctx.editMessageText("That reply isn't available to retry."); return; }
  await ctx.editMessageText(await deliverReply(ctx, item, entry) ? "The reply was delivered." : "It still couldn't be delivered. You can try again later.", { reply_markup: adminDetailView(item).keyboard });
});

composer.callbackQuery("fb:export", async (ctx) => {
  if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; }
  await ctx.answerCallbackQuery();
  const items = await exportItems(ctx);
  await ctx.replyWithDocument(new InputFile(new TextEncoder().encode(toCsv(items)), "feedback-export.csv"), { caption: items.length ? "Your feedback export is ready." : "There is no feedback to export yet." });
  await ctx.editMessageText("Export created.", { reply_markup: inlineKeyboard([[inlineButton("Manage feedback", "fb:admin:0"), inlineButton("Purge expired feedback", "fb:purge")], [inlineButton("Back to menu", "menu:main")]]) });
});

composer.callbackQuery("fb:purge", async (ctx) => {
  if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; }
  await ctx.answerCallbackQuery();
  const removed = await purgeDeleted(ctx);
  await ctx.editMessageText(removed === 0 ? "No expired deleted feedback to remove." : `Removed ${removed} expired feedback item${removed === 1 ? "" : "s"}.`, { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) });
});

export default composer;

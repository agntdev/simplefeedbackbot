import type { FeedbackItem, FeedbackThreadEntry } from "./store.js";
import { inlineButton, inlineKeyboard, paginate, type InlineButton, type InlineKeyboardMarkup } from "../toolkit/index.js";
import { trFor } from "../i18n.js";
import type { Language } from "./store.js";

function preview(item: FeedbackItem): string {
  const body = item.text.trim() || (item.attachments.length ? `${item.attachments.map((a) => a.kind).join(", ")} attachment` : "No text");
  return body.length > 54 ? `${body.slice(0, 51)}…` : body;
}

export function listView(items: FeedbackItem[], page: number, lang: Language): { text: string; keyboard: InlineKeyboardMarkup } {
  if (items.length === 0) return { text: trFor(lang, "noFeedback"), keyboard: inlineKeyboard([[inlineButton(trFor(lang, "backMenu"), "menu:main")]]) };
  const result = paginate(items, { page, perPage: 5, callbackPrefix: "fbpage", prevLabel: lang === "ru" ? "Назад" : "Previous", nextLabel: lang === "ru" ? "Далее" : "Next" });
  const rows: InlineButton[][] = result.pageItems.map((item) => [inlineButton(`#${item.id} ${preview(item)}`, `fb:view:${item.id}`)]);
  rows.push(...result.controls.inline_keyboard);
  rows.push([inlineButton(trFor(lang, "backMenu"), "menu:main")]);
  return { text: trFor(lang, "yourFeedback", { page: result.page + 1, pages: result.totalPages }), keyboard: inlineKeyboard(rows) };
}

function threadText(entries: FeedbackThreadEntry[] | undefined, includeAcknowledgements = true): string {
  const visible = (entries ?? []).filter((entry) => includeAcknowledgements || entry.type !== "ack");
  if (!visible.length) return "";
  return "\n\nConversation\n" + visible.map((entry) => {
    const who = entry.type === "ack" ? "Receipt confirmation" : entry.type === "recipient_ack" ? "Recipient acknowledgement" : `Administrator ${entry.admin_display_name ?? ""}`.trim();
    const body = entry.body_text || (entry.attachments.length ? `Attachment: ${entry.attachments.map((a) => a.kind).join(", ")}` : "");
    return `${who}: ${body}${entry.sent_status === "failed" ? " (not delivered)" : ""}`;
  }).join("\n");
}

export function detailView(item: FeedbackItem, lang: Language): { text: string; keyboard: InlineKeyboardMarkup } {
  const content = item.text.trim() || trFor(lang, "attachmentOnly");
  const attachment = item.attachments.length ? `\n${trFor(lang, "attachments")}: ${item.attachments.map((a) => a.kind).join(", ")}` : "";
  const edited = item.last_edited ? `\n${trFor(lang, "updatedLabel")}` : "";
  const heading = lang === "ru" ? "Вопрос" : "Question";
  return { text: `${heading} #${item.id}\n\n${content}${attachment}${edited}${threadText(item.thread, false)}`, keyboard: inlineKeyboard([
    [inlineButton(trFor(lang, "edit"), `fb:edit:${item.id}`), inlineButton(trFor(lang, "delete"), `fb:delete:${item.id}`)],
    [inlineButton(trFor(lang, "backFeedback"), "fb:list:0")],
  ]) };
}

export function adminDetailView(item: FeedbackItem): { text: string; keyboard: InlineKeyboardMarkup } {
  const content = item.text.trim() || "Attachment-only feedback";
  const attachments = item.attachments.length ? `\nAttachments: ${item.attachments.map((a) => a.kind).join(", ")}` : "";
  const retry = (item.thread ?? []).filter((entry) => entry.type === "admin_reply" && entry.sent_status === "failed")
    .map((entry) => inlineButton("Retry delivery", `fb:retry:${item.id}:${entry.id}`));
  const rows: InlineButton[][] = [[inlineButton("Reply", `fb:reply:${item.id}`)], ...retry.map((button) => [button]), [inlineButton("Back to feedback", "fb:admin:0")]];
  return { text: `Feedback #${item.id}\n\n${content}${attachments}${threadText(item.thread)}`, keyboard: inlineKeyboard(rows) };
}

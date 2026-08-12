import type { FeedbackItem } from "./store.js";
import { inlineButton, inlineKeyboard, paginate, type InlineButton, type InlineKeyboardMarkup } from "../toolkit/index.js";

function preview(item: FeedbackItem): string {
  const body = item.text.trim() || (item.attachments.length ? `${item.attachments.map((a) => a.kind).join(", ")} attachment` : "No text");
  return body.length > 54 ? `${body.slice(0, 51)}…` : body;
}

export function listView(items: FeedbackItem[], page: number): { text: string; keyboard: InlineKeyboardMarkup } {
  if (items.length === 0) return { text: "No feedback yet — tap Submit feedback to add one.", keyboard: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) };
  const result = paginate(items, { page, perPage: 5, callbackPrefix: "fbpage", prevLabel: "Previous", nextLabel: "Next" });
  const rows: InlineButton[][] = result.pageItems.map((item) => [inlineButton(`#${item.id} ${preview(item)}`, `fb:view:${item.id}`)]);
  rows.push(...result.controls.inline_keyboard);
  rows.push([inlineButton("Back to menu", "menu:main")]);
  return { text: `Your feedback (${result.page + 1}/${result.totalPages})`, keyboard: inlineKeyboard(rows) };
}

export function detailView(item: FeedbackItem): { text: string; keyboard: InlineKeyboardMarkup } {
  const content = item.text.trim() || "Attachment-only feedback";
  const attachment = item.attachments.length ? `\nAttachments: ${item.attachments.map((a) => a.kind).join(", ")}` : "";
  const edited = item.last_edited ? "\nUpdated." : "";
  return { text: `Feedback #${item.id}\n\n${content}${attachment}${edited}`, keyboard: inlineKeyboard([
    [inlineButton("Edit", `fb:edit:${item.id}`), inlineButton("Delete", `fb:delete:${item.id}`)],
    [inlineButton("Back to feedback", "fb:list:0")],
  ]) };
}

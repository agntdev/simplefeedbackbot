import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { confirmKeyboard, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { detailView, listView } from "../feedback/presentation.js";
import { mine, owned, setEditingFeedbackId, softDelete } from "../feedback/store.js";

registerMainMenuItem({ label: "My feedback", data: "fb:list:0", order: 20 });
const composer = new Composer<Ctx>();
async function showList(ctx: Ctx, page: number, edit: boolean): Promise<void> {
  const view = listView(await mine(ctx), page);
  if (edit && ctx.callbackQuery) await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
  else await ctx.reply(view.text, { reply_markup: view.keyboard });
}
async function showDetail(ctx: Ctx, id: number): Promise<void> {
  const item = await owned(ctx, id);
  if (!item || item.status !== "active") { await ctx.editMessageText("That feedback item isn't available."); return; }
  const view = detailView(item); await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
}
composer.command("myfeedback", async (ctx) => { await showList(ctx, 0, false); });
composer.callbackQuery(/^fb:list:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await showList(ctx, Number(ctx.match[1]), true); });
composer.callbackQuery(/^fbpage:(?:prev|next):(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await showList(ctx, Number(ctx.match[1]), true); });
composer.callbackQuery(/^fb:view:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await showDetail(ctx, Number(ctx.match[1])); });
composer.callbackQuery(/^fb:edit:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const item = await owned(ctx, Number(ctx.match[1]));
  if (!item || item.status !== "active") { await ctx.editMessageText("That feedback item isn't available."); return; }
  setEditingFeedbackId(ctx, item.id);
  await ctx.editMessageText(`Send the replacement text, photo, voice message, or file for feedback #${item.id}.`, { reply_markup: inlineKeyboard([[inlineButton("Cancel edit", "fb:editcancel")]]) });
});
composer.callbackQuery("fb:editcancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  setEditingFeedbackId(ctx, undefined);
  await ctx.editMessageText("Edit cancelled.");
});
composer.callbackQuery(/^fb:delete:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const item = await owned(ctx, Number(ctx.match[1]));
  if (!item || item.status !== "active") { await ctx.editMessageText("That feedback item isn't available."); return; }
  await ctx.editMessageText(`Delete feedback #${item.id}? It will be kept for 30 days before removal.`, { reply_markup: confirmKeyboard(`fb:delete:${item.id}`, { yes: "Delete", no: "Keep" }) });
});
composer.callbackQuery(/^fb:delete:(\d+):(yes|no)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const id = Number(ctx.match[1]);
  if (ctx.match[2] === "no") { await showDetail(ctx, id); return; }
  await ctx.editMessageText(await softDelete(ctx, id) ? `Feedback #${id} was deleted. It will be removed after 30 days.` : "That feedback item isn't available.");
});

export default composer;

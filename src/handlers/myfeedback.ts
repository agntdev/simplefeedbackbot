import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { confirmKeyboard, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { detailView, listView } from "../feedback/presentation.js";
import { mine, owned, setEditingFeedbackId, softDelete } from "../feedback/store.js";
import { language, tr } from "../i18n.js";

registerMainMenuItem({ label: "My feedback", data: "fb:list:0", order: 20 });
const composer = new Composer<Ctx>();
async function showList(ctx: Ctx, page: number, edit: boolean): Promise<void> {
  const view = listView(await mine(ctx), page, await language(ctx));
  if (edit && ctx.callbackQuery) await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
  else await ctx.reply(view.text, { reply_markup: view.keyboard });
}
async function showDetail(ctx: Ctx, id: number): Promise<void> {
  const item = await owned(ctx, id);
  if (!item || item.status !== "active") { await ctx.editMessageText(await tr(ctx, "unavailable")); return; }
  const view = detailView(item, await language(ctx)); await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
}
composer.command("myfeedback", async (ctx) => { await showList(ctx, 0, false); });
composer.callbackQuery(/^fb:list:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await showList(ctx, Number(ctx.match[1]), true); });
composer.callbackQuery(/^fbpage:(?:prev|next):(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await showList(ctx, Number(ctx.match[1]), true); });
composer.callbackQuery(/^fb:view:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await showDetail(ctx, Number(ctx.match[1])); });
composer.callbackQuery(/^fb:edit:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const item = await owned(ctx, Number(ctx.match[1]));
  if (!item || item.status !== "active") { await ctx.editMessageText(await tr(ctx, "unavailable")); return; }
  setEditingFeedbackId(ctx, item.id);
  await ctx.editMessageText(await tr(ctx, "replacement", { id: item.id }), { reply_markup: inlineKeyboard([[inlineButton(await tr(ctx, "editCancel"), "fb:editcancel")]]) });
});
composer.callbackQuery("fb:editcancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  setEditingFeedbackId(ctx, undefined);
  await ctx.editMessageText(await tr(ctx, "editCancelled"));
});
composer.callbackQuery(/^fb:delete:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const item = await owned(ctx, Number(ctx.match[1]));
  if (!item || item.status !== "active") { await ctx.editMessageText(await tr(ctx, "unavailable")); return; }
  await ctx.editMessageText(await tr(ctx, "deleteConfirm", { id: item.id }), { reply_markup: confirmKeyboard(`fb:delete:${item.id}`, { yes: await tr(ctx, "delete"), no: await tr(ctx, "keep") }) });
});
composer.callbackQuery(/^fb:delete:(\d+):(yes|no)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const id = Number(ctx.match[1]);
  if (ctx.match[2] === "no") { await showDetail(ctx, id); return; }
  await ctx.editMessageText(await softDelete(ctx, id) ? await tr(ctx, "deleted", { id }) : await tr(ctx, "unavailable"));
});

export default composer;

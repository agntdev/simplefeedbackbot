import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, mainMenuItems } from "../toolkit/index.js";
import { isAdmin } from "../feedback/admin.js";
import { getUserLanguage, setUserLanguage, type Language } from "../feedback/store.js";
import { language, tr } from "../i18n.js";

const composer = new Composer<Ctx>();

function languageKeyboard() {
  return inlineKeyboard([[inlineButton("Русский", "lang:ru"), inlineButton("English", "lang:en")]]);
}

async function menu(ctx: Ctx) {
  const lang = await language(ctx);
  const items = mainMenuItems().map((item) => ({ ...item, label: item.data === "fb:submit" ? (lang === "ru" ? "Отправить отзыв" : "Submit feedback") : item.data === "fb:list:0" ? (lang === "ru" ? "Мои отзывы" : "My feedback") : item.label }));
  const rows: ReturnType<typeof inlineButton>[][] = [];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2).map((item) => inlineButton(item.label, item.data)));
  rows.push([inlineButton(await tr(ctx, "settings"), "settings:open")]);
  if (await isAdmin(ctx)) rows.push([inlineButton(lang === "ru" ? "Панель администратора" : "Admin panel", "admin:home")]);
  rows.push([inlineButton(await tr(ctx, "help"), "menu:help")]);
  return inlineKeyboard(rows);
}

async function showMenu(ctx: Ctx, edit = false): Promise<void> {
  const text = await tr(ctx, "welcome");
  if (edit && ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: await menu(ctx) });
  else await ctx.reply(text, { reply_markup: await menu(ctx) });
}

async function showLanguage(ctx: Ctx, edit = false): Promise<void> {
  const text = "Choose your language / Выберите язык.";
  if (edit && ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: languageKeyboard() });
  else await ctx.reply(text, { reply_markup: languageKeyboard() });
}

composer.command("start", async (ctx) => {
  if (await getUserLanguage(ctx)) await showMenu(ctx);
  else await showLanguage(ctx);
});
composer.callbackQuery(/^lang:(ru|en)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await setUserLanguage(ctx, ctx.match[1] as Language);
  await showMenu(ctx, true);
});
composer.callbackQuery("settings:open", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(await tr(ctx, "settingsText"), { reply_markup: inlineKeyboard([[inlineButton(await tr(ctx, "changeLanguage"), "settings:language")], [inlineButton(await tr(ctx, "backMenu"), "menu:main")]]) });
});
composer.callbackQuery("settings:language", async (ctx) => { await ctx.answerCallbackQuery(); await showLanguage(ctx, true); });
composer.callbackQuery("menu:main", async (ctx) => { await ctx.answerCallbackQuery(); await showMenu(ctx, true); });

export default composer;

import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, mainMenuItems } from "../toolkit/index.js";
import { isAdmin } from "../feedback/admin.js";

// The /start handler renders the bot's MAIN MENU — the primary way users operate
// a button-first bot. A feature adds its own button by calling
// `registerMainMenuItem(...)` in its own `src/handlers/<slug>.ts`; this handler
// renders whatever is registered (plus a Help button), so you do NOT edit this
// file to add a feature. Send ONE message — no placeholder line above the menu.
const composer = new Composer<Ctx>();

const WELCOME = "Welcome. Choose an option below.";

async function menu(ctx: Ctx) {
  const items = mainMenuItems();
  const rows = [] as ReturnType<typeof inlineButton>[][];
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2).map((item) => inlineButton(item.label, item.data)));
  if (await isAdmin(ctx)) rows.push([inlineButton("Admin panel", "admin:home")]);
  rows.push([inlineButton("Help", "menu:help")]);
  return inlineKeyboard(rows);
}

composer.command("start", async (ctx) => {
  await ctx.reply(WELCOME, { reply_markup: await menu(ctx) });
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(WELCOME, { reply_markup: await menu(ctx) });
});

export default composer;

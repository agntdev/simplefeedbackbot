import type { Ctx } from "../bot.js";
import { isOwner } from "../toolkit/index.js";
import { grantAdmin, isStoredAdmin, saveUser } from "./store.js";
import { tr } from "../i18n.js";

/** Owner is the bootstrap administrator; every additional administrator is durable. */
export async function isAdmin(ctx: Ctx): Promise<boolean> {
  if (isOwner(ctx)) {
    if (ctx.from) {
      await saveUser(ctx);
      if (!(await isStoredAdmin(ctx))) await grantAdmin(ctx, ctx.from.id, ctx.from.id);
    }
    return true;
  }
  return isStoredAdmin(ctx);
}

export async function requireAdmin(ctx: Ctx): Promise<boolean> {
  if (await isAdmin(ctx)) return true;
  const text = await tr(ctx, "adminDenied");
  try { await ctx.answerCallbackQuery({ text, show_alert: true }); } catch { /* callback may already be answered */ }
  await ctx.reply(text);
  return false;
}

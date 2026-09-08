import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import { confirmKeyboard, inlineButton, inlineKeyboard, urlButton } from "../toolkit/index.js";
import { isAdmin, requireAdmin } from "../feedback/admin.js";
import { adminAudits, adminRoles, allItems, grantAdmin, messageContent, now, recordBroadcast, revokeAdmin, scheduleBroadcast, users, type FeedbackItem, type FeedbackUser } from "../feedback/store.js";

const composer = new Composer<Ctx>();
type Range = "all" | "7d" | "30d";
type Filter = { range: Range; type: string };

function filterFrom(ctx: Ctx): Filter {
  return (ctx.session.broadcast?.filter as Filter | undefined) ?? { range: "all", type: "all" };
}
function setFilter(ctx: Ctx, filter: Filter): void {
  ctx.session.broadcast = { step: "content", text: "", attachments: [], buttons: [], filter };
}
function allowed(items: FeedbackItem[], filter: Filter): FeedbackItem[] {
  const cutoff = filter.range === "7d" ? now() - 7 * 86400000 : filter.range === "30d" ? now() - 30 * 86400000 : 0;
  return items.filter((item) => item.timestamp >= cutoff && (filter.type === "all" || item.attachments.some((a) => a.kind === filter.type) || (filter.type === "text" && !item.attachments.length)));
}
function label(user: FeedbackUser): string { return user.username ? `@${user.username}` : user.display_name; }
function profileUrl(user: FeedbackUser): string { return user.username ? `https://t.me/${user.username}` : `tg://user?id=${user.telegram_id}`; }
function adminKeyboard() {
  return inlineKeyboard([[inlineButton("Users", "admin:users:0"), inlineButton("Statistics", "admin:stats")], [inlineButton("Export CSV", "admin:export"), inlineButton("Broadcast", "admin:broadcast")], [inlineButton("Audit log", "admin:audits")], [inlineButton("Back to menu", "menu:main")]]);
}
async function open(ctx: Ctx, edit = true): Promise<void> {
  const text = "Admin panel\n\nReview feedback, manage roles, export data, or send an update.";
  if (edit && ctx.callbackQuery) await ctx.editMessageText(text, { reply_markup: adminKeyboard() }); else await ctx.reply(text, { reply_markup: adminKeyboard() });
}
async function showUsers(ctx: Ctx, page: number): Promise<void> {
  const list = await users(ctx); const roles = new Set((await adminRoles(ctx)).map((role) => role.user_id)); const counts = await allItems(ctx);
  if (!list.length) { await ctx.editMessageText("No users have started the bot yet.", { reply_markup: adminKeyboard() }); return; }
  const perPage = 4; const pages = Math.ceil(list.length / perPage); const current = Math.max(0, Math.min(page, pages - 1));
  const rows = list.slice(current * perPage, current * perPage + perPage);
  const text = rows.map((user) => {
    const count = counts.filter((item) => item.user_id === user.telegram_id).length;
    const latest = counts.filter((item) => item.user_id === user.telegram_id).sort((a, b) => b.timestamp - a.timestamp)[0];
    return `<a href="${profileUrl(user)}">${label(user)}</a>\nID: ${user.telegram_id} · Feedback: ${count}\nLast activity: ${latest ? new Date(latest.timestamp).toISOString() : "No feedback"}`;
  }).join("\n\n");
  const buttons = rows.flatMap((user) => [
    [urlButton(`Open ${label(user)}`, profileUrl(user))],
    [inlineButton(roles.has(user.telegram_id) ? "Revoke admin" : "Grant admin", `admin:role:${roles.has(user.telegram_id) ? "revoke" : "grant"}:${user.telegram_id}`)],
  ]);
  const nav = []; if (current > 0) nav.push(inlineButton("Previous", `admin:users:${current - 1}`)); if (current < pages - 1) nav.push(inlineButton("Next", `admin:users:${current + 1}`)); if (nav.length) buttons.push(nav);
  buttons.push([inlineButton("Back to admin", "admin:home")]);
  await ctx.editMessageText(`Users (${current + 1}/${pages})\n\n${text}`, { parse_mode: "HTML", reply_markup: inlineKeyboard(buttons) });
}
async function showStats(ctx: Ctx): Promise<void> {
  const filter = filterFrom(ctx); const all = await allItems(ctx); const selected = allowed(all, filter); const people = await users(ctx);
  const distribution = people.map((user) => `${label(user)}: ${selected.filter((item) => item.user_id === user.telegram_id).length}`).join("\n") || "No users yet.";
  const recent = selected.sort((a, b) => b.timestamp - a.timestamp)[0];
  const text = `Statistics\n\nUsers: ${people.length}\nActive users: ${new Set(selected.map((item) => item.user_id)).size}\nFeedback: ${selected.length}\nMost recent: ${recent ? `#${recent.id}` : "None"}\n\nFeedback per user\n${distribution}`;
  await ctx.editMessageText(text, { reply_markup: inlineKeyboard([[inlineButton("All time", "admin:range:all"), inlineButton("Last 7 days", "admin:range:7d"), inlineButton("Last 30 days", "admin:range:30d")], [inlineButton("All types", "admin:type:all"), inlineButton("Text", "admin:type:text"), inlineButton("Photo", "admin:type:photo")], [inlineButton("Video", "admin:type:video"), inlineButton("Export CSV", "admin:export")], [inlineButton("Broadcast this segment", "admin:broadcast")], [inlineButton("Back to admin", "admin:home")]]) });
}
function csv(items: FeedbackItem[], byId: Map<number, FeedbackUser>): string {
  const cell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  return [["reference_id", "user_id", "username", "username_url", "submitted_at", "text", "attachments", "status"], ...items.map((item) => [item.id, item.user_id, item.username ?? "", profileUrl(byId.get(item.user_id) ?? { telegram_id: item.user_id, display_name: "User" }), new Date(item.timestamp).toISOString(), item.text, item.attachments.map((a) => a.kind).join("; "), item.status])].map((row) => row.map(cell).join(",")).join("\n");
}
async function sendBroadcast(ctx: Ctx): Promise<void> {
  const draft = ctx.session.broadcast; if (!draft || !ctx.from) return;
  const selectedFilter: Filter = { range: draft.filter?.range ?? "all", type: draft.filter?.type ?? "all" };
  const recipients = selectedFilter.range === "all" && selectedFilter.type === "all"
    ? (await users(ctx)).map((user) => user.telegram_id)
    : [...new Set(allowed(await allItems(ctx), selectedFilter).map((item) => item.user_id))];
  const body = [draft.text, draft.bonus].filter(Boolean).join("\n\n"); const markup = draft.buttons.length ? inlineKeyboard([draft.buttons.map((button) => urlButton(button.text, button.url))]) : undefined;
  let delivered = 0;
  for (const recipient of recipients) {
    try {
      await ctx.api.sendMessage(recipient, body || "Update from the team", { reply_markup: markup });
      for (const attachment of draft.attachments) {
        if (!attachment.fileId) continue;
        if (attachment.kind === "photo") await ctx.api.sendPhoto(recipient, attachment.fileId);
        else if (attachment.kind === "video") await ctx.api.sendVideo(recipient, attachment.fileId);
        else if (attachment.kind === "voice") await ctx.api.sendVoice(recipient, attachment.fileId);
        else await ctx.api.sendDocument(recipient, attachment.fileId);
      }
      delivered += 1;
    } catch { /* A user may have blocked the bot; continue with other opted-in users. */ }
  }
  await recordBroadcast(ctx, { initiator_id: ctx.from.id, timestamp: now(), recipients_count: delivered, status: "sent", text: body, attachments: draft.attachments, buttons: draft.buttons });
  ctx.session.broadcast = undefined;
  await ctx.editMessageText(`Broadcast sent to ${delivered} user${delivered === 1 ? "" : "s"}.`, { reply_markup: adminKeyboard() });
}

composer.command("admin", async (ctx) => { if (!(await isAdmin(ctx))) { await ctx.reply("Admin access isn't available for your account."); return; } await open(ctx, false); });
composer.callbackQuery("admin:home", async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); await open(ctx); });
composer.callbackQuery(/^admin:users:(\d+)$/, async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); await showUsers(ctx, Number(ctx.match[1])); });
composer.callbackQuery(/^admin:role:(grant|revoke):(\d+)$/, async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); const action = ctx.match[1]; const id = ctx.match[2]; await ctx.editMessageText(`${action === "grant" ? "Grant" : "Revoke"} admin access for this user?`, { reply_markup: confirmKeyboard(`admin:roleconfirm:${action}:${id}`, { yes: action === "grant" ? "Grant admin" : "Revoke admin", no: "Cancel" }) }); });
composer.callbackQuery(/^admin:roleconfirm:(grant|revoke):(\d+):(yes|no)$/, async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); if (ctx.match[3] === "no") { await open(ctx); return; } const ok = ctx.match[1] === "grant" ? await grantAdmin(ctx, Number(ctx.match[2]), ctx.from!.id) : await revokeAdmin(ctx, Number(ctx.match[2]), ctx.from!.id); await ctx.editMessageText(ok ? `Admin access was ${ctx.match[1] === "grant" ? "granted" : "revoked"}.` : "That role couldn't be changed.", { reply_markup: adminKeyboard() }); });
composer.callbackQuery("admin:stats", async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); await showStats(ctx); });
composer.callbackQuery(/^admin:range:(all|7d|30d)$/, async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); const f = filterFrom(ctx); setFilter(ctx, { ...f, range: ctx.match[1] as Range }); await showStats(ctx); });
composer.callbackQuery(/^admin:type:(all|text|photo|video)$/, async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); const f = filterFrom(ctx); setFilter(ctx, { ...f, type: ctx.match[1] }); await showStats(ctx); });
composer.callbackQuery("admin:export", async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); const list = allowed(await allItems(ctx), filterFrom(ctx)); const people = new Map((await users(ctx)).map((user) => [user.telegram_id, user])); await ctx.replyWithDocument(new InputFile(new TextEncoder().encode(csv(list, people)), "feedback-export.csv"), { caption: list.length ? "Your filtered export is ready." : "There is no feedback in this filter." }); });
composer.callbackQuery("admin:audits", async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); const entries = (await adminAudits(ctx)).slice(0, 10); await ctx.editMessageText(entries.length ? `Recent admin activity\n\n${entries.map((entry) => `${entry.action} · ${new Date(entry.timestamp).toISOString()} · by ${entry.actor_id}`).join("\n")}` : "No admin activity yet.", { reply_markup: inlineKeyboard([[inlineButton("Back to admin", "admin:home")]]) }); });
composer.callbackQuery("admin:broadcast", async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); ctx.session.broadcast = { step: "content", text: "", attachments: [], buttons: [], filter: filterFrom(ctx) }; await ctx.editMessageText("Send the broadcast text or one attachment. You can add the rest next.", { reply_markup: inlineKeyboard([[inlineButton("Cancel", "admin:broadcast:cancel")]]) }); });
composer.callbackQuery("admin:broadcast:cancel", async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); ctx.session.broadcast = undefined; await open(ctx); });
composer.on("message", async (ctx, next) => { const draft = ctx.session.broadcast; if (!draft) return next(); if (!(await isAdmin(ctx))) { ctx.session.broadcast = undefined; return next(); } const content = messageContent(ctx); if (!content || (ctx.message?.text?.startsWith("/") ?? false)) return next(); if (draft.step === "content") { draft.text = content.text; draft.attachments = content.attachments; draft.step = "bonus"; await ctx.reply("Add a short bonus or link, or send “-” to skip it."); return; } if (draft.step === "bonus") { draft.bonus = content.text === "-" ? undefined : content.text; draft.step = "buttons"; await ctx.reply("Add up to 3 buttons as Label | https://link. Send “done” when ready."); return; } if (draft.step === "buttons") { if (content.text.trim().toLowerCase() !== "done") { const [text, url] = content.text.split("|").map((part) => part.trim()); if (!text || !/^https?:\/\//.test(url ?? "") || draft.buttons.length >= 3) { await ctx.reply("Use Label | https://link, or send “done”."); return; } draft.buttons.push({ text, url: url! }); await ctx.reply(`Button added (${draft.buttons.length}/3). Add another or send “done”.`); return; } draft.step = "confirm"; const summary = [draft.text || "Attachment update", draft.bonus].filter(Boolean).join("\n\n"); await ctx.reply(`Preview\n\n${summary}`, { reply_markup: inlineKeyboard([[inlineButton("Send now", "admin:broadcast:send:yes"), inlineButton("Schedule", "admin:broadcast:schedule")], [inlineButton("Cancel", "admin:broadcast:send:no")]]) }); return; } if (draft.step === "schedule") { const scheduledAt = Date.parse(content.text.trim()); if (!Number.isFinite(scheduledAt) || scheduledAt <= now()) { await ctx.reply("Use a future date and time, for example 2026-12-31 15:00 UTC."); return; } draft.scheduledAt = scheduledAt; draft.step = "confirm"; await ctx.reply(`Schedule this broadcast for ${new Date(scheduledAt).toISOString()}?`, { reply_markup: confirmKeyboard("admin:broadcast:scheduled", { yes: "Schedule", no: "Cancel" }) }); return; } return next(); });
composer.callbackQuery(/^admin:broadcast:send:(yes|no)$/, async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); if (ctx.match[1] === "no") { ctx.session.broadcast = undefined; await ctx.editMessageText("Broadcast cancelled.", { reply_markup: adminKeyboard() }); return; } await sendBroadcast(ctx); });
composer.callbackQuery("admin:broadcast:schedule", async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); if (!ctx.session.broadcast) return; ctx.session.broadcast.step = "schedule"; await ctx.editMessageText("Send the future date and time in UTC, for example 2026-12-31 15:00 UTC."); });
composer.callbackQuery(/^admin:broadcast:scheduled:(yes|no)$/, async (ctx) => { if (!(await isAdmin(ctx))) { await requireAdmin(ctx); return; } await ctx.answerCallbackQuery(); const draft = ctx.session.broadcast; if (!draft || !ctx.from || !draft.scheduledAt) return; if (ctx.match[1] === "no") { ctx.session.broadcast = undefined; await ctx.editMessageText("Broadcast cancelled.", { reply_markup: adminKeyboard() }); return; } const filter: Filter = { range: draft.filter?.range ?? "all", type: draft.filter?.type ?? "all" }; const recipients = filter.range === "all" && filter.type === "all" ? (await users(ctx)).map((user) => user.telegram_id) : [...new Set(allowed(await allItems(ctx), filter).map((item) => item.user_id))]; const body = [draft.text, draft.bonus].filter(Boolean).join("\n\n"); await scheduleBroadcast(ctx, { initiator_id: ctx.from.id, timestamp: now(), recipients_count: recipients.length, status: "scheduled", text: body, attachments: draft.attachments, buttons: draft.buttons, scheduled_at: draft.scheduledAt }, recipients); ctx.session.broadcast = undefined; await ctx.editMessageText("Broadcast scheduled.", { reply_markup: adminKeyboard() }); });

export default composer;

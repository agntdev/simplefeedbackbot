import type { Ctx } from "../bot.js";

export type Attachment = {
  kind: string;
  fileId?: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
};

export type FeedbackItem = {
  id: number;
  user_id: number;
  username?: string;
  timestamp: number;
  text: string;
  attachments: Attachment[];
  status: "active" | "deleted";
  last_edited?: number;
  deleted_at?: number;
  thread: FeedbackThreadEntry[];
};

/** Messages the bot sends about a feedback item. Kept with the item so an
 * export always contains the complete conversation. */
export type FeedbackThreadEntry = {
  id: number;
  type: "ack" | "admin_reply";
  timestamp: number;
  sent_status: "pending" | "sent" | "failed";
  admin_id?: number;
  admin_display_name?: string;
  body_text: string;
  attachments: Attachment[];
};

export type Language = "en" | "ru";
export type FeedbackUser = { telegram_id: number; display_name: string; username?: string; language?: Language };
export type AdminRole = { user_id: number; granted_by: number; granted_at: number };
export type AdminAudit = { action: "grant" | "revoke" | "broadcast"; target_user_id?: number; actor_id: number; timestamp: number; detail?: string };
export type BroadcastAck = { broadcast_id: number; user_id: number; username?: string; timestamp: number };
export type BroadcastRecord = { id: number; initiator_id: number; timestamp: number; recipients_count: number; delivered_count: number; recipient_ids: number[]; status: "sent" | "scheduled"; text: string; attachments: Attachment[]; buttons: Array<{ text: string; url: string }>; scheduled_at?: number };

export type FeedbackDatabase = {
  nextId: number;
  nextThreadId: number;
  items: Record<string, FeedbackItem>;
  userItemIds: Record<string, number[]>;
  users: Record<string, FeedbackUser>;
  admins: Record<string, AdminRole>;
  audits: AdminAudit[];
  broadcasts: BroadcastRecord[];
  broadcastAcks: BroadcastAck[];
  nextBroadcastId: number;
};
type FeedbackSession = { feedbackFallback?: FeedbackDatabase; editingFeedbackId?: number; replyingFeedbackId?: number };

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

let clock: () => number = () => Date.now();
/** Test seam for retention decisions. Production code always uses the real clock. */
export function now(): number {
  return clock();
}
export function setClockForTests(next?: () => number): void {
  clock = next ?? (() => Date.now());
}

function emptyDatabase(): FeedbackDatabase {
  return { nextId: 1, nextThreadId: 1, items: {}, userItemIds: {}, users: {}, admins: {}, audits: [], broadcasts: [], broadcastAcks: [], nextBroadcastId: 1 };
}

function userFromCtx(ctx: Ctx): FeedbackUser | undefined {
  if (!ctx.from) return undefined;
  const displayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Telegram user";
  return { telegram_id: ctx.from.id, display_name: displayName, username: ctx.from.username };
}

function attachmentsFromMessage(message: NonNullable<Ctx["message"]>): Attachment[] {
  const attachments: Attachment[] = [];
  const add = (kind: string, value: Record<string, unknown> | undefined) => {
    if (!value) return;
    attachments.push({
      kind,
      fileId: typeof value.file_id === "string" ? value.file_id : undefined,
      fileUniqueId: typeof value.file_unique_id === "string" ? value.file_unique_id : undefined,
      fileName: typeof value.file_name === "string" ? value.file_name : undefined,
      mimeType: typeof value.mime_type === "string" ? value.mime_type : undefined,
      size: typeof value.file_size === "number" ? value.file_size : undefined,
    });
  };
  const raw = message as unknown as Record<string, unknown>;
  const photos = raw.photo;
  if (Array.isArray(photos) && photos.length > 0) add("photo", photos[photos.length - 1] as Record<string, unknown>);
  add("voice", raw.voice as Record<string, unknown> | undefined);
  add("file", raw.document as Record<string, unknown> | undefined);
  add("video", raw.video as Record<string, unknown> | undefined);
  add("audio", raw.audio as Record<string, unknown> | undefined);
  add("animation", raw.animation as Record<string, unknown> | undefined);
  add("video note", raw.video_note as Record<string, unknown> | undefined);
  add("sticker", raw.sticker as Record<string, unknown> | undefined);
  if (attachments.length === 0 && !raw.text && !raw.caption) {
    const kind = ["location", "contact", "poll", "venue", "dice"].find((key) => raw[key] !== undefined);
    if (kind) attachments.push({ kind });
  }
  return attachments;
}

export function messageContent(ctx: Ctx): { text: string; attachments: Attachment[] } | undefined {
  if (!ctx.message) return undefined;
  const raw = ctx.message as unknown as Record<string, unknown>;
  const text = typeof raw.text === "string" ? raw.text : typeof raw.caption === "string" ? raw.caption : "";
  const attachments = attachmentsFromMessage(ctx.message);
  return text || attachments.length > 0 ? { text, attachments } : undefined;
}

function purge(db: FeedbackDatabase, at: number): number {
  let removed = 0;
  for (const [key, item] of Object.entries(db.items)) {
    if (item.status === "deleted" && item.deleted_at !== undefined && at - item.deleted_at >= RETENTION_MS) {
      delete db.items[key];
      const index = db.userItemIds[String(item.user_id)] ?? [];
      db.userItemIds[String(item.user_id)] = index.filter((id) => id !== item.id);
      removed += 1;
    }
  }
  return removed;
}

type WorkerStoreEnv = { CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> } } };
function workerStore(ctx: Ctx): WorkerStoreEnv["CHAT_DO"] | undefined {
  return (ctx as Ctx & { env?: WorkerStoreEnv }).env?.CHAT_DO;
}

async function workerRequest<T>(ctx: Ctx, action: string, payload: Record<string, unknown> = {}): Promise<T | undefined> {
  const namespace = workerStore(ctx);
  if (!namespace) return undefined;
  const response = await namespace.get(namespace.idFromName("feedback-store")).fetch("https://do/feedback", {
    method: "POST",
    body: JSON.stringify({ action, ...payload, at: now() }),
  });
  if (!response.ok) throw new Error("Feedback storage is unavailable.");
  return (await response.json()) as T;
}

function fallback(ctx: Ctx): FeedbackDatabase {
  const session = ctx.session as FeedbackSession;
  return session.feedbackFallback ?? (session.feedbackFallback = emptyDatabase());
}

export function editingFeedbackId(ctx: Ctx): number | undefined {
  return (ctx.session as FeedbackSession).editingFeedbackId;
}

export function setEditingFeedbackId(ctx: Ctx, id: number | undefined): void {
  (ctx.session as FeedbackSession).editingFeedbackId = id;
}
export function replyingFeedbackId(ctx: Ctx): number | undefined { return (ctx.session as FeedbackSession).replyingFeedbackId; }
export function setReplyingFeedbackId(ctx: Ctx, id: number | undefined): void { (ctx.session as FeedbackSession).replyingFeedbackId = id; }

export async function saveUser(ctx: Ctx): Promise<void> {
  const user = userFromCtx(ctx);
  if (!user) return;
  if (await workerRequest<{ ok: true }>(ctx, "user", { user }) !== undefined) return;
  fallback(ctx).users[String(user.telegram_id)] = { ...fallback(ctx).users[String(user.telegram_id)], ...user };
}

/** Language is durable profile data, never conversational session state. */
export async function getUserLanguage(ctx: Ctx): Promise<Language | undefined> {
  if (!ctx.from) return undefined;
  const remote = await workerRequest<FeedbackUser | null>(ctx, "user:get", { userId: ctx.from.id });
  if (remote !== undefined) return remote?.language;
  return fallback(ctx).users[String(ctx.from.id)]?.language;
}

export async function setUserLanguage(ctx: Ctx, language: Language): Promise<void> {
  const user = userFromCtx(ctx);
  if (!user) return;
  user.language = language;
  if (await workerRequest<{ ok: true }>(ctx, "user", { user }) !== undefined) return;
  fallback(ctx).users[String(user.telegram_id)] = { ...fallback(ctx).users[String(user.telegram_id)], ...user };
}

export async function submit(ctx: Ctx, content: { text: string; attachments: Attachment[] }): Promise<FeedbackItem | undefined> {
  const user = userFromCtx(ctx);
  if (!user) return undefined;
  const remote = await workerRequest<FeedbackItem>(ctx, "submit", { user, content });
  if (remote !== undefined) return remote;
  const db = fallback(ctx);
  db.users[String(user.telegram_id)] = { ...db.users[String(user.telegram_id)], ...user };
  const id = db.nextId++;
  const item: FeedbackItem = { id, user_id: user.telegram_id, username: user.username, timestamp: now(), text: content.text, attachments: content.attachments, status: "active", thread: [] };
  db.items[String(id)] = item;
  (db.userItemIds[String(user.telegram_id)] ??= []).push(id);
  return item;
}

export async function mine(ctx: Ctx, includeDeleted = false): Promise<FeedbackItem[]> {
  if (!ctx.from) return [];
  const remote = await workerRequest<FeedbackItem[]>(ctx, "mine", { userId: ctx.from.id, includeDeleted });
  if (remote !== undefined) return remote;
  const db = fallback(ctx); purge(db, now());
  return (db.userItemIds[String(ctx.from.id)] ?? []).map((id) => db.items[String(id)]).filter((item): item is FeedbackItem => Boolean(item) && (includeDeleted || item.status === "active"));
}

export async function owned(ctx: Ctx, id: number): Promise<FeedbackItem | undefined> {
  if (!ctx.from) return undefined;
  const remote = await workerRequest<FeedbackItem | null>(ctx, "owned", { userId: ctx.from.id, id });
  if (remote !== undefined) return remote ?? undefined;
  const item = fallback(ctx).items[String(id)];
  return item?.user_id === ctx.from.id ? item : undefined;
}

export async function update(ctx: Ctx, id: number, content: { text: string; attachments: Attachment[] }): Promise<FeedbackItem | undefined> {
  if (!ctx.from) return undefined;
  const remote = await workerRequest<FeedbackItem | null>(ctx, "update", { userId: ctx.from.id, id, content });
  if (remote !== undefined) return remote ?? undefined;
  const item = await owned(ctx, id);
  if (!item || item.status !== "active") return undefined;
  item.text = content.text; item.attachments = content.attachments; item.last_edited = now();
  return item;
}

export async function softDelete(ctx: Ctx, id: number): Promise<boolean> {
  if (!ctx.from) return false;
  const remote = await workerRequest<{ ok: boolean }>(ctx, "delete", { userId: ctx.from.id, id });
  if (remote !== undefined) return remote.ok;
  const item = await owned(ctx, id);
  if (!item || item.status !== "active") return false;
  item.status = "deleted"; item.deleted_at = now(); return true;
}

export async function purgeDeleted(ctx: Ctx): Promise<number> {
  const remote = await workerRequest<{ removed: number }>(ctx, "purge", {});
  if (remote !== undefined) return remote.removed;
  return purge(fallback(ctx), now());
}

export async function exportItems(ctx: Ctx): Promise<FeedbackItem[]> {
  const remote = await workerRequest<FeedbackItem[]>(ctx, "export", {});
  if (remote !== undefined) return remote;
  const db = fallback(ctx); purge(db, now()); return Object.values(db.items);
}

export async function allItems(ctx: Ctx): Promise<FeedbackItem[]> {
  const remote = await workerRequest<FeedbackItem[]>(ctx, "all", {});
  if (remote !== undefined) return remote;
  const db = fallback(ctx); purge(db, now());
  return Object.values(db.items).sort((a, b) => b.id - a.id);
}

export async function users(ctx: Ctx): Promise<FeedbackUser[]> {
  const remote = await workerRequest<FeedbackUser[]>(ctx, "users", {});
  if (remote !== undefined) return remote;
  return Object.values(fallback(ctx).users);
}

export async function adminRoles(ctx: Ctx): Promise<AdminRole[]> {
  const remote = await workerRequest<AdminRole[]>(ctx, "admins", {});
  if (remote !== undefined) return remote;
  return Object.values(fallback(ctx).admins);
}

export async function isStoredAdmin(ctx: Ctx, userId: number | undefined = ctx.from?.id): Promise<boolean> {
  if (userId === undefined) return false;
  const remote = await workerRequest<{ ok: boolean }>(ctx, "admin:check", { userId });
  if (remote !== undefined) return remote.ok;
  return Boolean(fallback(ctx).admins[String(userId)]);
}

export async function grantAdmin(ctx: Ctx, targetUserId: number, actorId: number): Promise<boolean> {
  const remote = await workerRequest<{ ok: boolean }>(ctx, "admin:grant", { targetUserId, actorId });
  if (remote !== undefined) return remote.ok;
  const db = fallback(ctx);
  if (!db.users[String(targetUserId)] || db.admins[String(targetUserId)]) return false;
  db.admins[String(targetUserId)] = { user_id: targetUserId, granted_by: actorId, granted_at: now() };
  db.audits.push({ action: "grant", target_user_id: targetUserId, actor_id: actorId, timestamp: now() });
  return true;
}

export async function revokeAdmin(ctx: Ctx, targetUserId: number, actorId: number): Promise<boolean> {
  const remote = await workerRequest<{ ok: boolean }>(ctx, "admin:revoke", { targetUserId, actorId });
  if (remote !== undefined) return remote.ok;
  const db = fallback(ctx);
  if (!db.admins[String(targetUserId)]) return false;
  delete db.admins[String(targetUserId)];
  db.audits.push({ action: "revoke", target_user_id: targetUserId, actor_id: actorId, timestamp: now() });
  return true;
}

export async function adminAudits(ctx: Ctx): Promise<AdminAudit[]> {
  const remote = await workerRequest<AdminAudit[]>(ctx, "audits", {});
  if (remote !== undefined) return remote;
  return [...fallback(ctx).audits].sort((a, b) => b.timestamp - a.timestamp);
}

export async function recordBroadcast(ctx: Ctx, record: Omit<BroadcastRecord, "id">): Promise<BroadcastRecord> {
  const remote = await workerRequest<BroadcastRecord>(ctx, "broadcast:record", { record });
  if (remote !== undefined) return remote;
  const db = fallback(ctx); const saved = { ...record, id: db.nextBroadcastId++ };
  db.broadcasts.push(saved); db.audits.push({ action: "broadcast", actor_id: record.initiator_id, timestamp: record.timestamp, detail: `${record.recipients_count} recipients` });
  return saved;
}

export async function setBroadcastDelivered(ctx: Ctx, id: number, delivered: number): Promise<BroadcastRecord | undefined> {
  const remote = await workerRequest<BroadcastRecord | null>(ctx, "broadcast:delivered", { id, delivered });
  if (remote !== undefined) return remote ?? undefined;
  const record = fallback(ctx).broadcasts.find((entry) => entry.id === id);
  if (!record) return undefined;
  record.delivered_count = delivered;
  return record;
}

export async function broadcastById(ctx: Ctx, id: number): Promise<BroadcastRecord | undefined> {
  const remote = await workerRequest<BroadcastRecord | null>(ctx, "broadcast:get", { id });
  if (remote !== undefined) return remote ?? undefined;
  return fallback(ctx).broadcasts.find((entry) => entry.id === id);
}

export async function broadcasts(ctx: Ctx): Promise<BroadcastRecord[]> {
  const remote = await workerRequest<BroadcastRecord[]>(ctx, "broadcast:list", {});
  if (remote !== undefined) return remote;
  return [...fallback(ctx).broadcasts].sort((a, b) => b.id - a.id);
}

export async function broadcastAcks(ctx: Ctx, broadcastId: number): Promise<BroadcastAck[]> {
  const remote = await workerRequest<BroadcastAck[]>(ctx, "broadcast:acks", { id: broadcastId });
  if (remote !== undefined) return remote;
  return fallback(ctx).broadcastAcks.filter((ack) => ack.broadcast_id === broadcastId);
}

/** Records one acknowledgement per recipient. The store validates that the user
 * was selected for this broadcast, so callback data cannot expose another list. */
export async function acknowledgeBroadcast(ctx: Ctx, broadcastId: number): Promise<"saved" | "duplicate" | "unavailable"> {
  if (!ctx.from) return "unavailable";
  const user = userFromCtx(ctx);
  const remote = await workerRequest<{ result: "saved" | "duplicate" | "unavailable" }>(ctx, "broadcast:ack", { id: broadcastId, user });
  if (remote !== undefined) return remote.result;
  const db = fallback(ctx); const record = db.broadcasts.find((entry) => entry.id === broadcastId);
  if (!record || !record.recipient_ids.includes(ctx.from.id)) return "unavailable";
  if (db.broadcastAcks.some((ack) => ack.broadcast_id === broadcastId && ack.user_id === ctx.from!.id)) return "duplicate";
  db.broadcastAcks.push({ broadcast_id: broadcastId, user_id: ctx.from.id, username: user?.username, timestamp: now() });
  return "saved";
}

export async function scheduleBroadcast(ctx: Ctx, record: Omit<BroadcastRecord, "id">, recipients: number[]): Promise<BroadcastRecord> {
  const remote = await workerRequest<BroadcastRecord>(ctx, "broadcast:schedule", { record, recipients });
  if (remote !== undefined) return remote;
  // The Node/harness fallback cannot run alarms, but still retains the pending job.
  return recordBroadcast(ctx, { ...record, status: "scheduled" });
}

export async function anyItem(ctx: Ctx, id: number): Promise<FeedbackItem | undefined> {
  const remote = await workerRequest<FeedbackItem | null>(ctx, "any", { id });
  if (remote !== undefined) return remote ?? undefined;
  return fallback(ctx).items[String(id)];
}

export async function addThreadEntry(ctx: Ctx, id: number, entry: Omit<FeedbackThreadEntry, "id">): Promise<FeedbackThreadEntry | undefined> {
  const remote = await workerRequest<FeedbackThreadEntry | null>(ctx, "thread:add", { id, entry });
  if (remote !== undefined) return remote ?? undefined;
  const db = fallback(ctx); const item = db.items[String(id)];
  if (!item) return undefined;
  const saved = { ...entry, id: db.nextThreadId++ };
  item.thread ??= [];
  item.thread.push(saved);
  return saved;
}

export async function markThreadStatus(ctx: Ctx, feedbackId: number, entryId: number, sent_status: FeedbackThreadEntry["sent_status"]): Promise<boolean> {
  const remote = await workerRequest<{ ok: boolean }>(ctx, "thread:status", { id: feedbackId, entryId, sent_status });
  if (remote !== undefined) return remote.ok;
  const entry = fallback(ctx).items[String(feedbackId)]?.thread?.find((v) => v.id === entryId);
  if (!entry) return false;
  entry.sent_status = sent_status;
  return true;
}

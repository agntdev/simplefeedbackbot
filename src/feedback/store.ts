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
};

export type FeedbackUser = { telegram_id: number; display_name: string; username?: string };

export type FeedbackDatabase = {
  nextId: number;
  items: Record<string, FeedbackItem>;
  userItemIds: Record<string, number[]>;
  users: Record<string, FeedbackUser>;
};
type FeedbackSession = { feedbackFallback?: FeedbackDatabase; editingFeedbackId?: number };

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
  return { nextId: 1, items: {}, userItemIds: {}, users: {} };
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

export async function saveUser(ctx: Ctx): Promise<void> {
  const user = userFromCtx(ctx);
  if (!user) return;
  if (await workerRequest<{ ok: true }>(ctx, "user", { user }) !== undefined) return;
  fallback(ctx).users[String(user.telegram_id)] = user;
}

export async function submit(ctx: Ctx, content: { text: string; attachments: Attachment[] }): Promise<FeedbackItem | undefined> {
  const user = userFromCtx(ctx);
  if (!user) return undefined;
  const remote = await workerRequest<FeedbackItem>(ctx, "submit", { user, content });
  if (remote !== undefined) return remote;
  const db = fallback(ctx);
  db.users[String(user.telegram_id)] = user;
  const id = db.nextId++;
  const item: FeedbackItem = { id, user_id: user.telegram_id, username: user.username, timestamp: now(), text: content.text, attachments: content.attachments, status: "active" };
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

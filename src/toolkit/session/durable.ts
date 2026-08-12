/**
 * Durable Object session storage + exact-time reminders for the Cloudflare
 * Workers runtime (docs/cloudflare/new-projects-on-cf.md §1, §10).
 *
 * One ChatDO instance per chat (addressed by idFromName("chat:<chatId>")). It
 * holds:
 *   - the grammY session (strongly consistent, serialized per chat for free);
 *   - that chat's reminders, with a single Durable Object ALARM armed to the
 *     earliest due one. The alarm fires at the wall-clock time even when nothing
 *     is running — this is what replaces per-bot cron + Redis (PoC: 0–1 ms).
 *
 * NONE of this is imported by the Node/long-poll entry or the test harness, so
 * `node:fs`, Redis, and this file's Workers-only globals never load there.
 */

import type { StorageAdapter } from "grammy";

// Minimal shapes so this file type-checks without pulling @cloudflare/workers-types
// into the Node build. The real bindings are provided by the Workers runtime.
export interface DOState {
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put(entries: Record<string, unknown>): Promise<void>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    setAlarm(scheduledTime: number): Promise<void>;
    getAlarm(): Promise<number | null>;
  };
  blockConcurrencyWhile(fn: () => Promise<void>): void;
}
export interface DONamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DOStub;
}
export interface DOStub {
  fetch(input: string, init?: { method?: string; body?: string }): Promise<Response>;
}
export interface WorkerEnv {
  BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
  CHAT_DO: DONamespace;
  DB?: unknown; // D1 binding (app data); see AGENTS.md
  BOT_TELEMETRY_URL?: string;
  BOT_TELEMETRY_SECRET?: string;
  BOT_TELEMETRY_SALT?: string;
}

interface Reminder {
  at: number; // epoch ms
  chatId: number | string;
  text: string;
}

type StoredAttachment = {
  kind: string;
  fileId?: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
};
type StoredFeedback = {
  id: number;
  user_id: number;
  username?: string;
  timestamp: number;
  text: string;
  attachments: StoredAttachment[];
  status: "active" | "deleted";
  last_edited?: number;
  deleted_at?: number;
};
type FeedbackDb = {
  nextId: number;
  items: Record<string, StoredFeedback>;
  userItemIds: Record<string, number[]>;
  users: Record<string, { telegram_id: number; display_name: string; username?: string }>;
};
const FEEDBACK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function emptyFeedbackDb(): FeedbackDb {
  return { nextId: 1, items: {}, userItemIds: {}, users: {} };
}

function purgeFeedback(db: FeedbackDb, at: number): number {
  let removed = 0;
  for (const [key, item] of Object.entries(db.items)) {
    if (item.status === "deleted" && item.deleted_at !== undefined && at - item.deleted_at >= FEEDBACK_RETENTION_MS) {
      delete db.items[key];
      db.userItemIds[String(item.user_id)] = (db.userItemIds[String(item.user_id)] ?? []).filter((id) => id !== item.id);
      removed += 1;
    }
  }
  return removed;
}

/**
 * createDurableSessionStorage — a grammY StorageAdapter that routes each session
 * key to its own ChatDO instance. Pass to buildBot({ storage }) in the Worker.
 */
export function createDurableSessionStorage<T>(env: WorkerEnv): StorageAdapter<T> {
  const stub = (key: string): DOStub => {
    // A missing binding otherwise surfaces as the opaque "Cannot read
    // properties of undefined (reading 'get')" — live: canary #2 shipped with
    // the binding misnamed CHATDO and every update threw exactly that.
    if (!env.CHAT_DO) {
      throw new Error(
        "CHAT_DO Durable Object binding is missing — the deploy must bind class ChatDO as CHAT_DO (see cf.meta.json)",
      );
    }
    return env.CHAT_DO.get(env.CHAT_DO.idFromName("chat:" + key));
  };
  return {
    async read(key: string): Promise<T | undefined> {
      const r = await stub(key).fetch("https://do/session", { method: "GET" });
      if (r.status === 204) return undefined;
      return (await r.json()) as T;
    },
    async write(key: string, value: T): Promise<void> {
      await stub(key).fetch("https://do/session", { method: "PUT", body: JSON.stringify(value) });
    },
    async delete(key: string): Promise<void> {
      await stub(key).fetch("https://do/session", { method: "DELETE" });
    },
  };
}

/**
 * remindAt — schedule a one-shot reminder DM for `chatId` at `whenEpochMs`.
 * Backed by the chat's ChatDO alarm; fires within a millisecond of the target
 * even if the Worker was idle. Call from a handler under the Workers runtime
 * (via ctx.env). No-op-safe: a scheduling failure never throws into the update.
 */
export async function remindAt(
  env: WorkerEnv,
  chatId: number | string,
  whenEpochMs: number,
  text: string,
): Promise<void> {
  try {
    const stub = env.CHAT_DO.get(env.CHAT_DO.idFromName("chat:" + chatId));
    await stub.fetch("https://do/remind", {
      method: "POST",
      body: JSON.stringify({ at: whenEpochMs, chatId, text } satisfies Reminder),
    });
  } catch {
    /* best-effort: a reminder we couldn't schedule must not break the reply */
  }
}

async function tg(token: string, method: string, payload: unknown): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * ChatDO — the per-chat Durable Object. Its class name is referenced in
 * cf.meta.json (new_sqlite_classes) so the deployer registers the migration.
 * Constructed by the runtime with (state, env).
 */
export class ChatDO {
  constructor(
    private readonly state: DOState,
    private readonly env: WorkerEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Session storage (routed here by createDurableSessionStorage).
    if (url.pathname === "/session") {
      if (request.method === "GET") {
        const v = await this.state.storage.get<unknown>("session");
        if (v === undefined) return new Response(null, { status: 204 });
        return Response.json(v);
      }
      if (request.method === "PUT") {
        await this.state.storage.put("session", await request.json());
        return new Response(null, { status: 204 });
      }
      if (request.method === "DELETE") {
        await this.state.storage.delete("session");
        return new Response(null, { status: 204 });
      }
    }

    // Schedule a reminder + (re)arm the alarm to the earliest due one.
    if (url.pathname === "/remind" && request.method === "POST") {
      const rem = (await request.json()) as Reminder;
      const list = (await this.state.storage.get<Reminder[]>("reminders")) ?? [];
      list.push(rem);
      await this.state.storage.put("reminders", list);
      await this.rearm(list);
      return new Response(null, { status: 204 });
    }

    // Application records for Feedback Collector. A dedicated singleton DO is
    // addressed as "feedback-store" by the handler, so this is globally
    // consistent without scanning a Redis/D1 keyspace. User and item indexes
    // make every read direct and bounded.
    if (url.pathname === "/feedback" && request.method === "POST") {
      const body = (await request.json()) as {
        action: string; at: number; user?: { telegram_id: number; display_name: string; username?: string };
        userId?: number; id?: number; content?: { text: string; attachments: StoredAttachment[] };
      };
      const db = (await this.state.storage.get<FeedbackDb>("feedback-db")) ?? emptyFeedbackDb();
      const at = Number.isFinite(body.at) ? body.at : 0;
      const userId = body.userId;
      const item = body.id === undefined ? undefined : db.items[String(body.id)];
      let response: unknown;
      if (body.action === "user" && body.user) {
        db.users[String(body.user.telegram_id)] = body.user;
        response = { ok: true };
      } else if (body.action === "submit" && body.user && body.content) {
        db.users[String(body.user.telegram_id)] = body.user;
        const id = db.nextId++;
        const created: StoredFeedback = { id, user_id: body.user.telegram_id, username: body.user.username, timestamp: at, text: body.content.text, attachments: body.content.attachments, status: "active" };
        db.items[String(id)] = created;
        (db.userItemIds[String(created.user_id)] ??= []).push(id);
        response = created;
      } else if (body.action === "mine" && userId !== undefined) {
        purgeFeedback(db, at);
        const includeDeleted = (body as { includeDeleted?: boolean }).includeDeleted === true;
        response = (db.userItemIds[String(userId)] ?? [])
          .map((id) => db.items[String(id)])
          .filter((v): v is StoredFeedback => Boolean(v) && (includeDeleted || v.status === "active"));
      } else if (body.action === "owned" && userId !== undefined) {
        response = item?.user_id === userId ? item : null;
      } else if (body.action === "update" && userId !== undefined && body.content) {
        if (!item || item.user_id !== userId || item.status !== "active") response = null;
        else { item.text = body.content.text; item.attachments = body.content.attachments; item.last_edited = at; response = item; }
      } else if (body.action === "delete" && userId !== undefined) {
        if (!item || item.user_id !== userId || item.status !== "active") response = { ok: false };
        else { item.status = "deleted"; item.deleted_at = at; response = { ok: true }; }
      } else if (body.action === "purge") {
        response = { removed: purgeFeedback(db, at) };
      } else if (body.action === "export") {
        purgeFeedback(db, at); response = Object.values(db.items);
      } else {
        return new Response("bad feedback request", { status: 400 });
      }
      await this.state.storage.put("feedback-db", db);
      return Response.json(response);
    }

    return new Response("not found", { status: 404 });
  }

  // Fires at the earliest reminder's wall-clock time. Sends every due reminder,
  // drops them, and re-arms for whatever remains.
  async alarm(): Promise<void> {
    const now = Date.now();
    const list = (await this.state.storage.get<Reminder[]>("reminders")) ?? [];
    const due = list.filter((r) => r.at <= now);
    const rest = list.filter((r) => r.at > now);
    for (const r of due) {
      await tg(this.env.BOT_TOKEN, "sendMessage", { chat_id: r.chatId, text: r.text });
    }
    await this.state.storage.put("reminders", rest);
    await this.rearm(rest);
  }

  private async rearm(list: Reminder[]): Promise<void> {
    if (list.length === 0) return;
    const next = Math.min(...list.map((r) => r.at));
    const current = await this.state.storage.getAlarm();
    if (current === null || next < current) {
      await this.state.storage.setAlarm(next);
    }
  }
}

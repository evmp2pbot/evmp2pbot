import { SessionStore } from 'telegraf';
import mongoose, { Document, Schema } from 'mongoose';
import { logger } from '../logger';

export interface SessionDocument extends Document {
  key: string;
  session: string;
}

const SessionSchema = new Schema<SessionDocument>({
  key: { type: String, unique: true },
  session: { type: String },
});

const Session = mongoose.model<SessionDocument>('Session', SessionSchema);

export function Mongo<T>(): SessionStore<T> &
  Record<string, (...args: any[]) => unknown> {
  const cache = new Map<string, T>();
  const pendingFlush = new Set<string>();
  let flushTimer: NodeJS.Timeout | undefined;
  return {
    delayedFlush() {
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        const keys = Array.from(pendingFlush);
        pendingFlush.clear();
        (async () => {
          for (const key of keys) {
            const value = cache.get(key);
            if (value) {
              await this.set(key, value);
            }
          }
        })().catch(e =>
          logger.error(`Failure in delayed session flush: ${e?.toString()}`)
        );
      }, 2000);
    },
    async get(key) {
      let ret = cache.get(key);
      if (!cache.has(key)) {
        const doc = await Session.findOne({ key });
        ret = (doc?.session ? JSON.parse(doc.session) : ({} as T)) || {};
        cache.set(key, ret as T);
      }
      pendingFlush.add(key);
      this.delayedFlush();
      return ret;
    },
    async set(key: string, session: T) {
      const existing = cache.get(key);
      if (existing !== session) {
        if (existing && session) {
          Object.assign(existing, session);
          Object.assign(session, existing);
        }
        cache.set(key, session);
      }
      await Session.updateOne(
        { key },
        { $set: { key, session: JSON.stringify(session) } },
        { upsert: true }
      );
      this.delayedFlush();
    },
    async delete(key: string) {
      cache.delete(key);
      pendingFlush.delete(key);
      await Session.deleteOne({ key });
    },
  };
}

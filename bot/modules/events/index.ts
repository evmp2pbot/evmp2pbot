export type EventHandler = (payload: any) => Promise<unknown> | unknown;

const subs: Record<string, EventHandler[]> = {};

export const subscribe = (type: string, fn: EventHandler) => {
  if (typeof fn !== 'function') throw new Error('HandlerNotAFunction');
  subs[type] = subs[type] || [];
  subs[type].push(fn);
  return () => {
    subs[type] = subs[type].filter(sub => sub !== fn);
  };
};

export const dispatch = (event: { type: string; payload: any }) => {
  const fns = subs[event.type] || [];
  const results = fns.map(fn => fn(event.payload));
  return Promise.all(results);
};

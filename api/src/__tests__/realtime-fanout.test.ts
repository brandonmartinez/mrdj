/**
 * Epic 8 (#21/#31) — Postgres LISTEN/NOTIFY fan-out.
 *
 * These tests use two PgListenNotifyRealtimeService instances against the same test Postgres
 * to simulate two API replicas. The broker carries only queue invalidation signals; clients
 * still re-fetch authoritative state over REST.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import { PgListenNotifyRealtimeService } from '../realtime/pg-listen-notify.js';
import { InProcessRealtimeService, queueChannel, type QueueChangedEvent } from '../realtime/service.js';

const DB_URL = process.env.REALTIME_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? 'postgresql://mrdj:mrdj@localhost:5432/mrdj';

let services: PgListenNotifyRealtimeService[] = [];

function service(): PgListenNotifyRealtimeService {
  const realtime = new PgListenNotifyRealtimeService(DB_URL);
  services.push(realtime);
  return realtime;
}

function waitForQueueEvent(
  subscribe: (handler: (payload: QueueChangedEvent) => void) => void,
  timeoutMs = 1_500,
): Promise<QueueChangedEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for queue event')), timeoutMs);
    subscribe((payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

afterEach(async () => {
  await Promise.all(services.map(realtime => realtime.disconnect()));
  services = [];
});

describe('PgListenNotifyRealtimeService cross-replica fan-out (#21/#31)', () => {
  it('delivers a queue change from one replica to a subscriber on another replica', async () => {
    const replicaA = service();
    const replicaB = service();
    const eventId = uuid();
    const areaId = uuid();
    const channel = queueChannel(eventId, areaId);
    const payload: QueueChangedEvent = { type: 'queue:changed', eventId, areaId, at: new Date().toISOString() };

    const received = waitForQueueEvent(handler => replicaA.subscribe(channel, handler));
    await replicaA.waitUntilListening(channel);
    replicaB.publish(channel, payload);

    await expect(received).resolves.toEqual(payload);
  });

  it('broadcasts from one replica to every local channel on peer replicas', async () => {
    const replicaA = service();
    const replicaB = service();
    const eventId = uuid();
    const ch1 = queueChannel(eventId, uuid());
    const ch2 = queueChannel(eventId, uuid());
    const payload: QueueChangedEvent = { type: 'queue:changed', at: new Date().toISOString() };

    const receivedOnA = waitForQueueEvent(handler => replicaA.subscribe(ch1, handler));
    const receivedOnB = waitForQueueEvent(handler => replicaB.subscribe(ch2, handler));
    await Promise.all([replicaA.waitUntilListening(), replicaB.waitUntilListening()]);
    replicaA.broadcast(payload);

    await expect(Promise.all([receivedOnA, receivedOnB])).resolves.toEqual([payload, payload]);
  });

  it('keeps per-area channels isolated', async () => {
    const replicaA = service();
    const replicaB = service();
    const eventId = uuid();
    const watchedAreaId = uuid();
    const otherAreaId = uuid();
    const watchedChannel = queueChannel(eventId, watchedAreaId);
    const otherChannel = queueChannel(eventId, otherAreaId);
    let calls = 0;

    replicaA.subscribe(watchedChannel, () => { calls += 1; });
    await replicaA.waitUntilListening(watchedChannel);
    replicaB.publish(otherChannel, {
      type: 'queue:changed',
      eventId,
      areaId: otherAreaId,
      at: new Date().toISOString(),
    });
    await delay(300);

    expect(calls).toBe(0);
  });

  it('stops delivering after unsubscribe', async () => {
    const replicaA = service();
    const replicaB = service();
    const eventId = uuid();
    const areaId = uuid();
    const channel = queueChannel(eventId, areaId);
    let calls = 0;

    const unsubscribe = replicaA.subscribe(channel, () => { calls += 1; });
    await replicaA.waitUntilListening(channel);
    unsubscribe();
    replicaB.publish(channel, { type: 'queue:changed', eventId, areaId, at: new Date().toISOString() });
    await delay(300);

    expect(calls).toBe(0);
  });
});

describe('InProcessRealtimeService broadcast', () => {
  it('wakes every local queue stream', async () => {
    const realtime = new InProcessRealtimeService();
    const eventId = uuid();
    const ch1 = queueChannel(eventId, uuid());
    const ch2 = queueChannel(eventId, uuid());
    const payload: QueueChangedEvent = { type: 'queue:changed', at: new Date().toISOString() };

    const receivedOnCh1 = waitForQueueEvent(handler => realtime.subscribe(ch1, handler));
    const receivedOnCh2 = waitForQueueEvent(handler => realtime.subscribe(ch2, handler));
    realtime.broadcast(payload);

    await expect(Promise.all([receivedOnCh1, receivedOnCh2])).resolves.toEqual([payload, payload]);
    await realtime.disconnect();
  });
});

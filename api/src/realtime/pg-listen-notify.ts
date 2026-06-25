// Owner: Basher (realtime transport) — Postgres LISTEN/NOTIFY broker (#21).
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { cfg } from '../config/index.js';
import { isQueueChannel, queueChannel, type QueueChangedEvent, type RealtimeService, type Unsubscribe } from './service.js';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const QUEUE_CHANNEL_RE = new RegExp(`^queue:(${UUID}):(${UUID})$`);
const PG_CHANNEL_RE = /^q_[a-f0-9]{48}$/;
const INITIAL_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 30_000;

type Handler = (payload: QueueChangedEvent) => void;

function parseQueueChannel(channel: string): { eventId: string; areaId: string } {
  const match = QUEUE_CHANNEL_RE.exec(channel);
  if (!match) {
    throw new Error(`[realtime] invalid queue channel: ${channel}`);
  }
  return { eventId: match[1].toLowerCase(), areaId: match[2].toLowerCase() };
}

function pgChannelFor(logicalChannel: string): string {
  parseQueueChannel(logicalChannel);
  return `q_${createHash('sha256').update(logicalChannel).digest('hex').slice(0, 48)}`;
}

function quoteIdentifier(identifier: string): string {
  if (!PG_CHANNEL_RE.test(identifier)) {
    throw new Error(`[realtime] invalid Postgres channel identifier: ${identifier}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function isQueueChangedEvent(payload: unknown): payload is QueueChangedEvent {
  if (!payload || typeof payload !== 'object') return false;
  const event = payload as Partial<QueueChangedEvent>;
  return event.type === 'queue:changed' && typeof event.at === 'string';
}

export class PgListenNotifyRealtimeService implements RealtimeService {
  private client: Client | undefined;
  private connectPromise: Promise<Client> | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectAttempts = 0;
  private stopped = false;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly pgChannels = new Map<string, Set<string>>();
  private readonly listenPromises = new Map<string, Promise<void>>();

  constructor(private readonly connectionString = cfg.realtimeDatabaseUrl) {}

  subscribe(channel: string, handler: Handler): Unsubscribe {
    const logicalChannel = this.validateLogicalChannel(channel);
    const pgChannel = pgChannelFor(logicalChannel);
    let handlers = this.handlers.get(logicalChannel);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(logicalChannel, handlers);
    }
    handlers.add(handler);

    let logicals = this.pgChannels.get(pgChannel);
    const wasListening = !!logicals?.size;
    if (!logicals) {
      logicals = new Set();
      this.pgChannels.set(pgChannel, logicals);
    }
    logicals.add(logicalChannel);
    if (!wasListening) {
      void this.listen(pgChannel).catch(err => {
        console.error('[realtime] LISTEN failed:', err instanceof Error ? err.message : err);
        this.scheduleReconnect();
      });
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.unsubscribe(logicalChannel, handler, pgChannel);
    };
  }

  publish(channel: string, payload: QueueChangedEvent): void {
    const logicalChannel = this.validateLogicalChannel(channel);
    const { eventId, areaId } = parseQueueChannel(logicalChannel);
    const outbound: QueueChangedEvent = {
      ...payload,
      eventId: payload.eventId ?? eventId,
      areaId: payload.areaId ?? areaId,
    };

    void this.ensureClient()
      .then(client => client.query('SELECT pg_notify($1, $2)', [pgChannelFor(logicalChannel), JSON.stringify(outbound)]))
      .catch(err => {
        console.error('[realtime] NOTIFY failed:', err instanceof Error ? err.message : err);
        this.scheduleReconnect();
      });
  }

  channelNames(): string[] {
    return [...this.handlers.keys()];
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const client = this.client;
    this.client = undefined;
    this.connectPromise = undefined;
    this.listenPromises.clear();
    this.handlers.clear();
    this.pgChannels.clear();
    if (!client) return;
    client.removeAllListeners();
    try {
      await client.query('UNLISTEN *');
    } catch (err) {
      console.error('[realtime] UNLISTEN failed during disconnect:', err instanceof Error ? err.message : err);
    }
    await client.end().catch(() => {});
  }

  /** Test/diagnostic hook: resolves after the current subscribed channels have been LISTENed. */
  async waitUntilListening(channel?: string): Promise<void> {
    if (channel) {
      await this.listen(pgChannelFor(this.validateLogicalChannel(channel)));
      return;
    }
    await Promise.all([...this.pgChannels.keys()].map(pgChannel => this.listen(pgChannel)));
  }

  private validateLogicalChannel(channel: string): string {
    if (!isQueueChannel(channel)) {
      throw new Error(`[realtime] unsupported channel: ${channel}`);
    }
    const { eventId, areaId } = parseQueueChannel(channel);
    return queueChannel(eventId, areaId);
  }

  private unsubscribe(logicalChannel: string, handler: Handler, pgChannel: string): void {
    const handlers = this.handlers.get(logicalChannel);
    handlers?.delete(handler);
    if (handlers?.size === 0) {
      this.handlers.delete(logicalChannel);
      const logicals = this.pgChannels.get(pgChannel);
      logicals?.delete(logicalChannel);
      if (logicals?.size === 0) {
        this.pgChannels.delete(pgChannel);
        void this.unlisten(pgChannel);
      }
    }
  }

  private async ensureClient(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connectPromise) return this.connectPromise;
    this.stopped = false;
    this.connectPromise = this.connect();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  private async connect(): Promise<Client> {
    const client = new Client({ connectionString: this.connectionString });
    client.on('notification', msg => this.handleNotification(msg.channel, msg.payload));
    client.on('error', err => {
      console.error('[realtime] listener error:', err.message);
      this.handleConnectionLoss(client);
    });
    client.on('end', () => this.handleConnectionLoss(client));
    await client.connect();
    this.client = client;
    this.reconnectAttempts = 0;
    return client;
  }

  private async listen(pgChannel: string): Promise<void> {
    const existing = this.listenPromises.get(pgChannel);
    if (existing) return existing;
    const promise = this.ensureClient()
      .then(client => client.query(`LISTEN ${quoteIdentifier(pgChannel)}`))
      .then(() => undefined)
      .catch(err => {
        this.listenPromises.delete(pgChannel);
        throw err;
      });
    this.listenPromises.set(pgChannel, promise);
    await promise;
  }

  private async unlisten(pgChannel: string): Promise<void> {
    this.listenPromises.delete(pgChannel);
    try {
      const client = await this.ensureClient();
      await client.query(`UNLISTEN ${quoteIdentifier(pgChannel)}`);
    } catch (err) {
      if (!this.stopped) {
        console.error('[realtime] UNLISTEN failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  private handleNotification(pgChannel: string, rawPayload?: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(rawPayload ?? 'null');
    } catch (err) {
      console.error('[realtime] malformed NOTIFY payload ignored:', err instanceof Error ? err.message : err);
      return;
    }
    if (!isQueueChangedEvent(payload)) {
      console.error('[realtime] invalid NOTIFY payload ignored');
      return;
    }

    const logicalChannels = this.logicalChannelsForNotification(pgChannel, payload);
    for (const logicalChannel of logicalChannels) {
      const handlers = this.handlers.get(logicalChannel);
      if (!handlers) continue;
      for (const handler of [...handlers]) {
        try {
          handler(payload);
        } catch (err) {
          console.error('[realtime] subscriber handler failed:', err instanceof Error ? err.message : err);
        }
      }
    }
  }

  private logicalChannelsForNotification(pgChannel: string, payload: QueueChangedEvent): string[] {
    if (payload.eventId && payload.areaId) {
      const logicalChannel = queueChannel(payload.eventId, payload.areaId);
      return pgChannelFor(logicalChannel) === pgChannel ? [logicalChannel] : [];
    }
    return [...(this.pgChannels.get(pgChannel) ?? [])];
  }

  private handleConnectionLoss(client: Client): void {
    if (this.client !== client) return;
    this.client = undefined;
    this.connectPromise = undefined;
    this.listenPromises.clear();
    client.removeAllListeners();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || this.pgChannels.size === 0) return;
    const base = Math.min(INITIAL_RECONNECT_MS * 2 ** this.reconnectAttempts, MAX_RECONNECT_MS);
    const jitter = Math.floor(Math.random() * Math.min(250, base));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.reconnect();
    }, base + jitter);
  }

  private async reconnect(): Promise<void> {
    if (this.stopped || this.pgChannels.size === 0) return;
    try {
      await this.ensureClient();
      await Promise.all([...this.pgChannels.keys()].map(pgChannel => this.listen(pgChannel)));
      this.reconnectAttempts = 0;
      this.rebroadcastLocalSubscribers();
    } catch (err) {
      console.error('[realtime] reconnect failed:', err instanceof Error ? err.message : err);
      this.scheduleReconnect();
    }
  }

  private rebroadcastLocalSubscribers(): void {
    const at = new Date().toISOString();
    for (const [logicalChannel, handlers] of this.handlers) {
      const { eventId, areaId } = parseQueueChannel(logicalChannel);
      const payload: QueueChangedEvent = { type: 'queue:changed', eventId, areaId, at };
      for (const handler of [...handlers]) {
        try {
          handler(payload);
        } catch (err) {
          console.error('[realtime] reconnect rebroadcast handler failed:', err instanceof Error ? err.message : err);
        }
      }
    }
  }
}

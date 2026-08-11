import {
  PROTOCOL_VERSION,
  WsEventSchema,
} from '@polymarket-btc/shared';

export const protocolVersion = PROTOCOL_VERSION;
const CLIENT_COMMAND_TYPES = new Set([
  'HELLO', 'AUTH', 'SNAPSHOT_REQUEST', 'ARM_LIVE', 'DISARM_LIVE', 'SELECT_MARKET',
  'SUBSCRIBE_MARKET', 'PAGE_ANCHOR_UPDATE', 'REQUEST_QUOTES', 'PLACE_ORDER_INTENT',
  'PLACE_ORDER', 'CANCEL_ORDER', 'CANCEL_ALL', 'UPDATE_PRESETS', 'UPDATE_SIZE_PRESETS',
  'UPDATE_SETTINGS', 'RECONCILE', 'PING',
]);
const SERVER_EVENT_TYPES = new Set([
  'HELLO_ACK', 'AUTH_OK', 'AUTH_ERROR', 'TERMINAL_SNAPSHOT', 'SNAPSHOT',
  'READINESS_UPDATED', 'MARKET_UPDATE', 'MARKET_UPDATED', 'DISCOVERY_UPDATE',
  'REFERENCE_UPDATED', 'RTDS_UPDATE', 'RTDS_STATUS', 'EXECUTABLE_QUOTES_UPDATED',
  'ACCOUNT_UPDATED', 'ORDER_RESULT', 'ORDER_UPDATE', 'ORDER_UPDATED', 'FILL_UPDATED',
  'POSITION_UPDATED', 'SETTINGS_UPDATED', 'PROTOCOL_ERROR', 'ERROR',
]);
const ENVELOPE_KEYS = new Set(['protocolVersion', 'id', 'type', 'payload', 'error']);

export type ClientCommand = {
  protocolVersion: typeof protocolVersion;
  id: string;
  type: string;
  payload?: unknown;
};

export type ProtocolEvent = { protocolVersion: typeof protocolVersion; id?: string; type: string; payload?: any; error?: string };
export type ParsedServerEvent = { event: ProtocolEvent; revision: number | null };
type ParseResult<T> = { success: true; data: T } | { success: false; error: string };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const extractRevision = (message: Record<string, unknown>): number | null => {
  const payload = message.payload;
  if (!isRecord(payload)) return null;
  const revision = payload.revision;
  return Number.isSafeInteger(revision) && Number(revision) >= 0 ? Number(revision) : null;
};

export function createClientCommand(input: unknown): ParseResult<ClientCommand> {
  if (!isRecord(input) || typeof input.type !== 'string') {
    return { success: false, error: 'Command must be an object with a type.' };
  }
  const candidate = {
    protocolVersion,
    id: typeof input.id === 'string' && input.id ? input.id : crypto.randomUUID(),
    type: input.type,
    ...(Object.prototype.hasOwnProperty.call(input, 'payload') ? { payload: input.payload } : {}),
  };
  if (!CLIENT_COMMAND_TYPES.has(candidate.type)) {
    return { success: false, error: `Unsupported command: ${candidate.type}` };
  }
  if (!WsEventSchema.safeParse(candidate).success) {
    return { success: false, error: `Invalid ${candidate.type} command payload.` };
  }
  return { success: true, data: candidate };
}

export function parseServerEvent(raw: unknown): ParseResult<ParsedServerEvent> {
  let message: unknown = raw;
  if (typeof raw === 'string') {
    try { message = JSON.parse(raw); }
    catch { return { success: false, error: 'Backend sent invalid JSON.' }; }
  }
  if (!isRecord(message)) return { success: false, error: 'Backend event must be an object.' };

  if (Object.keys(message).some(key => !ENVELOPE_KEYS.has(key))) {
    return { success: false, error: 'Backend event contains unsupported envelope fields.' };
  }
  if (message.protocolVersion !== protocolVersion || typeof message.type !== 'string' || (message.id !== undefined && typeof message.id !== 'string')) {
    const received = message.protocolVersion;
    return { success: false, error: received === undefined
      ? 'Backend event is missing a protocol version.'
      : `Backend protocol ${String(received)} is incompatible with extension protocol ${protocolVersion}.` };
  }
  if (!SERVER_EVENT_TYPES.has(message.type)) {
    return { success: false, error: `Unsupported backend event: ${message.type}` };
  }
  const detailed = WsEventSchema.safeParse(message);
  if (!detailed.success) return { success: false, error: `Invalid ${message.type} backend payload.` };
  return { success: true, data: { event: detailed.data as ProtocolEvent, revision: extractRevision(message) } };
}

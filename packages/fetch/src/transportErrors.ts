import { type ErrorKind, errorKindOf } from 'newspa-core';
import type { TransportFailureReason } from './transportTypes.ts';

/**
 * A thrown cause becomes a **named** fault. This is where "network error" as one
 * string would be a lie: a DNS failure, a refused port, an expired certificate
 * and a stalled body need different answers from the reader (wait, fix the URL,
 * fix the clock/trust store, raise the timeout), and `HealthState` cannot say
 * them if the transport collapses them.
 *
 * Node's `fetch` wraps every one of these in `TypeError: fetch failed`, so the
 * only facts left are on the `cause` chain: `error.code`, `errno`, `name`. That
 * is what this file reads. It is also why this file exists: core's
 * `errorKindOf` reads the message of the error it is handed, so given undici's
 * wrapper it returns `'network'` for a certificate failure. The chain walk here
 * is what makes D-020's "'tls' by name" true in practice.
 */

/** Certificate and protocol failures: the machine's trust store, not the network. */
const TLS_CODES: readonly string[] = [
  'CERT_UNTRUSTED',
  'CERT_HAS_EXPIRED',
  'CERT_REVOCKED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNKNOWN_CA',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_PROTOCOL_VERSION_EXISTS',
  'ERR_SSL_PROTOCOL_ERROR',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC',
  'WRONG_VERSION_NUMBER',
];

/** The name never resolved, so no connection was attempted. */
const DNS_CODES: readonly string[] = ['ENOTFOUND', 'EAI_AGAIN', 'ENOENT'];

/** A connection was attempted and did not produce a response. */
const CONNECT_CODES: readonly string[] = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'ENOTSOCK',
  'EPIPE',
  'EPROTO',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_DESTROYED',
  'UND_ERR_ABORTED',
];

/** The server accepted the connection and then did not answer in time. */
const TIMEOUT_CODES: readonly string[] = ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'];

const TLS_WORDS = /certificate|self[- ]signed|cert|ssl|tls|altname|revoked|ca |untrusted/i;
const DNS_WORDS = /enotfound|eai-again|getaddrinfo/i;
const CONNECT_WORDS = /econnrefused|econnreset|connection (refused|reset|closed)|socket hang up|fetch failed|network/i;
const TIMEOUT_WORDS = /timeout|timed out|aborted/i;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const fieldOf = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
};

/** The `cause` chain, outermost first, bounded so a cycle cannot hang the poll. */
const causeChain = (cause: unknown, limit = 5): Record<string, unknown>[] => {
  const chain: Record<string, unknown>[] = [];
  let current: unknown = cause;
  for (let depth = 0; depth < limit; depth += 1) {
    const record = asRecord(current);
    if (record === null) break;
    chain.push(record);
    current = record['cause'];
  }
  return chain;
};

const collect = (chain: readonly Record<string, unknown>[], key: string): string[] =>
  chain.map((record) => fieldOf(record, key)).filter((value) => value.length > 0);

const firstMatch = (values: readonly string[], list: readonly string[]): string | null => {
  for (const value of values) {
    const upper = value.toUpperCase();
    for (const name of list) {
      if (upper === name) return name;
    }
  }
  return null;
};

const anyWord = (values: readonly string[], pattern: RegExp): boolean => values.some((value) => pattern.test(value));

export interface CauseInfo {
  readonly errorKind: ErrorKind;
  readonly reason: TransportFailureReason;
  readonly detail: string;
  readonly notes: readonly string[];
}

const info = (
  errorKind: ErrorKind,
  reason: TransportFailureReason,
  detail: string,
  codes: readonly string[],
  names: readonly string[],
): CauseInfo => ({
  errorKind,
  reason,
  // The codes are the most actionable fact a Node `fetch` failure leaves behind,
  // so they go in the sentence, not only in the notes: "network error" is what a
  // reader cannot act on, "ECONNREFUSED" and "ENOTFOUND" are what they can.
  detail: codes.length === 0 ? detail : `${detail} [cause code ${codes.join(', ')}]`,
  notes: [
    `cause codes: ${codes.length === 0 ? 'none reported' : codes.join(', ')}`,
    `error names: ${names.length === 0 ? 'none' : names.join(', ')}`,
  ],
});

/**
 * `fetch failed` is undici's wrapper on every transport failure, and it carries
 * no information: the sentence the reader needs is on the `cause`. So the first
 * message that is not the wrapper is the one quoted.
 */
const informativeMessage = (messages: readonly string[]): string => {
  const spoken = messages.find((message) => message.trim().toLowerCase() !== 'fetch failed');
  if (spoken !== undefined) return spoken;
  return messages[0] ?? '';
};

/** The name of an abort reason: `AbortSignal.timeout` fires a `TimeoutError` DOMException. */
const abortReasonName = (signal: AbortSignal): string => {
  const record = asRecord(signal.reason);
  return record === null ? String(signal.reason) : fieldOf(record, 'name');
};

/**
 * Classify a thrown cause. `signal` decides a timeout: the request's own
 * `AbortSignal.timeout` is the authority on whether the clock ran out, and a
 * rejection can be a bare `TypeError` that says nothing about it.
 */
export const classifyThrown = (cause: unknown, signal: AbortSignal): CauseInfo => {
  const chain = causeChain(cause);
  const codes = [...collect(chain, 'code'), ...collect(chain, 'errno')];
  const names = collect(chain, 'name');
  const messages = collect(chain, 'message');
  const spoken = informativeMessage(messages);
  const top = spoken === '' ? (names[0] ?? String(cause)) : spoken;

  if (signal.aborted) {
    const name = abortReasonName(signal);
    if (name === 'AbortError') {
      return info('timeout', 'aborted', 'the request was aborted by a signal that is not ours', codes, names);
    }
    return info(
      'timeout',
      'timeout',
      `the request did not complete before its timeout (${name || 'no reason name'})`,
      codes,
      names,
    );
  }
  if (
    firstMatch(names, ['TimeoutError', 'HeadersTimeoutError', 'AbortError']) !== null ||
    anyWord(messages, TIMEOUT_WORDS)
  ) {
    return info('timeout', 'timeout', `${top}: the request did not complete in time`, codes, names);
  }
  if (firstMatch(codes, TLS_CODES) !== null || anyWord([...messages, ...codes], TLS_WORDS)) {
    return info('tls', 'tls', `${top}: a certificate/TLS failure, not a connectivity problem`, codes, names);
  }
  if (firstMatch(codes, DNS_CODES) !== null || anyWord([...messages, ...codes], DNS_WORDS)) {
    return info('network', 'network', `${top}: the host did not resolve`, codes, names);
  }
  if (firstMatch(codes, TIMEOUT_CODES) !== null) {
    return info('timeout', 'timeout', `${top}: the server accepted the connection and never answered`, codes, names);
  }
  if (firstMatch(codes, CONNECT_CODES) !== null || anyWord([...messages, ...codes], CONNECT_WORDS)) {
    return info('network', 'network', `${top}: the connection did not produce a response`, codes, names);
  }
  // Nothing named: core's own classifier is the last word, and for an
  // unrecognised cause its answer is `network` — the honest default, not a guess.
  return info(errorKindOf(cause), 'network', `${top}: the request failed before an HTTP response`, codes, names);
};

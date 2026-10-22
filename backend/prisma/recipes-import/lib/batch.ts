/** Wspólna obsługa Batch API (połowa ceny): wysłanie zadania, stan w out/, odbiór wyników */
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { ensureOut } from './files.js';

export interface BatchRequest {
  customId: string;
  params: Anthropic.Messages.MessageCreateParamsNonStreaming;
}

/** Ceny Batch API (USD za mln tokenów) - do raportu kosztu */
export const BATCH_PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-haiku-5-5': { input: 0.05, output: 0.25, cacheRead: 0.005, cacheWrite: 0.0625 },
  'claude-sonnet-5-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export async function submitBatch<S>(stateFile: string, requests: BatchRequest[], state: S): Promise<string> {
  if (existsSync(stateFile)) throw new Error(`Jest już wysłane zadanie (${stateFile}) - najpierw "fetch".`);
  const client = new Anthropic();
  const batch = await client.messages.batches.create({
    requests: requests.map((r) => ({ custom_id: r.customId, params: r.params })),
  });
  ensureOut();
  writeFileSync(stateFile, JSON.stringify({ id: batch.id, state }, null, 1));
  return batch.id;
}

export interface BatchUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function usageCost(model: string, u: BatchUsage): number {
  const p = BATCH_PRICES[model];
  if (!p) return NaN;
  return (
    (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6
  );
}

/**
 * Wyniki zakończonego zadania: tekst odpowiedzi dla każdego customId (null = błąd).
 * Zwraca null, gdy zadanie jeszcze trwa. Po odbiorze plik stanu dostaje dopisek ".done".
 */
export async function fetchBatch<S>(
  stateFile: string,
): Promise<{ state: S; results: Map<string, string | null>; usage: BatchUsage } | null | 'none'> {
  if (!existsSync(stateFile)) return 'none';
  const { id, state } = JSON.parse(readFileSync(stateFile, 'utf8')) as { id: string; state: S };
  const client = new Anthropic();
  const batch = await client.messages.batches.retrieve(id);
  if (batch.processing_status !== 'ended') {
    const c = batch.request_counts;
    console.log(`W toku: ${c.processing} w trakcie, ${c.succeeded} gotowe, ${c.errored} błędy.`);
    return null;
  }
  const results = new Map<string, string | null>();
  const usage: BatchUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for await (const r of await client.messages.batches.results(id)) {
    if (r.result.type !== 'succeeded') {
      results.set(r.custom_id, null);
      continue;
    }
    const msg = r.result.message;
    usage.input += msg.usage.input_tokens;
    usage.output += msg.usage.output_tokens;
    usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += msg.usage.cache_creation_input_tokens ?? 0;
    const text = msg.content.find((b) => b.type === 'text');
    results.set(r.custom_id, msg.stop_reason === 'max_tokens' ? null : (text?.text ?? null));
  }
  renameSync(stateFile, `${stateFile}.${id}.done`);
  return { state, results, usage };
}

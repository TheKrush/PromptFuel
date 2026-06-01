import type { SnapshotBucketModel, SnapshotHistoryBucket } from './types';

const BUCKET_NUMERIC_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheCreationTokens',
  'cacheReadTokens',
  'reasoningOutputTokens',
  'requests',
  'messages',
  'turns'
] as const;

type BucketNumericField = typeof BUCKET_NUMERIC_FIELDS[number];

function copyNonNegativeNumber(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    target[key] = value;
  }
}

export function cloneSnapshotBucketModel(model: SnapshotBucketModel): SnapshotBucketModel | undefined {
  if (!model.model || typeof model.model !== 'string') {
    return undefined;
  }

  const cloned: SnapshotBucketModel = { model: model.model };
  for (const field of BUCKET_NUMERIC_FIELDS) {
    copyNonNegativeNumber(cloned as unknown as Record<string, unknown>, field, model[field]);
  }
  return cloned;
}

export function cloneSnapshotHistoryBucket(bucket: SnapshotHistoryBucket): SnapshotHistoryBucket | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bucket.dateKey)) {
    return undefined;
  }

  const cloned: SnapshotHistoryBucket = { dateKey: bucket.dateKey };
  for (const field of BUCKET_NUMERIC_FIELDS) {
    copyNonNegativeNumber(cloned as unknown as Record<string, unknown>, field, bucket[field]);
  }
  if (typeof bucket.sourceConfidence === 'string' && bucket.sourceConfidence) {
    cloned.sourceConfidence = bucket.sourceConfidence;
  }

  const models = (bucket.models ?? [])
    .map(model => cloneSnapshotBucketModel(model))
    .filter((model): model is SnapshotBucketModel => model !== undefined);
  if (models.length > 0) {
    cloned.models = models;
  }

  return cloned;
}

export function historyBucketCompletenessScore(bucket: SnapshotHistoryBucket): number {
  let score = 0;
  for (const field of BUCKET_NUMERIC_FIELDS) {
    if (typeof bucket[field as BucketNumericField] === 'number') {
      score += 2;
    }
  }
  if (typeof bucket.sourceConfidence === 'string' && bucket.sourceConfidence) {
    score += 1;
  }
  for (const model of bucket.models ?? []) {
    if (model.model) {
      score += 4;
    }
    for (const field of BUCKET_NUMERIC_FIELDS) {
      if (typeof model[field as BucketNumericField] === 'number') {
        score += 1;
      }
    }
  }
  return score;
}

export function shouldReplaceHistoryBucket(
  existing: SnapshotHistoryBucket,
  incoming: SnapshotHistoryBucket
): boolean {
  return historyBucketCompletenessScore(incoming) >= historyBucketCompletenessScore(existing);
}

export function mergeHistoryBucketsByDate(
  existingBuckets: ReadonlyArray<SnapshotHistoryBucket>,
  incomingBuckets: ReadonlyArray<SnapshotHistoryBucket>
): SnapshotHistoryBucket[] {
  const byDate = new Map<string, SnapshotHistoryBucket>();

  for (const bucket of existingBuckets) {
    const cloned = cloneSnapshotHistoryBucket(bucket);
    if (cloned) {
      byDate.set(cloned.dateKey, cloned);
    }
  }

  for (const bucket of incomingBuckets) {
    const cloned = cloneSnapshotHistoryBucket(bucket);
    if (!cloned) {
      continue;
    }
    const existing = byDate.get(cloned.dateKey);
    if (!existing || shouldReplaceHistoryBucket(existing, cloned)) {
      byDate.set(cloned.dateKey, cloned);
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export type ReadResultStatus = 'ok' | 'not-found' | 'no-data' | 'error';

export interface ReadResult {
  providerId: string;
  status: ReadResultStatus;
  filesFound?: number;
  detail?: string;
}

export interface ProviderReader {
  readonly providerId: string;
  read(): Promise<ReadResult>;
}

export type ProviderId = 'claude' | 'codex';

export const KNOWN_PROVIDERS: ReadonlyArray<ProviderId> = ['claude', 'codex'];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

export const PROVIDER_INITIALS: Record<ProviderId, string> = {
  claude: 'C',
  codex: 'X',
};

export function isKnownProvider(id: string): id is ProviderId {
  return (KNOWN_PROVIDERS as ReadonlyArray<string>).includes(id);
}

/**
 * Aktualne wersje dokumentów prawnych (data wejścia w życie, jak w treści dokumentu na froncie).
 * Zmiana wersji = zalogowani dostają prośbę o akceptację nowej wersji (`GET /api/me/legal`).
 */
export const TERMS_VERSION = '2026-10-20';
export const PRIVACY_POLICY_VERSION = '2026-10-20';

export const LEGAL_DOCUMENTS = [
  { type: 'TERMS', version: TERMS_VERSION },
  { type: 'PRIVACY_POLICY', version: PRIVACY_POLICY_VERSION },
] as const;

export type LegalDocumentType = (typeof LEGAL_DOCUMENTS)[number]['type'];

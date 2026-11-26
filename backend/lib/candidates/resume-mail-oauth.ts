import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptToken } from '@/backend/lib/mail/token-crypto';
import { ZOHO_MAIL_SCOPES, zohoApps, zohoTaskCallbackUrl, callbackUrl, postZohoToken, trustedZohoAccounts } from '@/backend/lib/mail/oauth';
import { ZohoMailService, type ZohoMailGrant } from '@/backend/services/zohoMailService';
import { CandidateActionError } from './records';
import { MAIL_CONNECTIONS, mailDb } from './resume-mail';

const STATES = 'candidate_resume_mail_oauth';
/** 32 random bytes as base64url is always 43 chars (Task Manager uses 24 bytes / 32 chars). */
export const isResumeMailOAuthState = (state: string) => /^[A-Za-z0-9_-]{43}$/.test(state);
export function recruitmentAccountsServer(value: string): { server: string; dc: string } {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!trustedZohoAccounts(normalized)) throw new CandidateActionError(400, 'Zoho returned an unsupported accounts server. Start the connection again.');
  return { server: normalized, dc: normalized.slice('https://accounts.zoho.'.length) };
}
function credentials(id?: string) {
  const app = zohoApps().find(a => id ? a.clientId === id : a.prefix !== 'ZOHO_MAIL');
  if (!app || !process.env.MAIL_TOKEN_KEY?.trim()) {
    throw new CandidateActionError(503, 'Zoho Mail needs ZOHO_CLIENT_ID (or ZOHO_MAIL_APP_CLIENT_ID), its secret, and MAIL_TOKEN_KEY on the server.');
  }
  return app;
}
export async function connectRecruitmentMailbox(db: SupabaseClient, orgId: string, userId: string, requestUrl: string, allowSend: boolean, reconnect: boolean) {
  if (!reconnect) {
    let query = db.from(MAIL_CONNECTIONS).select('address').eq('organization_id', orgId).not('refresh_token_enc', 'is', null);
    if (allowSend) query = query.eq('can_send', true);
    const { data, error } = await query.limit(1).maybeSingle();
    mailDb(error);
    if (data) return { connected: true, address: String(data.address) };
  }
  return startResumeMailOAuth(db, orgId, userId, requestUrl, allowSend);
}
export async function startResumeMailOAuth(db: SupabaseClient, orgId: string, userId: string, requestUrl: string, allowSend = false) {
  const { clientId, prefix } = credentials();
  const dc = (process.env.ZOHO_MAIL_APP_DC || process.env.ZOHO_MAIL_DC || 'com').trim();
  const { server } = recruitmentAccountsServer(`https://accounts.zoho.${dc}`);
  const origin = new URL(requestUrl).origin;
  const redirectUri = process.env.RECRUITMENT_ZOHO_REDIRECT_URL?.trim() || (prefix === 'ZOHO' ? origin + '/api/auth/zoho/callback'
    : prefix === 'ZOHO_MAIL_APP' ? callbackUrl(requestUrl) : zohoTaskCallbackUrl(requestUrl));
  const callback = URL.canParse(redirectUri) ? new URL(redirectUri) : null;
  const supportedPaths = ['/api/auth/zoho/callback', '/api/task-manager/zoho/callback', '/api/agents/mail/callback', '/api/candidates/resume-mail/callback'];
  if (!callback || !['https:', 'http:'].includes(callback.protocol) || callback.username || callback.password || callback.search || callback.hash || !supportedPaths.includes(callback.pathname)) {
    throw new CandidateActionError(503, 'Set RECRUITMENT_ZOHO_REDIRECT_URL to a registered callback for this app.');
  }
  if (callback.origin !== origin) throw new CandidateActionError(409, 'Open Recruitment at ' + callback.origin + ' to connect the shared mailbox using the registered Zoho callback.');
  const state = randomBytes(32).toString('base64url');
  const result = await db.from(STATES).insert({ state, organization_id: orgId, created_by: userId, oauth_client_id: clientId, redirect_uri: redirectUri, dc,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), ...(allowSend ? { requested_send: true } : {}) });
  if (allowSend && result.error && /requested_send/.test(result.error.message)) throw new CandidateActionError(503, 'Sending email needs the Stage 3 database update: run 20261122000003_recruitment_email.sql.');
  mailDb(result.error);
  const url = new URL(`${server}/oauth/v2/auth`);
  url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: ZOHO_MAIL_SCOPES + (allowSend ? ',ZohoMail.messages.CREATE' : ''),
    redirect_uri: redirectUri, access_type: 'offline', prompt: 'consent', state }).toString();
  return { url: url.toString() };
}
export async function resumeMailOAuthState(db: SupabaseClient, state: string) {
  if (!isResumeMailOAuthState(state)) throw new CandidateActionError(400, 'Start a new connection from Recruitment.');
  const { data, error } = await db.from(STATES).select('*')
    .eq('state', state).is('consumed_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  mailDb(error);
  if (!data) throw new CandidateActionError(400, 'This connection link expired or was already used. Start again from Recruitment.');
  return data as { organization_id: string; created_by: string; redirect_uri: string; dc: string; expires_at: string; oauth_client_id?: string; requested_send?: boolean };
}
export async function finishResumeMailOAuth(db: SupabaseClient, state: string, user: { id: string; email: string | null }, code: string, accountsServer?: string,
  io = { fetch, addresses: (g: ZohoMailGrant) => ZohoMailService.listAddressesWithGrant(g) }) {
  const st = await resumeMailOAuthState(db, state);
  if (st.created_by !== user.id) throw new CandidateActionError(403, 'Complete this connection using the account that started it.');
  if (!code || code.length > 2048) throw new CandidateActionError(400, 'Zoho did not return a valid connection code.');
  const { server, dc } = recruitmentAccountsServer(accountsServer || `https://accounts.zoho.${st.dc}`);
  if (!st.oauth_client_id) throw new CandidateActionError(409, 'Start a new mailbox connection so the correct Zoho application can be verified.');
  const { clientId, clientSecret } = credentials(st.oauth_client_id);
  const claimed = await db.from(STATES).update({ consumed_at: new Date().toISOString() })
    .eq('state', state).eq('created_by', user.id).is('consumed_at', null).gt('expires_at', new Date().toISOString()).select('state');
  mailDb(claimed.error);
  if (!claimed.data?.length) throw new CandidateActionError(409, 'This connection link was already used. Start again.');
  const tokenEndpoint = `${server}/oauth/v2/token`;
  const form = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: st.redirect_uri });
  const response = await postZohoToken(tokenEndpoint, form, io.fetch);
  const text = await response.text();
  let token: { refresh_token?: string; scope?: string } | null = null;
  try { token = JSON.parse(text); } catch { token = null; }
  if (!response.ok || typeof token?.refresh_token !== 'string' || !token.refresh_token) {
    throw new CandidateActionError(502, 'Zoho did not grant lasting mailbox access. Start again and approve the requested mail permissions. Check the registered callback URL if this repeats.');
  }
  const addresses = [...new Set((await io.addresses({ refreshToken: token.refresh_token, dc, clientId, clientSecret })).map(a => a.toLowerCase()))];
  if (!addresses.length) throw new CandidateActionError(400, 'Zoho did not provide an accessible mailbox.');
  // One consent can cover aliases; each is offered as a separate mailbox and requires its own folder setup.
  for (const address of addresses) {
    const existing = await db.from(MAIL_CONNECTIONS).select('id, refresh_token_enc').eq('organization_id', st.organization_id).eq('address', address).maybeSingle();
    mailDb(existing.error);
    const values = { oauth_client_id: clientId, refresh_token_enc: encryptToken(token.refresh_token), dc, addresses,
      ...(st.requested_send !== undefined ? { can_send: st.requested_send && (!token.scope || /ZohoMail\.messages\.(CREATE|ALL)(?:\s|,|$)/.test(String(token.scope))) } : {}),
      connected_by: user.id, connected_email: user.email, last_error: null };
    const saved = existing.data
      ? await db.from(MAIL_CONNECTIONS).update({ ...values, ...(!existing.data.refresh_token_enc ? { active: true } : {}) }).eq('id', existing.data.id).eq('organization_id', st.organization_id)
        .or(`lock_until.is.null,lock_until.lt.${new Date().toISOString()}`).select('id')
      : await db.from(MAIL_CONNECTIONS).insert({ ...values, organization_id: st.organization_id, address }).select('id');
    mailDb(saved.error);
    if (!saved.data?.length) throw new CandidateActionError(409, 'This mailbox is importing. Wait for it to finish and connect again.');
  }
  return { connected: addresses.length };
}

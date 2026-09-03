import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import {
    AGENT_CREDENTIAL_PURPOSES,
    AGENT_RUNTIME_MIGRATION,
    isNotProvisionedError,
    type AgentCredentialPurpose,
} from '@/frontend/types/agentRuntime';
import {
    CREDENTIAL_ENV_NAMES,
    LEGACY_STORED_SECRET_REASON,
    SECRET_PASTE_REFUSAL,
    SECRET_PASTE_SUPPORTED,
    describeAllowedSecretRefs,
    envPresent,
    isCredentialEnvRef,
} from './secretStore';

/**
 * AGENT CREDENTIALS — per-agent LLM / voice / WhatsApp / telephony keys.
 *
 * ############################################################################
 * # THREAT MODEL. Read before changing anything in this file.
 * ############################################################################
 *
 * WHAT IS BEING PROTECTED
 *   Provider API keys that can spend the customer's money (LLM inference,
 *   outbound voice minutes, WhatsApp sends) and, in the telephony case, place
 *   calls from the customer's own number. A leaked key here is a billing
 *   incident and a reputational one.
 *
 * WHO THE ADVERSARY IS
 *   1. A logged-in member of ANOTHER organisation, probing ?orgId= with an id
 *      they do not own.
 *   2. A logged-in member of THIS organisation without admin standing, trying
 *      to read a key they may legitimately see the EXISTENCE of but not the
 *      VALUE of. A staff account that can read the key can exfiltrate it.
 *   3. Anyone who later obtains a database dump or a read replica.
 *   4. A future maintainer who adds `?reveal=true` because a form needed to
 *      pre-fill. That is the most likely of the four, which is why this comment
 *      is long.
 *
 * THE FOUR CONTROLS
 *
 *   (a) GET NEVER RETURNS A SECRET. Not decrypted, not encrypted, not
 *       base64-of-encrypted. There is no query parameter, header or body that
 *       makes it. The select list is an explicit ALLOWLIST (SAFE_COLUMNS) that
 *       does not contain secret_enc, so a column added to the table tomorrow
 *       cannot leak by default. There is no decrypt function in this file, and
 *       none in ./secretStore either — see (e). The only value resolver is
 *       readAgentSecret(), for server-side callers; do not import it here, and
 *       do not return a value derived from it.
 *
 *   (b) TENANCY IS ENFORCED IN CODE, NOT BY RLS. oem_agent_credentials has RLS
 *       enabled with NO permissive policy and its grants revoked from anon and
 *       authenticated, so the user-scoped client sees nothing at all. This
 *       route therefore reads through the SERVICE ROLE, which bypasses RLS
 *       entirely — meaning the membership check below is the ONLY thing holding
 *       the tenancy line. It is not defence in depth here; it is the defence.
 *       Do not remove it, and do not add a route under this path that skips it.
 *
 *   (c) LEAST PRIVILEGE ON WRITE. Reading the masked shape needs org
 *       membership. Writing or deleting a credential needs an org-admin role.
 *       Anyone can see THAT the LLM key is configured; only an admin can change
 *       whose key it is.
 *
 *   (d) THE ONLY STORAGE SHAPE IS secret_ref. A credential holds the NAME of a
 *       server environment variable ('BOLNA_API_KEY'), never a value. The
 *       secret never enters the database, a backup, or a replica.
 *
 *   (e) A PASTED SECRET IS REFUSED, WITH A REASON. See below.
 *
 * ---------------------------------------------------------------------------
 * WHY PASTING A KEY IS NO LONGER OFFERED
 *
 * This route used to accept a pasted secret, encrypt it (AES-256-GCM, key from
 * AGENT_SECRET_KEY) and write the frame to secret_enc. The problem was not the
 * cipher. It was that NOTHING COULD SPEND THE RESULT: the agent LLM path is
 * councilChat() in backend/lib/council/llm.ts, which reads
 * `process.env.OPENAI_API_KEY` and takes no per-agent key, and no other agent
 * execution path here accepts one either. So a pasted key bought the operator a
 * green "configured" chip and an agent that still failed with llm_key_missing.
 *
 * Adding a decryptor did not fix that; it only moved the unused half. The fix
 * is to stop making the claim: storage is gone, `secret` is a 400 with the
 * reason quoted to the operator, and `configured` now means one checkable
 * thing — THE NAMED ENVIRONMENT VARIABLE IS PRESENT ON THIS SERVER.
 *
 * A legacy row that still carries secret_enc is reported as configured:false
 * with `unreadable_reason`, because that is the truth: nothing can read it.
 * Its ciphertext is cleared the next time an admin writes that credential.
 *
 * To bring per-agent keys back for real, do it in this order: give the
 * execution path a key argument, wire readAgentSecret() into it, then re-open
 * storage here. The reverse order is what produced the state described above.
 * ---------------------------------------------------------------------------
 *
 * Endpoints
 *   GET    /api/agents/credentials?orgId=&agentKey=&purpose=
 *   PUT    /api/agents/credentials?orgId=   body { agentKey, purpose, provider?,
 *                                                  secret_ref?, meta? }
 *   DELETE /api/agents/credentials?orgId=&agentKey=&purpose=
 */

export const dynamic = 'force-dynamic';

/**
 * ALLOWLIST. The only columns that may ever leave this route.
 * secret_enc is absent and must stay absent. Adding a column to the table does
 * not add it here — that is the point of an allowlist over `select('*')`.
 */
const SAFE_COLUMNS =
    'id, organization_id, agent_key, purpose, provider, secret_ref, last4, meta, updated_by, updated_at, created_at';

/** Roles that may CHANGE a credential. Reading the masked shape needs only membership. */
const CREDENTIAL_WRITE_ROLES = ['org_super_admin', 'master_admin', 'org_admin'];

/**
 * secret_ref names are bounded by a CLOSED ALLOWLIST in ./secretStore, not by a
 * shape pattern.
 *
 * `env_present` reports whether a named variable is set on this server. Over an
 * arbitrary caller-supplied name that is an existence oracle across the whole
 * process environment for any org admin: probe SUPABASE_SERVICE_ROLE_KEY, then
 * STRIPE_SECRET_KEY, then an internal hostname, and fifty requests later you
 * have a map of the deployment. The value was never returned, but "which
 * secrets does this server hold" is itself worth not answering.
 *
 * So the allowlist bounds both sides: a name outside it is refused at WRITE
 * time with a 400 (never answered with a boolean), and envPresent() returns
 * null — "not answered" — for anything else, including legacy rows written
 * before the allowlist existed.
 *
 * The same closed set bounds readAgentSecret(), so a name this route accepts is
 * exactly a name agent execution can resolve. If the two ever disagreed,
 * `configured: true` would go back to being a lie.
 *
 * This pattern is NOT that allowlist. It is only used to catch an operator
 * pasting a variable NAME into the secret box, which is a different mistake.
 */
const ENV_NAME_SHAPE = /^[A-Z][A-Z0-9_]{1,63}$/;

const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** The accepted names, and which slot each fits — echoed so the console never
 *  has to invent one and an operator never has to guess. Not secret. */
function acceptedRefsFor(purpose: AgentCredentialPurpose | null) {
    const all = describeAllowedSecretRefs();
    return purpose ? all.filter((r) => r.purposes.includes(purpose)) : all;
}

function notProvisioned(extra: Record<string, unknown> = {}) {
    return NextResponse.json(
        {
            provisioned: false,
            migration: AGENT_RUNTIME_MIGRATION,
            reason: `Agent credentials are not set up yet — apply ${AGENT_RUNTIME_MIGRATION}.sql.`,
            credentials: [],
            ...extra,
        },
        { status: 200 },
    );
}

function readOrgId(request: NextRequest, body?: Record<string, unknown>): string | null {
    const sp = new URL(request.url).searchParams;
    return (
        sp.get('orgId') || sp.get('org_id') || sp.get('organization_id') ||
        (body?.orgId as string) || (body?.organization_id as string) || null
    );
}

/* ---------------------------------------------------------------------------
 * ACCESS. Control (b) and (c) of the threat model. The service-role client
 * below bypasses RLS, so this function is the entire tenancy boundary.
 * ------------------------------------------------------------------------- */
interface CredentialAccess {
    userId: string;
    roles: string[];
    canWrite: boolean;
}

async function resolveAccess(
    orgId: string,
    need: 'read' | 'write',
): Promise<CredentialAccess | NextResponse> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [profileRes, orgRes, propRes] = await Promise.all([
        supabaseAdmin.from('users').select('is_master_admin').eq('id', user.id).maybeSingle(),
        supabaseAdmin.from('organization_memberships')
            .select('organization_id, role').eq('user_id', user.id).eq('is_active', true),
        supabaseAdmin.from('property_memberships')
            .select('organization_id, role').eq('user_id', user.id).eq('is_active', true),
    ]);

    const isMasterAdmin = !!profileRes.data?.is_master_admin;
    const memberships = [...(orgRes.data ?? []), ...(propRes.data ?? [])] as
        { organization_id: string | null; role: string | null }[];

    const inOrg = memberships.filter((m) => m.organization_id === orgId);
    const roles = [...new Set(inOrg.map((m) => m.role).filter(Boolean))] as string[];

    if (!isMasterAdmin && inOrg.length === 0) {
        // Same message for "wrong org" and "no such org": do not confirm that an
        // organisation id exists to someone who is not in it.
        return NextResponse.json(
            { error: 'Forbidden: no access to this organization' },
            { status: 403 },
        );
    }

    const canWrite = isMasterAdmin || roles.some((r) => CREDENTIAL_WRITE_ROLES.includes(r));
    if (need === 'write' && !canWrite) {
        return NextResponse.json(
            { error: 'Forbidden: changing agent credentials requires an organization admin role' },
            { status: 403 },
        );
    }

    return { userId: user.id, roles, canWrite };
}

function isAccessError(x: CredentialAccess | NextResponse): x is NextResponse {
    return x instanceof NextResponse;
}

/* ---------------------------------------------------------------------------
 * There is no cipher here and none in ./secretStore. A credential is an
 * environment-variable NAME, resolved server-side by readAgentSecret(); there is
 * nothing to encrypt because no value is ever stored — see control (e).
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * MASKING. The single place a stored row becomes a client-visible one.
 * ------------------------------------------------------------------------- */
function mask(row: Record<string, unknown>) {
    const secretRef = (row.secret_ref as string) ?? null;
    const last4 = (row.last4 as string) ?? null;
    const source: 'env' | 'stored' | null = secretRef ? 'env' : last4 ? 'stored' : null;

    const refAccepted = source === 'env' ? isCredentialEnvRef(secretRef) : null;
    const present = source === 'env' ? envPresent(secretRef) : null;

    // `configured` means ONE checkable thing: a value can actually be obtained
    // for this slot — the row names an accepted environment variable and that
    // variable is set on this server. It is deliberately NOT "a row exists".
    // A row whose ref is unset, or outside the allowlist, or which still holds a
    // legacy pasted key, resolves to null in readAgentSecret() and so reports
    // false here. The green chip and the runtime now agree by construction.
    const configured = refAccepted === true && present === true;

    const unreadableReason = configured
        ? null
        : source === 'stored'
            ? LEGACY_STORED_SECRET_REASON
            : refAccepted === false
                ? `${secretRef} is not an environment variable this feature reads, so nothing can resolve this credential.`
                : present === false
                    ? `Environment variable ${secretRef} is not set on this server.`
                    : null;

    return {
        id: row.id,
        agent_key: row.agent_key,
        purpose: row.purpose,
        provider: row.provider ?? null,
        configured,
        source,
        // The NAME of the env var, which is not a secret. Its value is not read.
        secret_ref: secretRef,
        // true / false only for an allowlisted name; null means NOT ANSWERED —
        // not "absent". The UI must render the two differently.
        env_present: present,
        // False on a legacy row whose secret_ref is outside the allowlist.
        env_ref_accepted: refAccepted,
        // Why `configured` is false on a row that plainly has something in it.
        // Silence here would send an operator hunting through logs.
        unreadable_reason: unreadableReason,
        last4,
        meta: (row.meta as Record<string, unknown>) ?? {},
        updated_at: row.updated_at,
        updated_by: row.updated_by ?? null,
        created_at: row.created_at,
    };
}

/* =========================================================================== */
/* GET — masked credential status. Never a secret.                             */
/* =========================================================================== */

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const orgId = readOrgId(request);
        if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

        const access = await resolveAccess(orgId, 'read');
        if (isAccessError(access)) return access;

        const agentKey = searchParams.get('agentKey') || searchParams.get('agent_key');
        const purpose = searchParams.get('purpose');

        let query = supabaseAdmin
            .from('oem_agent_credentials')
            .select(SAFE_COLUMNS)               // allowlist — see control (a)
            .eq('organization_id', orgId)       // tenancy — see control (b)
            .order('agent_key');
        if (agentKey) query = query.eq('agent_key', agentKey);
        if (purpose) query = query.eq('purpose', purpose);

        const { data, error } = await query;
        if (isNotProvisionedError(error)) return notProvisioned({ agent_key: agentKey });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const credentials = (data ?? []).map((r) => mask(r as unknown as Record<string, unknown>));

        // Which slots are still empty, so the sandbox can render the gaps rather
        // than making an operator diff two lists by eye.
        const configuredPurposes = new Set(credentials.filter((c) => c.configured).map((c) => c.purpose));
        const missing = agentKey
            ? AGENT_CREDENTIAL_PURPOSES.filter((p) => !configuredPurposes.has(p))
            : [];

        return NextResponse.json({
            provisioned: true,
            agent_key: agentKey,
            credentials,
            missing_purposes: missing,
            can_write: access.canWrite,
            // Said on every read so the recommended path is never a surprise at
            // write time. Control (d).
            recommended_source: 'env',
            guidance:
                'Store the NAME of a server environment variable (secret_ref). It is the only accepted shape: the secret never enters the database, a backup, or a replica, and "configured" then means the variable is actually set.',
            // The closed set of names that may be used as a secret_ref, so the
            // console can offer them instead of letting an operator type a name
            // that will be refused. These are names, not values.
            accepted_secret_refs: acceptedRefsFor(null),
            // Pasting is not a storage option here, and the console should hide
            // the box rather than let an operator type a key into a 400.
            paste_supported: SECRET_PASTE_SUPPORTED,
            paste_unsupported_reason: SECRET_PASTE_REFUSAL,
            // Stated explicitly so nobody goes looking for a flag that unlocks it.
            secrets_returned: false,
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

/* =========================================================================== */
/* PUT — set or update one credential.                                         */
/* =========================================================================== */

export async function PUT(request: NextRequest) {
    try {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const orgId = readOrgId(request, body);
        if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

        const access = await resolveAccess(orgId, 'write');
        if (isAccessError(access)) return access;

        const agentKey = typeof body.agentKey === 'string'
            ? body.agentKey.trim()
            : typeof body.agent_key === 'string' ? (body.agent_key as string).trim() : '';
        if (!agentKey) return NextResponse.json({ error: 'agentKey required' }, { status: 400 });

        const purpose = body.purpose as AgentCredentialPurpose;
        if (!AGENT_CREDENTIAL_PURPOSES.includes(purpose)) {
            return NextResponse.json(
                { error: `purpose must be one of ${AGENT_CREDENTIAL_PURPOSES.join(', ')}` },
                { status: 400 },
            );
        }

        const provider = typeof body.provider === 'string' ? body.provider.trim() || null : null;
        if (provider && !PROVIDER_PATTERN.test(provider)) {
            return NextResponse.json({ error: 'provider must be a short slug like "anthropic" or "bolna"' }, { status: 400 });
        }

        const secretRefRaw = typeof body.secret_ref === 'string' ? body.secret_ref.trim() : '';
        // `secret` per the console contract, `secret_plain` per OemAgentCredentialInput.
        const pastedSecret = typeof body.secret === 'string'
            ? body.secret
            : typeof body.secret_plain === 'string' ? (body.secret_plain as string) : '';

        // Control (e). Refused, not stored-and-ignored: a write that looks like
        // it succeeded but leaves a credential nothing can spend is exactly the
        // failure this route is being repaired from. The operator is told why,
        // and told what to send instead, in the same response.
        if (pastedSecret.trim()) {
            return NextResponse.json(
                {
                    error: SECRET_PASTE_REFUSAL,
                    recommended_source: 'env',
                    accepted_secret_refs: acceptedRefsFor(purpose).map((r) => r.name),
                    paste_supported: SECRET_PASTE_SUPPORTED,
                    stored: false,
                },
                { status: 400 },
            );
        }
        // THE ALLOWLIST. An arbitrary name is a 400 — never a boolean, never a
        // stored row. Two things ride on this: `env_present` stops being an
        // existence oracle over the whole server environment, and every name
        // this route accepts is one readAgentSecret() can actually resolve, so
        // the row it writes is not a green chip over a dead credential.
        if (secretRefRaw && !isCredentialEnvRef(secretRefRaw)) {
            const accepted = acceptedRefsFor(purpose);
            return NextResponse.json(
                {
                    error: ENV_NAME_SHAPE.test(secretRefRaw)
                        ? `${secretRefRaw} is not an environment variable this feature reads. Agent credentials may only reference a fixed set of names, so that a saved reference is one the runtime can actually resolve.`
                        : 'secret_ref must be an environment variable NAME, e.g. BOLNA_API_KEY — not the key itself.',
                    accepted_secret_refs: accepted.map((r) => r.name),
                    accepted_secret_refs_all: describeAllowedSecretRefs().map((r) => r.name),
                    stored: false,
                },
                { status: 400 },
            );
        }
        // Allowlisted, but normally used for a different slot. Not refused — an
        // org may legitimately use one vendor for two things — but said out loud,
        // because it is also exactly what a mis-click looks like.
        const refPurposeMismatch =
            secretRefRaw && !CREDENTIAL_ENV_NAMES[secretRefRaw]?.includes(purpose)
                ? `${secretRefRaw} is normally the ${CREDENTIAL_ENV_NAMES[secretRefRaw]?.join(' / ')} key, not the ${purpose} key. Saved as asked — check it is what you meant.`
                : null;

        // meta is NON-SECRET settings only: from_number, voice_id, agent_id,
        // base_url. It is merged, not replaced, so a partial form save does not
        // silently drop a field the operator set last week.
        const metaPatch = (body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta))
            ? (body.meta as Record<string, unknown>)
            : null;

        // Read the current row through the same allowlist. secret_enc is not
        // selected here either — this route never reads a stored secret at all,
        // only the non-secret markers that say whether one is lying around.
        const { data: existing, error: readError } = await supabaseAdmin
            .from('oem_agent_credentials')
            .select(SAFE_COLUMNS)
            .eq('organization_id', orgId)
            .eq('agent_key', agentKey)
            .eq('purpose', purpose)
            .maybeSingle();

        if (isNotProvisionedError(readError)) return notProvisioned({ credential: null });
        if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

        const existingRow = existing as unknown as Record<string, unknown> | null;

        const patch: Record<string, unknown> = {
            organization_id: orgId,
            agent_key: agentKey,
            purpose,
            updated_by: access.userId,
        };
        if (provider !== null) patch.provider = provider;
        if (metaPatch) {
            patch.meta = { ...((existingRow?.meta as Record<string, unknown>) ?? {}), ...metaPatch };
        }

        let sourceWritten: 'env' | 'unchanged' = 'unchanged';

        if (secretRefRaw) {
            patch.secret_ref = secretRefRaw;
            sourceWritten = 'env';
        }

        // Legacy ciphertext from the old paste path is unreadable — the
        // decryptor is gone. Clear it whenever an admin touches this row, on
        // either branch: leaving a secret in the database that nothing can read
        // is the worst of both options, and it is also what makes `last4` look
        // like evidence of a working credential.
        const hadLegacySecret = !existingRow?.secret_ref && !!existingRow?.last4;
        if (secretRefRaw || hadLegacySecret) {
            patch.secret_enc = null;
            patch.last4 = null;
        }

        const write = existingRow
            ? supabaseAdmin.from('oem_agent_credentials').update(patch).eq('id', existingRow.id as string).select(SAFE_COLUMNS).single()
            : supabaseAdmin.from('oem_agent_credentials').insert(patch).select(SAFE_COLUMNS).single();

        const { data: saved, error: writeError } = await write;
        if (isNotProvisionedError(writeError)) return notProvisioned({ credential: null });
        if (writeError) {
            // The message can echo a constraint value; the payload never reaches
            // here with a secret in a constrained column, but do not log the body.
            console.error('[agents/credentials] write failed', writeError.code);
            return NextResponse.json({ error: writeError.message }, { status: 500 });
        }

        // Audit trail. The council log records THAT a credential changed and by
        // which route it is now supplied — never the value, never the last4.
        await supabaseAdmin.from('oem_council_log').insert({
            organization_id: orgId,
            agent_key: agentKey,
            review_type: 'note',
            summary: sourceWritten === 'env'
                ? `${purpose} credential now reads from environment variable ${secretRefRaw}.`
                : hadLegacySecret
                    ? `${purpose} credential settings updated; an unreadable legacy stored key was cleared.`
                    : `${purpose} credential settings updated (no secret change).`,
            decided_by: 'human',
            details: { purpose, provider, source: sourceWritten },
            created_by: access.userId,
        }).then(
            (r) => { if (r.error && !isNotProvisionedError(r.error)) console.error('[agents/credentials] council log', r.error.message); },
            () => { /* audit logging must never fail the write */ },
        );

        const masked = mask(saved as unknown as Record<string, unknown>);

        return NextResponse.json({
            provisioned: true,
            credential: masked,
            source_written: sourceWritten,
            recommended_source: 'env',
            guidance: sourceWritten === 'env'
                ? 'Saved as an environment-variable reference. The secret itself never entered the database. `configured` is true only while that variable is actually set on this server — env_present tells you whether it currently is.'
                : 'No secret was changed; only provider/meta were updated.',
            warning: sourceWritten === 'env' && masked.env_present === false
                ? `Environment variable ${secretRefRaw} is not set on this server, so this credential is NOT configured and the agent will report ${purpose}_key_missing until it is.`
                : refPurposeMismatch,
            // Said out loud rather than done silently: an admin who saves a
            // provider change on a legacy row should know the old pasted key is
            // now gone, and that nothing was using it anyway.
            legacy_stored_secret_cleared: hadLegacySecret
                ? `An unreadable legacy stored key was cleared from this credential. ${LEGACY_STORED_SECRET_REASON}`
                : null,
            secrets_returned: false,
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

/* =========================================================================== */
/* DELETE — clear one credential.                                              */
/* =========================================================================== */

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const orgId = readOrgId(request);
        if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 });

        const access = await resolveAccess(orgId, 'write');
        if (isAccessError(access)) return access;

        const agentKey = searchParams.get('agentKey') || searchParams.get('agent_key');
        const purpose = searchParams.get('purpose') as AgentCredentialPurpose | null;
        if (!agentKey || !purpose) {
            return NextResponse.json({ error: 'agentKey and purpose are required' }, { status: 400 });
        }
        if (!AGENT_CREDENTIAL_PURPOSES.includes(purpose)) {
            return NextResponse.json(
                { error: `purpose must be one of ${AGENT_CREDENTIAL_PURPOSES.join(', ')}` },
                { status: 400 },
            );
        }

        // Delete the row outright rather than nulling the secret: a row that
        // remains with a null secret reads as "configured, value missing", which
        // is the same state as a broken env ref and confuses the diagnosis.
        const { error } = await supabaseAdmin
            .from('oem_agent_credentials')
            .delete()
            .eq('organization_id', orgId)
            .eq('agent_key', agentKey)
            .eq('purpose', purpose);

        if (isNotProvisionedError(error)) return notProvisioned();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        await supabaseAdmin.from('oem_council_log').insert({
            organization_id: orgId,
            agent_key: agentKey,
            review_type: 'note',
            summary: `${purpose} credential cleared.`,
            decided_by: 'human',
            details: { purpose, action: 'cleared' },
            created_by: access.userId,
        }).then(
            (r) => { if (r.error && !isNotProvisionedError(r.error)) console.error('[agents/credentials] council log', r.error.message); },
            () => { /* audit logging must never fail the delete */ },
        );

        return NextResponse.json({
            provisioned: true,
            cleared: { agent_key: agentKey, purpose },
            note: 'The agent will report llm_key_missing (or the equivalent for this purpose) on its next heartbeat until a credential is set again.',
        });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

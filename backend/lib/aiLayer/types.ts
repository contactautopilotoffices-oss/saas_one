/**
 * AI Action Layer: shared types.
 *
 * The AI never touches data. It only picks a catalog entry and fills its fields. Code checks access, asks for what is
 * missing, confirms writes, runs fixed queries scoped to the person, and builds the reply from templates.
 * Plan: docs/AI_ACTION_LAYER_PLAN.md
 */

export type Channel = 'app_chat' | 'whatsapp' | 'app_voice';
export type Lang = 'en' | 'hi' | 'hinglish';

/** Who is talking. Built by code from the session, never by the AI. */
export interface ActorContext {
    userId: string;
    orgId: string;
    /** Every active, approved role this person holds in this org (org and property memberships). */
    roles: string[];
    /** Org-wide for every module this layer offers (org super admin, ops super admin, org admin). */
    orgWide: boolean;
    /** Properties this person may ask about or act on. All org properties when orgWide. */
    propertyIds: string[];
    /** Property id → name, for pick lists and replies. Only properties in propertyIds. */
    propertyNames: Record<string, string>;
    /** Tenant-like roles (tenant, super_tenant, vendor) only ever see their own records inside a property. */
    ownRecordsOnly: boolean;
    /** Vendors see tickets assigned to them; tenants see tickets they raised. */
    recordRule: 'all_in_scope' | 'raised_by_me' | 'assigned_to_me';
}

export type EntryKind = 'question' | 'write';
export type ModuleId = 'tickets' | 'electricity_readings';
export type GridLevel = 'off' | 'questions' | 'questions_actions';
export type EntryMode = 'off' | 'shadow' | 'live';

export interface FieldSpec {
    name: string;
    required: boolean;
    /** What to ask when the field is missing, per language. */
    ask?: Record<Lang, string>;
}

/** What one turn produces for the person. */
export interface TurnReply {
    text: string;
    /** Numbered choices the UI can show as buttons. */
    options?: string[];
    /** A write is waiting for "Yes". */
    awaitingConfirm?: boolean;
}

export interface EntryResult {
    ok: boolean;
    reply: string;
    /** For the audit row, for example a ticket number. Never personal data. */
    resultRef?: string | null;
}

/** Anything that can read or write data for the layer. Injected so tests never touch a database. */
export interface AiData {
    countTickets(q: TicketQuery): Promise<TicketCountRow[]>;
    listTickets(q: TicketQuery, limit: number): Promise<TicketListRow[]>;
    readingsStatus(propertyIds: string[], date: string): Promise<ReadingsStatusRow[]>;
    consumption(propertyIds: string[], from: string, to: string): Promise<ConsumptionRow[]>;
    createTicket(input: { propertyId: string; description: string; title?: string; priority?: string }): Promise<{ ticketNumber: string; status: string; assigneeName: string | null }>;
}

export type TicketStatusGroup = 'open' | 'closed' | 'all';

export interface TicketQuery {
    orgId: string;
    propertyIds: string[];
    from: string; // ISO timestamp, inclusive
    to: string;   // ISO timestamp, exclusive
    status: TicketStatusGroup;
    recordRule: ActorContext['recordRule'];
    userId: string;
    priority?: string | null;
}

export interface TicketCountRow { propertyId: string; status: string; category: string | null }
export interface TicketListRow { ticketNumber: string; title: string; status: string; priority: string | null; propertyId: string; createdAt: string }

export interface ReadingsStatusRow {
    propertyId: string;
    meterName: string;
    meterStatus: string;   // active | inactive | faulty
    logged: boolean;       // a reading exists for the date
    alertStatus: string | null; // normal | warning | critical
    units: number | null;
}

export interface ConsumptionRow { propertyId: string; date: string; units: number; anomaly: boolean }

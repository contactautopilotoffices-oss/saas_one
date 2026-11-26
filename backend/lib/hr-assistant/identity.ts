/**
 * Who the assistant is. Pure constants (no server imports), shared by the server pipeline and
 * the chat UI so the name only lives here. Change BOT_NAME to rename the bot everywhere.
 */

export const BOT_NAME = "Otto";
export const COMPANY_NAME = "Autopilot Offices";
export const BOT_TITLE = `${BOT_NAME} · HR Assistant`;

// Opt-in route allowlist: newly added screens never show Otto until explicitly listed here.
const ORG_UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const DASHBOARD_SECTION =
  "(?:dashboard|accounts(?:\\/(?:bounty|grievance|invoices|po\\/[^/]+))?|ai-assistant(?:\\/train)?|ai-tickets|aop|book-room|crm(?:\\/(?:abm|activities|ai|calendar|campaigns|coaching|followups|help|import|leads|marketing|performance|playbooks|reports|settings|signals|spend|target|tasks))?|flow-map|hiring-requests|hr-assistant\\/documents|hr-tickets|meera|org-efficiency|org-progress|petty-cash|procurement-management|properties\\/[^/]+\\/(?:dashboard|guest-requests|utilities\\/analytics)|recruitment|rooms|satej|settings(?:\\/escalation)?|users)";
const EXACT_BOT_PATHS = new Set(["/dashboard", "/procurement", "/master"]);
const ALLOWED_BOT_PATTERNS = [
  new RegExp(`^(?:\\/${ORG_UUID})?\\/${DASHBOARD_SECTION}$`),
  new RegExp(`^\\/org\\/${ORG_UUID}\\/dashboard$`),
  /^\/property\/[^/]+\/(?:dashboard|flow-map|mst(?:\/requests\/[^/]+)?|reports\/(?:executive-summary|requests|[^/]+)|security|snags\/intake|soft-service-manager|staff|stock(?:\/scan)?|tenant|vendor)$/,
  /^\/(?:tickets|checklist|scan)\/[^/]+$/,
];

/** True only on existing signed-in app screens where Otto is intentionally shown. */
export function isAllowedBotPath(pathname: string | null): boolean {
  if (!pathname) return false;
  const path = pathname.replace(/\/+$/, "");
  return Boolean(path) && (EXACT_BOT_PATHS.has(path) || ALLOWED_BOT_PATTERNS.some((pattern) => pattern.test(path)));
}

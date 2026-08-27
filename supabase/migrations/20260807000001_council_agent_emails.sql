-- Council member addresses move to the real company domain:
--   <key>@council.autopilot.offices  →  <name>.<key>@autopilotoffices.com
--
-- The old domain was a virtual placeholder; the new pattern matches how the
-- addresses will actually be provisioned (Zoho) when agent inboxes go live.
-- Keyed by (key) across all orgs so any future org's seeded roster is
-- corrected too. Idempotent — re-running leaves the new addresses in place.

UPDATE public.council_agents SET email = 'bose.ops@autopilotoffices.com'          WHERE key = 'ops';
UPDATE public.council_agents SET email = 'mehta.compliance@autopilotoffices.com'  WHERE key = 'compliance';
UPDATE public.council_agents SET email = 'iyer.qa@autopilotoffices.com'           WHERE key = 'qa';
UPDATE public.council_agents SET email = 'rao.product@autopilotoffices.com'       WHERE key = 'product';
UPDATE public.council_agents SET email = 'verma.cto@autopilotoffices.com'         WHERE key = 'cto';
UPDATE public.council_agents SET email = 'nair.procurement@autopilotoffices.com'  WHERE key = 'procurement';
UPDATE public.council_agents SET email = 'deshpande.energy@autopilotoffices.com'  WHERE key = 'energy';
UPDATE public.council_agents SET email = 'kulkarni.tenant@autopilotoffices.com'   WHERE key = 'tenant';

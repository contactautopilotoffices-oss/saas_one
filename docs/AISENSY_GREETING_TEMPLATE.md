# Autopilot WhatsApp templates

The full greeting-and-actions implementation supersedes the standalone greeting
campaign. Use the ten templates and deployment instructions in
[AISENSY_WHATSAPP_ASSISTANT.md](./AISENSY_WHATSAPP_ASSISTANT.md).

The main menu template is `fms_whatsapp_menu_v1`, with **Create Ticket** and
**Book Meeting Room** quick-reply buttons. Each follow-up template also needs an
approved template and an active AiSensy API campaign.

The earlier `fms_greeting_reply_v1` campaign is used only by the legacy fallback
while `AISENSY_ASSISTANT_ENABLED` is disabled.

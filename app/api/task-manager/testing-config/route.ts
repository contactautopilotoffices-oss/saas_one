import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import { TaskDatabaseService } from '@/task-manager/TaskDatabaseService';
import { requireTaskManagerAdmin } from '../_shared/adminGuard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const guard = await requireTaskManagerAdmin();
        if (!guard.ok) return guard.response;

        const { searchParams } = new URL(request.url);
        const eventType = searchParams.get('eventType');
        const limitParam = searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : 50;

        const config = await TaskDatabaseService.getTestingConfig();
        const logs = await TaskDatabaseService.getAuditLogs({
            limit,
            eventType: (!eventType || eventType === 'all') ? undefined : eventType
        });
        return NextResponse.json({ success: true, config, logs });
    } catch (err: any) {
        console.error('[TestingConfigAPI] GET error:', err);
        return NextResponse.json({ success: false, error: err?.message || 'Failed to fetch config' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const guard = await requireTaskManagerAdmin();
        if (!guard.ok) return guard.response;

        const body = await request.json().catch(() => ({}));

        if (body.action === 'get_logs') {
            const eventType = (!body.eventType || body.eventType === 'all') ? undefined : body.eventType;
            const limit = body.limit || 50;
            const logs = await TaskDatabaseService.getAuditLogs({ limit, eventType, eventTypes: body.eventTypes });
            return NextResponse.json({ success: true, logs });
        }

        if (body.action === 'clear_logs') {
            const eventType = body.eventType || 'all';
            await TaskDatabaseService.clearAuditLogs(eventType);
            return NextResponse.json({
                success: true,
                message: 'Notification audit logs cleared successfully.',
                logs: []
            });
        }

        // ── Phase 2: Kill Switch Actions ─────────────────────────────────────
        if (body.action === 'toggle_global_kill_switch') {
            const halt = Boolean(body.halt);
            const reason = body.reason || (halt ? 'Emergency stop engaged by administrator' : null);
            const actor = guard.label; // from the login, never from the request
            const updatedSwitches = await TaskDatabaseService.toggleGlobalKillSwitch(halt, reason, actor);
            const updatedConfig = await TaskDatabaseService.getTestingConfig();
            return NextResponse.json({
                success: true,
                message: halt
                    ? '🛑 Global WhatsApp Kill Switch ENGAGED. All automated messages halted company-wide.'
                    : '🟢 Global WhatsApp Kill Switch DISENGAGED. Automated messaging resumed.',
                killSwitches: updatedSwitches,
                config: updatedConfig,
            });
        }

        // ── Step 1: Pretend Mode (no Task Manager WhatsApp message is delivered while ON) ──
        if (body.action === 'toggle_pretend_mode') {
            const enabled = Boolean(body.enabled);
            // Turning Pretend Mode OFF allows real messages again, so it must be explicitly confirmed.
            if (!enabled && body.confirm !== true) {
                return NextResponse.json(
                    { success: false, error: 'Turning Pretend Mode OFF requires explicit confirmation (confirm: true).' },
                    { status: 400 }
                );
            }
            const updatedConfig = await TaskDatabaseService.setPretendMode(enabled, guard.label);
            return NextResponse.json({
                success: true,
                message: enabled
                    ? '🛡️ Pretend Mode ON. No Task Manager WhatsApp message will be delivered; they are saved to history only.'
                    : '⚠️ Pretend Mode OFF. Task Manager WhatsApp messages can be delivered again (kill switches still apply).',
                config: updatedConfig,
            });
        }

        if (body.action === 'toggle_department_kill_switch') {
            const { departmentId, halt } = body;
            if (!departmentId) {
                return NextResponse.json({ success: false, error: 'Missing departmentId' }, { status: 400 });
            }
            const updatedSwitches = await TaskDatabaseService.toggleDepartmentKillSwitch(departmentId, Boolean(halt));
            const updatedConfig = await TaskDatabaseService.getTestingConfig();
            return NextResponse.json({
                success: true,
                message: Boolean(halt)
                    ? 'Department WhatsApp Kill Switch engaged (Messaging paused for this department).'
                    : 'Department WhatsApp Kill Switch disengaged (Messaging active for this department).',
                killSwitches: updatedSwitches,
                config: updatedConfig,
            });
        }

        if (body.action === 'toggle_message_type_kill_switch') {
            const { messageType, halt } = body;
            if (!messageType) {
                return NextResponse.json({ success: false, error: 'Missing messageType' }, { status: 400 });
            }
            const updatedSwitches = await TaskDatabaseService.toggleMessageTypeKillSwitch(messageType, Boolean(halt));
            const updatedConfig = await TaskDatabaseService.getTestingConfig();
            return NextResponse.json({
                success: true,
                message: Boolean(halt)
                    ? `Message category '${messageType}' paused.`
                    : `Message category '${messageType}' resumed.`,
                killSwitches: updatedSwitches,
                config: updatedConfig,
            });
        }

        if (body.action === 'update_kill_switches') {
            const updates = body.killSwitches || {};
            const updatedSwitches = await TaskDatabaseService.updateKillSwitches(updates);
            const updatedConfig = await TaskDatabaseService.getTestingConfig();
            return NextResponse.json({
                success: true,
                message: 'Kill switches updated successfully.',
                killSwitches: updatedSwitches,
                config: updatedConfig,
            });
        }

        // ── Phase 3: Immediate Manual Triggers ──────────────────────────────
        const TECH_DEPARTMENT_ID = '94a74961-2dd8-453d-9728-f6f2b9ade99b';

        if (body.action === 'trigger_generate') {
            const { TaskDailyGeneratorService } = await import('@/task-manager/TaskDailyGeneratorService');
            const genResult = await TaskDailyGeneratorService.generateDailyFixedTasks({
                departmentId: body.departmentId || TECH_DEPARTMENT_ID
            });
            return NextResponse.json({
                success: true,
                message: `Fixed tasks generated: ${genResult.tasksGenerated} created, ${genResult.tasksAlreadyExisting} already existed for today.`,
                result: genResult
            });
        }

        if (body.action === 'trigger_dispatch') {
            const { TaskDailyGeneratorService } = await import('@/task-manager/TaskDailyGeneratorService');
            const { TaskNotificationService } = await import('@/task-manager/TaskNotificationService');
            const dryRun = body.dryRun !== false; // default true for safety in test trigger
            const deptId = body.departmentId || TECH_DEPARTMENT_ID;

            const config = await TaskDatabaseService.getTestingConfig();
            const rules = config.rules || TaskDatabaseService.getDefaultNotificationRules(config.cronTiming);
            const targetRule = body.ruleId ? rules.find(r => r.id === body.ruleId) : undefined;

            // 1. Ensure tasks exist first
            const genResult = await TaskDailyGeneratorService.generateDailyFixedTasks({
                departmentId: deptId
            });

            // 2. Dispatch notifications
            const notifResult = await TaskNotificationService.sendMorningNotifications({
                departmentId: deptId,
                dryRun,
                rule: targetRule
            });

            const ruleLabel = targetRule ? `[${targetRule.name}] ` : '';
            const modeLabel = notifResult.blockedReason
                ? '[Blocked by Kill Switch - nothing sent] '
                : notifResult.pretend
                    ? '[Pretend Mode - nothing sent] '
                    : dryRun ? '[Dry-Run] ' : '';
            const summary = `${modeLabel}${ruleLabel}Generated ${genResult.tasksGenerated} tasks (${genResult.tasksAlreadyExisting} existing). Notified ${notifResult.notificationsSent} employees (${notifResult.skippedNoTasks} skipped${notifResult.skippedLocked ? `, ${notifResult.skippedLocked} locked` : ''}).`;

            // Only a real, delivered run counts as "ran today". Blocked or pretend runs must not consume the day's slot.
            if (!dryRun && !notifResult.pretend && !notifResult.blockedReason) {
                const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
                const todayIST = `${nowIST.getFullYear()}-${String(nowIST.getMonth() + 1).padStart(2, '0')}-${String(nowIST.getDate()).padStart(2, '0')}`;
                
                if (targetRule) {
                    await TaskDatabaseService.updateNotificationRule(targetRule.id, {
                        lastRunDate: todayIST,
                        lastRunSummary: summary
                    });
                    if (targetRule.id === 'rule_morning_digest') {
                        await TaskDatabaseService.saveTestingConfig({
                            cronLastRunDate: todayIST,
                            cronLastRunSummary: summary
                        });
                    }
                } else {
                    await TaskDatabaseService.saveTestingConfig({
                        cronLastRunDate: todayIST,
                        cronLastRunSummary: summary
                    });
                }
            }

            const logs = await TaskDatabaseService.getAuditLogs({ limit: 30, eventType: 'whatsapp_sent' });

            return NextResponse.json({
                success: true,
                message: summary,
                dryRun,
                logs,
                result: {
                    generator: genResult,
                    notifications: notifResult
                }
            });
        }

        if (body.action === 'delete_rule') {
            const ruleId = body.ruleId;
            if (!ruleId) {
                return NextResponse.json({ success: false, error: 'Missing ruleId' }, { status: 400 });
            }
            const updatedConfig = await TaskDatabaseService.deleteNotificationRule(ruleId);
            return NextResponse.json({
                success: true,
                message: `Deleted notification rule '${ruleId}'.`,
                config: updatedConfig
            });
        }

        // ── Phase 1 Multi-Rule Actions ─────────────────────────────────────
        if (body.action === 'reset_rule') {
            const ruleId = body.ruleId;
            const config = await TaskDatabaseService.getTestingConfig();
            const rules = config.rules || TaskDatabaseService.getDefaultNotificationRules(config.cronTiming);

            if (ruleId && ruleId !== 'all') {
                const updatedConfig = await TaskDatabaseService.resetNotificationRuleRun(ruleId);
                // Also sync legacy if it was morning digest
                if (ruleId === 'rule_morning_digest') {
                    await TaskDatabaseService.saveTestingConfig({
                        cronLastRunDate: null,
                        cronLastRunSummary: null
                    });
                }
                return NextResponse.json({
                    success: true,
                    message: `Reset execution status for rule '${ruleId}'.`,
                    config: updatedConfig
                });
            } else {
                // Reset all rules
                const resetRules = rules.map(r => ({
                    ...r,
                    lastRunDate: null,
                    lastRunSummary: null
                }));
                const updatedConfig = await TaskDatabaseService.saveTestingConfig({
                    cronLastRunDate: null,
                    cronLastRunSummary: null,
                    rules: resetRules
                });
                return NextResponse.json({
                    success: true,
                    message: 'Reset execution status for all notification rules.',
                    config: updatedConfig
                });
            }
        }

        if (body.action === 'update_rule') {
            const { ruleId, updates } = body;
            if (!ruleId || !updates) {
                return NextResponse.json({ success: false, error: 'Missing ruleId or updates payload' }, { status: 400 });
            }
            const updatedConfig = await TaskDatabaseService.updateNotificationRule(ruleId, updates);
            return NextResponse.json({
                success: true,
                message: `Updated notification rule '${ruleId}'.`,
                config: updatedConfig
            });
        }

        // ── Phase 1 & 2: Update Configuration ───────────────────────────────

        const updatePayload: Record<string, any> = {};

        if (body.enabled !== undefined) updatePayload.enabled = Boolean(body.enabled);
        if (body.notifyManager !== undefined) updatePayload.notifyManager = Boolean(body.notifyManager);

        // If manager phone provided, ensure role is reporting_manager in employee_profiles
        if (body.manager !== undefined) {
            updatePayload.manager = {
                name: (body.manager?.name || '').trim(),
                phone: (body.manager?.phone || '').trim()
            };

            if (updatePayload.manager.phone) {
                const last10 = updatePayload.manager.phone.replace(/\D/g, '').slice(-10);
                if (last10.length === 10) {
                    await supabaseAdmin
                        .from('employee_profiles')
                        .update({ task_role: 'reporting_manager' })
                        .or(`phone.eq.${last10},phone.ilike.%${last10}`);
                }
            }
        }

        if (body.employees !== undefined && Array.isArray(body.employees)) {
            updatePayload.employees = body.employees.map((e: any) => ({
                name: (e.name || '').trim(),
                phone: (e.phone || '').trim()
            })).filter((e: any) => e.name || e.phone);
        }

        if (body.cronTiming !== undefined) {
            const trimmed = String(body.cronTiming).trim();
            if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
                const [h, m] = trimmed.split(':').map(Number);
                if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                    updatePayload.cronTiming = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                } else {
                    updatePayload.cronTiming = trimmed;
                }
            } else {
                updatePayload.cronTiming = trimmed;
            }
        }
        if (body.cronEnabled !== undefined) {
            updatePayload.cronEnabled = Boolean(body.cronEnabled);
        }
        if (body.cronLastRunDate !== undefined) {
            updatePayload.cronLastRunDate = body.cronLastRunDate ? String(body.cronLastRunDate) : null;
        }
        if (body.cronLastRunSummary !== undefined) {
            updatePayload.cronLastRunSummary = body.cronLastRunSummary ? String(body.cronLastRunSummary) : null;
        }
        if (body.rules !== undefined && Array.isArray(body.rules)) {
            updatePayload.rules = body.rules;
        }
        if (body.killSwitches !== undefined && typeof body.killSwitches === 'object') {
            updatePayload.killSwitches = body.killSwitches;
        }

        const savedConfig = await TaskDatabaseService.saveTestingConfig(updatePayload);

        return NextResponse.json({
            success: true,
            message: 'Testing configuration updated successfully',
            config: savedConfig
        });
    } catch (err: any) {
        console.error('[TestingConfigAPI] POST error:', err);
        return NextResponse.json({ success: false, error: err?.message || 'Failed to save config' }, { status: 500 });
    }
}

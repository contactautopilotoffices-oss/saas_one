import { NextRequest, NextResponse } from 'next/server';
import { TaskDailyGeneratorService } from '@/task-manager/TaskDailyGeneratorService';
import { TaskNotificationService } from '@/task-manager/TaskNotificationService';
import { TaskDatabaseService } from '@/task-manager/TaskDatabaseService';
import { TaskMessagingService } from '@/task-manager/TaskMessagingService';
import { evaluateRuleSchedule } from '@/task-manager/NotificationSchedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TECH_DEPARTMENT_ID = '94a74961-2dd8-453d-9728-f6f2b9ade99b';

/**
 * GET/POST /api/cron/task-manager?action=[daily_tasks|morning_digest|auto]
 * Secure automated cron job for Task Manager notifications.
 * In 'auto' mode, acts as a heartbeat that checks DB-configured timing & daily deduplication.
 */
export async function GET(request: NextRequest) {
    return handleRequest(request);
}

export async function POST(request: NextRequest) {
    return handleRequest(request);
}

async function handleRequest(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    const urlSecret = request.nextUrl.searchParams.get('secret');
    const cronSecret = process.env.CRON_SECRET;

    // Secure authorization gate
    const isAuthorized =
        (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
        (cronSecret && urlSecret === cronSecret) ||
        process.env.NODE_ENV === 'development';

    if (!isAuthorized) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const action = request.nextUrl.searchParams.get('action') || 'auto';
    const dryRun = request.nextUrl.searchParams.get('dryRun') === 'true';
    const deptId = request.nextUrl.searchParams.get('departmentId') || TECH_DEPARTMENT_ID;
    const targetDate = request.nextUrl.searchParams.get('date') || undefined;
    const force = request.nextUrl.searchParams.get('force') === 'true';

    try {
        if (action === 'daily_tasks') {
            const result = await TaskDailyGeneratorService.generateDailyFixedTasks({
                date: targetDate,
                departmentId: deptId
            });
            return NextResponse.json({ ok: true, action: 'daily_tasks', result });
        }

        if (action === 'morning_digest') {
            // First generate tasks, then send morning notifications
            const genResult = await TaskDailyGeneratorService.generateDailyFixedTasks({
                date: targetDate,
                departmentId: deptId
            });
            const notifResult = await TaskNotificationService.sendMorningNotifications({
                date: targetDate,
                departmentId: deptId,
                dryRun
            });
            return NextResponse.json({
                ok: true,
                action: 'morning_digest',
                genResult,
                notifResult
            });
        }

        // ── Auto Mode (Multi-Rule Heartbeat Evaluator) ───────────────────────
        const config = await TaskDatabaseService.getTestingConfig();

        // 1. Check master toggle
        if (config.cronEnabled === false) {
            return NextResponse.json({
                ok: true,
                action: 'paused',
                message: 'Task Manager automated daily cron is currently paused in settings.'
            });
        }

        // 2. Compute current IST date and time
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const todayIST = targetDate || `${nowIST.getFullYear()}-${String(nowIST.getMonth() + 1).padStart(2, '0')}-${String(nowIST.getDate()).padStart(2, '0')}`;
        const currentDayOfWeek = nowIST.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
        const currentMinutes = nowIST.getHours() * 60 + nowIST.getMinutes();
        const currentISTTime = `${String(nowIST.getHours()).padStart(2, '0')}:${String(nowIST.getMinutes()).padStart(2, '0')}`;

        const targetRuleId = request.nextUrl.searchParams.get('ruleId') || undefined;

        // Rules to evaluate: either a specific requested rule or all active rules
        const rules = config.rules || TaskDatabaseService.getDefaultNotificationRules(config.cronTiming);
        const candidates = targetRuleId ? rules.filter(r => r.id === targetRuleId) : rules;

        if (candidates.length === 0) {
            return NextResponse.json({
                ok: false,
                error: targetRuleId ? `Rule '${targetRuleId}' not found.` : 'No notification rules configured.'
            }, { status: 404 });
        }

        const ruleResults: Array<{
            ruleId: string;
            ruleName: string;
            status: 'dispatched' | 'waiting' | 'already_executed_today' | 'disabled' | 'not_scheduled_today' | 'outside_operational_window' | 'blocked_by_kill_switch';
            message?: string;
            summary?: string;
        }> = [];

        let executedCount = 0;

        for (const rule of candidates) {
            // Step 6: every rule runs for ITS OWN department. Rules without one (the original Tech rules) keep using the default.
            const ruleDept = rule.departmentId && rule.departmentId !== 'all' ? rule.departmentId : deptId;

            const status = evaluateRuleSchedule(rule, { dayOfWeek: currentDayOfWeek, minutes: currentMinutes, todayIST }, force);
            if (status !== 'due') {
                const messages: Record<string, string> = {
                    disabled: `Rule '${rule.name}' is currently paused.`,
                    not_scheduled_today: `Rule '${rule.name}' is not scheduled for today (Day ${currentDayOfWeek}).`,
                    already_executed_today: `Rule '${rule.name}' already dispatched for today (${todayIST}).`,
                    waiting: `Scheduled time (${rule.targetTimeIST} IST) has not arrived yet. Current IST: ${currentISTTime}`,
                    outside_operational_window: `Current time (${currentISTTime} IST) is too long after this rule's scheduled time (${rule.targetTimeIST} IST).`,
                };
                ruleResults.push({ ruleId: rule.id, ruleName: rule.name, status, message: messages[status] });
                continue;
            }

            // Safety pre-check (fails closed). A blocked rule is NOT stamped as run, so it can still fire after messaging resumes.
            if (!dryRun) {
                const gate = await TaskMessagingService.resolveSendMode({
                    departmentId: ruleDept,
                    ruleType: rule.ruleType
                });
                if (gate.mode === 'blocked') {
                    ruleResults.push({
                        ruleId: rule.id,
                        ruleName: rule.name,
                        status: 'blocked_by_kill_switch',
                        message: gate.reason
                    });
                    continue;
                }
            }

            // Execute tasks & notification for this rule
            const genResult = await TaskDailyGeneratorService.generateDailyFixedTasks({
                date: todayIST,
                departmentId: ruleDept
            });

            const notifResult = await TaskNotificationService.sendMorningNotifications({
                date: todayIST,
                departmentId: ruleDept,
                dryRun,
                rule
            });


            // Safety gate tripped between the pre-check and the send: do not stamp the rule as run.
            if (notifResult.blockedReason) {
                ruleResults.push({
                    ruleId: rule.id,
                    ruleName: rule.name,
                    status: 'blocked_by_kill_switch',
                    message: notifResult.blockedReason
                });
                continue;
            }

            const summary = notifResult.pretend
                ? `[Pretend Mode - nothing sent] Generated ${genResult.tasksGenerated} tasks (${genResult.tasksAlreadyExisting} existing). Simulated ${notifResult.notificationsSent} digests (${notifResult.skippedNoTasks} skipped${notifResult.skippedLocked ? `, ${notifResult.skippedLocked} locked` : ''}).`
                : `Generated ${genResult.tasksGenerated} tasks (${genResult.tasksAlreadyExisting} existing). Sent ${notifResult.notificationsSent} digests (${notifResult.skippedNoTasks} skipped${notifResult.skippedLocked ? `, ${notifResult.skippedLocked} locked` : ''}).`;

            // Stamp rule execution in DB
            await TaskDatabaseService.updateNotificationRule(rule.id, {
                lastRunDate: todayIST,
                lastRunSummary: summary
            });

            // If it's the primary morning digest, maintain legacy fields too
            if (rule.id === 'rule_morning_digest' || (rule.ruleType === 'morning_digest' && !rule.departmentId)) {
                await TaskDatabaseService.saveTestingConfig({
                    cronLastRunDate: todayIST,
                    cronLastRunSummary: summary
                });
            }

            ruleResults.push({
                ruleId: rule.id,
                ruleName: rule.name,
                status: 'dispatched',
                summary
            });
            executedCount++;
        }

        let overallAction: string = 'evaluated';
        let overallMessage: string | undefined = undefined;

        if (executedCount > 0) {
            overallAction = 'dispatched';
            overallMessage = ruleResults.find(r => r.status === 'dispatched')?.summary;
        } else if (ruleResults.some(r => r.status === 'blocked_by_kill_switch')) {
            overallAction = 'blocked';
            overallMessage = ruleResults.find(r => r.status === 'blocked_by_kill_switch')?.message;
        } else if (ruleResults.some(r => r.status === 'waiting')) {
            overallAction = 'waiting';
            overallMessage = ruleResults.find(r => r.status === 'waiting')?.message;
        } else if (ruleResults.length > 0 && ruleResults.every(r => r.status === 'already_executed_today')) {
            overallAction = 'already_executed_today';
            overallMessage = 'All scheduled notification rules have already been executed for today.';
        } else if (ruleResults.length > 0 && ruleResults.every(r => r.status === 'disabled')) {
            overallAction = 'paused';
            overallMessage = 'All notification rules are currently paused.';
        }

        return NextResponse.json({
            ok: true,
            action: overallAction,
            message: overallMessage,
            todayIST,
            currentIST: currentISTTime,
            rulesEvaluated: ruleResults.length,
            rulesDispatched: executedCount,
            results: ruleResults
        });


    } catch (err: any) {
        console.error('[TaskReminderCron] Error executing action:', err);
        return NextResponse.json({ ok: false, error: err?.message || 'Internal error' }, { status: 500 });
    }
}

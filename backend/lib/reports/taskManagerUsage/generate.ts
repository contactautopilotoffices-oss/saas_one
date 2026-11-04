import { buildUsageReport } from './load';
import { renderPdf } from './renderPdf';
import { buildReportHtml } from './reportHtml';
import { reportFileName, saveReport, type ReportTrigger } from './store';
import type { UsageReport } from './types';

/**
 * Task Manager Usage Report: numbers → HTML → PDF → saved copy. Used by the Report tab and by the scheduler.
 * Saving is best-effort, so a report can still be downloaded before the migration has been run.
 */

export interface GeneratedReport {
    report: UsageReport;
    pdf: Buffer;
    fileName: string;
    savedId: string | null;
}

export async function generateUsageReport(params: {
    organizationId: string;
    from: string;
    to: string;
    trigger: ReportTrigger;
    userId: string | null;
}): Promise<GeneratedReport> {
    const { organizationId, from, to, trigger, userId } = params;
    const report = await buildUsageReport(organizationId, from, to, new Date().toISOString());
    const pdf = await renderPdf(buildReportHtml(report), 'Task Manager Usage Report');
    const savedId = await saveReport({ organizationId, from, to, trigger, userId, pdf });
    return { report, pdf, fileName: reportFileName(from, to), savedId };
}

import fs from 'fs';
import path from 'path';
import { generateCodeFix } from './ai.js';
import { createPullRequest } from './git.js';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

// Helper to update ticket status
async function updateStatus(ticketId, supabase, status, extraData = {}) {
    console.log(`[Ticket ${ticketId}] Status -> ${status}`);
    await supabase
        .from('feedback_tickets')
        .update({ status, updated_at: new Date().toISOString(), ...extraData })
        .eq('id', ticketId);
}

/**
 * Main worker logic that processes a single ticket.
 * It runs sequentially in the p-queue.
 */
export async function processTicket(ticketId, supabase) {
    try {
        console.log(`\n========================================`);
        console.log(`🛠️ Processing Ticket ID: ${ticketId}`);
        console.log(`========================================`);

        // 1. Fetch Ticket
        const { data: ticket, error } = await supabase
            .from('feedback_tickets')
            .select('*')
            .eq('id', ticketId)
            .single();

        if (error || !ticket) {
            throw new Error(`Ticket not found: ${error?.message}`);
        }
        
        await updateStatus(ticketId, supabase, 'analyzing');

        // 2. Load Knowledge Base Context
        console.log(`[Ticket ${ticketId}] Loading knowledge base...`);
        const KNOWLEDGE_PATH = process.env.KNOWLEDGE_PATH || '/app/knowledge';
        
        let schema = '';
        let fileTree = '';
        let uiGuidelines = '';
        try {
            schema = fs.readFileSync(path.join(KNOWLEDGE_PATH, 'db_schema/schema.sql'), 'utf-8');
            fileTree = fs.readFileSync(path.join(KNOWLEDGE_PATH, 'architecture/file_tree.txt'), 'utf-8');
            uiGuidelines = fs.readFileSync(path.join(KNOWLEDGE_PATH, 'conventions/ui_guidelines.md'), 'utf-8');
        } catch (err) {
            console.warn(`[Ticket ${ticketId}] Warning: Missing some knowledge base files. Continuing without them.`);
        }

        // 3. Generate AI Fix
        console.log(`[Ticket ${ticketId}] Sending to AI for code generation...`);
        const { filesChanged, explanation } = await generateCodeFix(ticket, {
            schema,
            fileTree,
            uiGuidelines
        });

        await updateStatus(ticketId, supabase, 'validating', { ai_analysis: { explanation, filesChanged } });

        // 4. Validate Build (Optional / Basic implementation)
        // In a real pipeline, we would apply the file changes locally, run `npm run build`, and catch errors.
        // For now, we will simulate the file write (since we are on the Droplet, we would actually modify `process.env.REPO_PATH`)
        console.log(`[Ticket ${ticketId}] Validating changes...`);
        // TODO: Apply file changes to REPO_PATH and run `npm run build`
        
        // 5. Create PR
        console.log(`[Ticket ${ticketId}] Creating GitHub PR...`);
        await updateStatus(ticketId, supabase, 'pr_created');
        const prUrl = await createPullRequest(ticket, filesChanged, explanation);

        // 6. Finish
        await updateStatus(ticketId, supabase, 'pr_created', { 
            github_pr_url: prUrl,
            resolved_at: new Date().toISOString()
        });
        
        console.log(`✅ [Ticket ${ticketId}] Finished! PR created: ${prUrl}`);

    } catch (err) {
        console.error(`❌ [Ticket ${ticketId}] Failed: ${err.message}`);
        await updateStatus(ticketId, supabase, 'failed', { failure_reason: err.message });
    }
}

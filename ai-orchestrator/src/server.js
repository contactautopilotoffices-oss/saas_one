import express from 'express';
import dotenv from 'dotenv';
import PQueue from 'p-queue';
import { processTicket } from './worker.js';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// Initialize Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize a sequential in-memory queue
// concurrency: 1 ensures we only process one AI ticket at a time
const queue = new PQueue({ concurrency: 1 });

queue.on('active', () => {
    console.log(`[Queue] Processing started. Size: ${queue.size}  Pending: ${queue.pending}`);
});
queue.on('idle', () => {
    console.log(`[Queue] Idle. All tickets processed.`);
});

/**
 * Startup function to fetch any tickets that were left in 'pending' or 'analyzing'
 * if the server crashed or was restarted.
 */
async function resumeStuckTickets() {
    console.log('🔄 Checking for stuck tickets on startup...');
    const { data: tickets, error } = await supabase
        .from('feedback_tickets')
        .select('id')
        .in('status', ['pending', 'analyzing']);
        
    if (error) {
        console.error('Failed to fetch stuck tickets:', error.message);
        return;
    }
    
    if (tickets && tickets.length > 0) {
        console.log(`Found ${tickets.length} incomplete tickets. Adding to queue...`);
        for (const t of tickets) {
            queue.add(() => processTicket(t.id, supabase));
        }
    } else {
        console.log('✅ No stuck tickets found.');
    }
}

/**
 * Webhook endpoint triggered by Supabase DB Trigger
 */
app.post('/webhook/new-ticket', (req, res) => {
    const payload = req.body;
    
    // Supabase DB webhooks send the new row in `payload.record`
    const ticketId = payload?.record?.id;
    
    if (!ticketId) {
        return res.status(400).json({ error: 'No ticket ID provided' });
    }
    
    console.log(`📥 Received new ticket: ${ticketId}`);
    
    // Add to queue and process asynchronously
    queue.add(() => processTicket(ticketId, supabase));
    
    // Immediately return 200 OK so Supabase webhook doesn't timeout
    return res.status(200).json({ message: 'Ticket queued for AI processing' });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', queue_size: queue.size });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`🚀 AI Orchestrator running on port ${PORT}`);
    
    // Check for any stuck tickets on boot
    await resumeStuckTickets();
});

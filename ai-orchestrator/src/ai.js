import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Sends the bug report and the Knowledge Base to Claude to generate a fix.
 * @returns { filesChanged: Array<{path: string, content: string}>, explanation: string }
 */
export async function generateCodeFix(ticket, knowledgeBase) {
    console.log(`[AI Engine] Analyzing ticket ${ticket.id}...`);

    const systemPrompt = `
You are an autonomous AI developer working on a Next.js application called SaaS One.
Your job is to read user bug reports and generate the exact code fixes required.

Here is your Knowledge Base:
=== DATABASE SCHEMA ===
${knowledgeBase.schema}

=== FILE TREE ===
${knowledgeBase.fileTree}

=== UI GUIDELINES ===
${knowledgeBase.uiGuidelines}

INSTRUCTIONS:
1. Analyze the bug report provided by the user.
2. Determine which files need to be modified.
3. Return your response in STRICT JSON format matching this schema:
{
  "explanation": "A short summary of what caused the bug and how you fixed it.",
  "filesChanged": [
    { "path": "frontend/components/dashboard/ProcurementDashboard.tsx", "content": "THE ENTIRE NEW FILE CONTENT HERE" }
  ]
}
Do NOT wrap the JSON in markdown code blocks. Return ONLY the raw JSON object.
`;

    const userPrompt = `
Ticket Type: ${ticket.type}
Error Category: ${ticket.error_category}
Error Text: ${ticket.error_text || ticket.feature_description}
Page URL: ${ticket.error_page_url}

Please generate the fix.
`;

    const msg = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 8000,
        temperature: 0.1,
        system: systemPrompt,
        messages: [
            { role: "user", content: userPrompt }
        ]
    });

    try {
        const result = JSON.parse(msg.content[0].text);
        return {
            explanation: result.explanation,
            filesChanged: result.filesChanged || []
        };
    } catch (err) {
        console.error("Failed to parse AI JSON response:", msg.content[0].text);
        throw new Error("AI returned malformed JSON");
    }
}

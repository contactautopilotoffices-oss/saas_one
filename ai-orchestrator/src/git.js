import { Octokit } from 'octokit';
import dotenv from 'dotenv';
dotenv.config();

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;

/**
 * Creates a new branch, commits the files, and opens a Pull Request on GitHub.
 * Returns the PR URL.
 */
export async function createPullRequest(ticket, filesChanged, explanation) {
    if (!owner || !repo) {
        console.warn("⚠️ GitHub credentials missing. Skipping PR creation.");
        return "https://github.com/skipped/no-credentials";
    }

    const branchName = `ai-fix/ticket-${ticket.id.substring(0, 8)}`;
    
    // 1. Get the latest commit SHA of the main branch
    const { data: refData } = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: 'heads/main',
    });
    const latestCommitSha = refData.object.sha;

    // 2. Create a new branch
    await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: latestCommitSha,
    });

    // 3. Create a new tree with the changed files
    // In a full implementation, you'd upload each file as a blob and construct the tree.
    // For this boilerplate, we are just mocking the PR URL return so you can integrate the actual git logic
    // based on how your Droplet executes `git add . && git commit` locally.
    
    // Real-world implementation usually relies on the local Droplet git commands:
    // execSync(`git checkout -b ${branchName}`);
    // execSync(`git add .`);
    // execSync(`git commit -m "Fix ticket ${ticket.id}"`);
    // execSync(`git push origin ${branchName}`);
    
    // 4. Create the Pull Request via API
    try {
        const { data: pr } = await octokit.rest.pulls.create({
            owner,
            repo,
            title: `AI Fix: Ticket ${ticket.id.substring(0, 8)}`,
            head: branchName,
            base: 'main',
            body: `### Auto-Generated Fix by AI Orchestrator\n\n**Original Issue:**\n${ticket.error_text || 'No description provided'}\n\n**AI Explanation:**\n${explanation}\n\n*Please review this PR carefully before merging.*`,
        });
        
        return pr.html_url;
    } catch (e) {
        console.error("Failed to create PR:", e);
        return `https://github.com/${owner}/${repo}/pulls (Failed to auto-open PR)`;
    }
}

#!/usr/bin/env node
/**
 * Map what the purchase@ Zoho account can see in WorkDrive. Read-only: GET requests only.
 *
 *   node scripts/workdrive-browse.mjs                      # teams, team folders, My Folders (2 levels)
 *   node scripts/workdrive-browse.mjs --depth 4            # go deeper
 *   node scripts/workdrive-browse.mjs --folder <id|link>   # one folder only
 *   node scripts/workdrive-browse.mjs --out map.json       # also save the tree as JSON
 *
 * Purpose: see where the costing, AOP and purchase workbooks actually live before the AOP feed
 * pins one of them (scripts/workdrive-fetch.mjs downloads a pinned file).
 *
 * Token: ZOHO_WORKDRIVE_REFRESH_TOKEN, minted with
 *   node scripts/zoho-reauth.mjs WORKDRIVE '<grant code>'
 * from the same Self Client as Books/Mail (purchase@worksquare.in), with the read-only scopes
 *   WorkDrive.users.READ,WorkDrive.team.READ,WorkDrive.teamfolders.READ,WorkDrive.files.READ
 * Each call reports its own failure, so a missing scope shows up as the one step that 401s.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const DEPTH = Number(opt('--depth', 2));
const OUT = opt('--out', null);
const ONLY = opt('--folder', null);

const raw = readFileSync('.env', 'utf8');
const env = Object.fromEntries(
    raw.split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const clientPrefix = env.ZOHO_WORKDRIVE_CLIENT_ID ? 'ZOHO_WORKDRIVE' : 'ZOHO_BOOKS';
const dc = (env[`${clientPrefix}_DC`] || 'com').replace(/^\.+/, '');
if (!env.ZOHO_WORKDRIVE_REFRESH_TOKEN) {
    console.error('ZOHO_WORKDRIVE_REFRESH_TOKEN missing from .env — run: node scripts/zoho-reauth.mjs WORKDRIVE \'<grant code>\'');
    process.exit(1);
}

const tokenRes = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: env[`${clientPrefix}_CLIENT_ID`],
        client_secret: env[`${clientPrefix}_CLIENT_SECRET`],
        refresh_token: env.ZOHO_WORKDRIVE_REFRESH_TOKEN,
    }),
});
const token = await tokenRes.json();
if (!token.access_token) { console.error('Token refresh failed: ' + JSON.stringify(token)); process.exit(1); }

const API = `https://www.zohoapis.${dc}/workdrive/api/v1`;
async function get(path) {
    const res = await fetch(path.startsWith('http') ? path : API + path, {
        headers: { Authorization: `Zoho-oauthtoken ${token.access_token}`, Accept: 'application/vnd.api+json' },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const hint = res.status === 401 ? ' (scope missing or token expired)' : res.status === 403 || res.status === 400 ? ' (no permission)' : '';
        return { error: `${res.status}${hint}: ${JSON.stringify(body?.errors || body).slice(0, 200)}` };
    }
    return body;
}

// Folder listings page at 50; walk every page.
async function listFolder(folderId) {
    const items = [];
    for (let offset = 0; ; offset += 50) {
        const r = await get(`/files/${folderId}/files?page%5Blimit%5D=50&page%5Boffset%5D=${offset}`);
        if (r.error) return { error: r.error, items };
        const data = r.data || [];
        items.push(...data);
        if (data.length < 50) return { items };
    }
}

const fmtSize = (b) => b == null ? '' : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
const tree = [];
let fileCount = 0;

async function walk(folderId, name, depth, indent, node) {
    if (depth > DEPTH) { console.log(`${indent}  …`); return; }
    const { items, error } = await listFolder(folderId);
    if (error) { console.log(`${indent}  ! ${error}`); node.error = error; return; }
    for (const it of items) {
        const a = it.attributes || {};
        const isFolder = a.is_folder || a.type === 'folder';
        const child = {
            id: it.id, name: a.name, type: isFolder ? 'folder' : (a.extn || a.type),
            modified: a.modified_time, modified_by: a.modified_by, size: a.storage_info?.size_in_bytes ?? null,
        };
        node.children.push(child);
        if (isFolder) {
            console.log(`${indent}📁 ${a.name}  [${it.id}]`);
            child.children = [];
            await walk(it.id, a.name, depth + 1, indent + '   ', child);
        } else {
            fileCount++;
            console.log(`${indent}· ${a.name}  ${fmtSize(child.size)}  ${a.modified_time || ''}${a.modified_by ? ` · ${a.modified_by}` : ''}  [${it.id}]`);
        }
    }
}

if (ONLY) {
    const id = (ONLY.match(/\/folders?\/([A-Za-z0-9]+)/) || [])[1] || ONLY;
    const node = { id, name: id, type: 'folder', children: [] };
    tree.push(node);
    console.log(`📁 ${id}`);
    await walk(id, id, 1, '   ', node);
} else {
    // 1. Who am I → which teams
    const me = await get('/users/me');
    if (me.error) { console.error(`users/me failed — ${me.error}`); process.exit(1); }
    const zuid = me.data?.id;
    console.log(`Signed in as: ${me.data?.attributes?.email_id || me.data?.attributes?.display_name || zuid}`);
    const teams = await get(`/users/${zuid}/teams`);
    if (teams.error) { console.error(`teams failed — ${teams.error}`); process.exit(1); }

    for (const t of teams.data || []) {
        console.log(`\n=== Team: ${t.attributes?.name} [${t.id}]`);
        const teamNode = { id: t.id, name: t.attributes?.name, type: 'team', children: [] };
        tree.push(teamNode);

        // 2. Team folders (WorkDrive calls them workspaces in the API)
        const ws = await get(`/teams/${t.id}/workspaces`);
        if (ws.error) console.log(`  ! team folders: ${ws.error}`);
        for (const w of ws.data || []) {
            console.log(`\n📂 Team folder: ${w.attributes?.name}  [${w.id}]`);
            const node = { id: w.id, name: w.attributes?.name, type: 'teamfolder', children: [] };
            teamNode.children.push(node);
            await walk(w.id, w.attributes?.name, 1, '   ', node);
        }

        // 3. My Folders of this account
        const cu = await get(`/teams/${t.id}/currentuser`);
        const memberId = cu.data?.id;
        if (cu.error || !memberId) { console.log(`  ! current member: ${cu.error || 'no id'}`); continue; }
        const ps = await get(`/users/${memberId}/privatespace`);
        if (ps.error) { console.log(`  ! My Folders: ${ps.error}`); continue; }
        for (const p of ps.data || []) {
            console.log(`\n🔒 My Folders  [${p.id}]`);
            const node = { id: p.id, name: 'My Folders', type: 'privatespace', children: [] };
            teamNode.children.push(node);
            await walk(p.id, 'My Folders', 1, '   ', node);
        }
    }
}

console.log(`\n${fileCount} file(s) listed. Nothing was downloaded or changed.`);
if (OUT) { writeFileSync(OUT, JSON.stringify(tree, null, 2)); console.log(`Tree saved to ${OUT}`); }

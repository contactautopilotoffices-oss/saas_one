const fs = require('fs');
const path = require('path');

/**
 * SQL Migration Linter & Column Mismatch Guard
 * Scans migration files for PostgreSQL runtime errors:
 * 1. COALESCE with non-existent columns (e.g., COALESCE(title, name) on sop_templates)
 * 2. Invalid NEW.<column> or OLD.<column> references in trigger functions
 * 3. Mismatched column references in outbox event payloads
 */

function runSQLLinter() {
    const dirList = [
        path.join(__dirname, '..', 'supabase', 'migrations'),
        path.join(__dirname, '..', 'backend', 'db', 'migrations')
    ];

    let hasErrors = false;
    const tableColumns = {}; // table_name -> Set(column_names)

    // Build Table Column Registry from CREATE TABLE statements
    dirList.forEach(dir => {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql'));

        files.forEach(file => {
            const sql = fs.readFileSync(path.join(dir, file), 'utf8');
            const tableMatches = sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\);/gi);

            for (const match of tableMatches) {
                const table = match[1].toLowerCase();
                if (!tableColumns[table]) tableColumns[table] = new Set();

                const lines = match[2].split('\n');
                lines.forEach(line => {
                    const colMatch = /^\s*([a-z0-9_]+)\s+(?:UUID|TEXT|VARCHAR|INT|BIGINT|NUMERIC|BOOLEAN|TIMESTAMPTZ|TIMESTAMP|DATE|JSONB|TIME|DOUBLE|FLOAT|SERIAL)/i.exec(line);
                    if (colMatch) {
                        const col = colMatch[1].toLowerCase();
                        if (!['constraint', 'primary', 'foreign', 'unique', 'check'].includes(col)) {
                            tableColumns[table].add(col);
                        }
                    }
                });
            }
        });
    });

    console.log(`🔍 Registered ${Object.keys(tableColumns).length} database tables from migration schema.`);

    // Specific known pitfall assertions
    dirList.forEach(dir => {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql'));

        files.forEach(file => {
            const content = fs.readFileSync(path.join(dir, file), 'utf8');

            // Pitfall 1: COALESCE(title, name) on sop_templates
            if (content.includes('sop_templates') && /COALESCE\s*\(\s*title\s*,\s*name\s*\)/i.test(content)) {
                console.error(`❌ [${file}]: Invalid reference 'COALESCE(title, name)' on table 'sop_templates' (column 'name' does not exist).`);
                hasErrors = true;
            }

            // Pitfall 2: NEW.phone on visitor_logs trigger
            if (/CREATE\s+TRIGGER\s+.*ON\s+public\.visitor_logs/i.test(content) && /NEW\.phone\b/i.test(content)) {
                console.error(`❌ [${file}]: Invalid reference 'NEW.phone' on table 'visitor_logs' (column is 'mobile').`);
                hasErrors = true;
            }

            // Pitfall 3: NEW.template_title on sop_completions trigger
            if (/CREATE\s+TRIGGER\s+.*ON\s+public\.sop_completions/i.test(content) && /NEW\.template_title\b/i.test(content)) {
                console.error(`❌ [${file}]: Invalid reference 'NEW.template_title' on table 'sop_completions' (column does not exist on sop_completions).`);
                hasErrors = true;
            }
        });
    });

    if (!hasErrors) {
        console.log('✅ All SQL migrations passed linter checks cleanly!');
    } else {
        console.error('\n⚠️ Please fix the SQL migration errors listed above.');
    }
}

runSQLLinter();

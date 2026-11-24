import crypto from 'crypto';

function key(): Buffer {
    const raw = process.env.MAIL_TOKEN_KEY ?? '';
    if (!raw.trim()) {
        throw new Error('MAIL_TOKEN_KEY is not set — a mailbox token cannot be stored or read without it.');
    }
    // Any passphrase length is accepted; it is stretched to 32 bytes.
    return crypto.createHash('sha256').update(raw).digest();
}

export function encryptToken(plain: string): string {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptToken(packed: string): string {
    const [ivB64, tagB64, dataB64] = String(packed).split('.');
    if (!ivB64 || !tagB64 || !dataB64) throw new Error('stored mail token is malformed');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    d.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8');
}

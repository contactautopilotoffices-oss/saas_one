import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ZohoMailService } from '../../backend/services/zohoMailService';

it('uses the chosen folder, accepts Zoho attachment metadata and bounds downloads without changing legacy calls', async () => {
  const originalFetch = globalThis.fetch;
  const originalId = process.env.ZOHO_MAIL_APP_CLIENT_ID;
  const originalSecret = process.env.ZOHO_MAIL_APP_CLIENT_SECRET;
  process.env.ZOHO_MAIL_APP_CLIENT_ID = 'test'; process.env.ZOHO_MAIL_APP_CLIENT_SECRET = 'test';
  let mode = 'ok';
  const urls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input)); urls.push(url);
    if (url.pathname.endsWith('/token')) return Response.json({ access_token: 'transport-test-access', expires_in: 3600 });
    if (url.pathname === '/api/accounts') return Response.json({ data: [{ accountId: '12', primaryEmailAddress: 'hr@test.invalid' }] });
    if (url.pathname.endsWith('/view')) return Response.json({ data: [{ messageId: '78', folderId: '34', hasAttachment: '1', receivedTime: '1795327200000' }] });
    if (url.pathname.endsWith('/attachmentinfo')) {
      if (mode === 'malformed') return Response.json({ data: { unexpected: [] } });
      return Response.json({ data: { attachments: [{ attachmentId: '90', attachmentName: 'CV.pdf', attachmentSize: 5 }] } });
    }
    if (url.pathname.endsWith('/attachmentInfo')) return Response.json({ data: { ATTACHMENTS: [{ attachmentId: '90', attachmentName: 'CV.pdf' }] } });
    if (url.pathname.endsWith('/attachments/90')) return new Response('123456');
    throw new Error(`Unexpected fake request: ${url.pathname}`);
  };
  const grant = { refreshToken: 'transport-test-refresh', dc: 'in' };
  try {
    const page = await ZohoMailService.listPage({ grant }, { address: 'hr@test.invalid', folderId: '34', start: 11, limit: 10 });
    assert.equal(page.items[0].messageId, '78');
    const listUrl = urls.find(u => u.pathname.endsWith('/view'))!;
    assert.equal(listUrl.searchParams.get('folderId'), '34'); assert.equal(listUrl.searchParams.get('start'), '11');
    assert.equal(listUrl.searchParams.get('sortorder'), 'false');
    const attachments = await ZohoMailService.listAttachmentsWithGrant('78', grant, 'hr@test.invalid', '34');
    assert.equal(attachments[0].attachmentName, 'CV.pdf');
    assert.ok(urls.some(u => u.pathname === '/api/accounts/12/folders/34/messages/78/attachmentinfo'));
    mode = 'malformed';
    await assert.rejects(ZohoMailService.listAttachmentsWithGrant('78', grant, 'hr@test.invalid', '34'), /unreadable/);
    const legacy = await ZohoMailService.listAttachmentsWithGrant('78', grant, 'hr@test.invalid');
    assert.equal(legacy[0].attachmentId, '90');
    await assert.rejects(ZohoMailService.downloadAttachmentWithGrant('78', '90', grant, 'hr@test.invalid', { folderId: '34', maxBytes: 5 }), /size limit/);
    assert.equal((await ZohoMailService.downloadAttachmentWithGrant('78', '90', grant, 'hr@test.invalid', { folderId: '34', maxBytes: 10 })).toString(), '123456');
    assert.equal((await ZohoMailService.downloadAttachmentWithGrant('78', '90', grant, 'hr@test.invalid')).toString(), '123456');
    assert.ok(urls.some(u => u.pathname === '/api/accounts/12/messages/78/attachments/90'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalId === undefined) delete process.env.ZOHO_MAIL_APP_CLIENT_ID; else process.env.ZOHO_MAIL_APP_CLIENT_ID = originalId;
    if (originalSecret === undefined) delete process.env.ZOHO_MAIL_APP_CLIENT_SECRET; else process.env.ZOHO_MAIL_APP_CLIENT_SECRET = originalSecret;
  }
});

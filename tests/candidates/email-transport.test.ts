import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ZohoMailSendError, ZohoMailService } from '../../backend/services/zohoMailService';

it('sends plain text using the connected mailbox, threads replies, and distinguishes rejection from uncertain delivery', async () => {
  const originalFetch = globalThis.fetch;
  const originalId = process.env.ZOHO_MAIL_APP_CLIENT_ID;
  const originalSecret = process.env.ZOHO_MAIL_APP_CLIENT_SECRET;
  process.env.ZOHO_MAIL_APP_CLIENT_ID = 'test'; process.env.ZOHO_MAIL_APP_CLIENT_SECRET = 'test';
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  let mode = 'ok';
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/token')) return Response.json({ access_token: 'stage3-transport-access', expires_in: 3600 });
    if (url.pathname === '/api/accounts') return Response.json({ data: [{ accountId: '12', primaryEmailAddress: 'hr@test.invalid' }] });
    assert.equal(init?.method, 'POST');
    posts.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
    if (mode === 'timeout') throw new Error('timed out');
    if (mode === 'refused') return Response.json({ status: { code: 403 } }, { status: 403 });
    if (mode === 'server') return Response.json({ status: { code: 500 } }, { status: 500 });
    if (mode === 'html') return new Response('<html>unexpected</html>');
    if (mode === 'empty') return Response.json({});
    return Response.json({ status: { code: 200 }, data: { messageId: '88', threadId: '77' } });
  };
  const grant = { refreshToken: 'stage3-transport-refresh', dc: 'in' };
  const mail = { from: 'hr@test.invalid', to: 'candidate@test.invalid', subject: 'Interview', body: '<b>Plain text</b>' };
  try {
    assert.deepEqual(await ZohoMailService.sendMessageWithGrant(grant, mail), { messageId: '88', threadId: '77' });
    assert.equal(posts[0].path, '/api/accounts/12/messages');
    assert.equal(posts[0].body.mailFormat, 'plaintext'); assert.equal(posts[0].body.fromAddress, mail.from);
    assert.equal(posts[0].body.content, mail.body); assert.equal(posts[0].body.ccAddress, undefined);
    await ZohoMailService.sendMessageWithGrant(grant, { ...mail, replyMessageId: '66' });
    assert.equal(posts[1].path, '/api/accounts/12/messages/66'); assert.equal(posts[1].body.action, 'reply');
    for (const [next, rejected] of [['timeout', false], ['refused', true], ['server', false], ['html', false], ['empty', false]] as const) {
      mode = next;
      const count = posts.length;
      await assert.rejects(ZohoMailService.sendMessageWithGrant(grant, mail), error => error instanceof ZohoMailSendError && error.rejected === rejected);
      assert.equal(posts.length, count + 1, 'never retries an external send automatically');
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalId === undefined) delete process.env.ZOHO_MAIL_APP_CLIENT_ID; else process.env.ZOHO_MAIL_APP_CLIENT_ID = originalId;
    if (originalSecret === undefined) delete process.env.ZOHO_MAIL_APP_CLIENT_SECRET; else process.env.ZOHO_MAIL_APP_CLIENT_SECRET = originalSecret;
  }
});

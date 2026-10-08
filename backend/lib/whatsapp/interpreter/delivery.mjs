export function providerIds(body) {
    const nodes = [body, body?.data, body?.message, body?.data?.message,
        ...(Array.isArray(body?.messages) ? body.messages : []), ...(Array.isArray(body?.data?.messages) ? body.data.messages : [])];
    const ids = nodes.flatMap((node,index) => node && typeof node === 'object' ? [...(index >= 2 ? [node.id] : []), node.messageId, node.message_id, node.submitted_message_id,
        node.wamid] : []);
    return [...new Set(ids.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 512))];
}

export async function sendSessionReply(phone, text, lastInboundAt, options = {}) {
    const env = options.env || process.env;
    const now = (options.now || new Date()).getTime(), stamp = Date.parse(lastInboundAt);
    if (!Number.isFinite(stamp) || stamp > now + 60000 || now - stamp >= 24 * 60 * 60 * 1000) return { success:false, error:'SESSION_WINDOW_CLOSED', retryable:false };
    if (!env.AISENSY_PROJECT_ID || !env.AISENSY_PROJECT_API_KEY) return { success:false, error:'PROJECT_API_NOT_CONFIGURED', retryable:false };
    if (!/^\d{11,15}$/.test(phone) || !text || text.length > 4096) return { success:false, error:'INVALID_REPLY', retryable:false };
    try {
        const result = await (options.fetch || globalThis.fetch)(`https://apis.aisensy.com/project-apis/v1/project/${encodeURIComponent(env.AISENSY_PROJECT_ID)}/messages`, {
            method:'POST', headers:{ Accept:'application/json', 'Content-Type':'application/json', 'X-AiSensy-Project-API-Pwd':env.AISENSY_PROJECT_API_KEY },
            body:JSON.stringify({to:phone,type:'text',recipient_type:'individual',text:{body:text}}), signal:AbortSignal.timeout(15000),
        });
        if (!result.ok) return {success:false,error:`PROJECT_API_HTTP_${result.status}`,retryable:result.status >= 500 || [408,409,425,429].includes(result.status)};
        // A 2xx acceptance without JSON/IDs must not be resent as a failed request.
        let body;
        try { body = await result.json(); }
        catch { return {success:true,messageIds:[]}; }
        if (body?.success === false || body?.error) return {success:false,error:'PROJECT_API_REJECTED',retryable:false};
        return {success:true,messageIds:providerIds(body)};
    } catch { return {success:false,error:'PROJECT_API_UNAVAILABLE',retryable:true}; }
}

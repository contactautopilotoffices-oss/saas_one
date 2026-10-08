import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const invalid = (mediaReason='invalid_media', details={}) => Object.assign(new Error('Invalid photo. Please send a supported photo again, or reply No Photo.'), {code:'INVALID_MEDIA',mediaReason,...details});
const DEFAULT_HOSTS = ['whatsapp-media-library-stg.s3.ap-south-1.amazonaws.com','whatsapp-media-library.s3.ap-south-1.amazonaws.com'];
export function validateMediaUrl(value, env=process.env) {
    let url;
    try { url=new URL(value); } catch {throw invalid('invalid_url');}
    const allowed=(env.WHATSAPP_MEDIA_ALLOWED_HOSTS || DEFAULT_HOSTS.join(',')).split(',').map(host=>host.trim().toLowerCase()).filter(Boolean);
    if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || isIP(url.hostname)) throw invalid('invalid_url');
    if(!allowed.includes(url.hostname.toLowerCase())) throw invalid('host_not_allowed');
    return url;
}
export function publicIPv4(address) {
    if(isIP(address)!==4)return false;
    const [a,b]=address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) ||
        (a===192&&(b===168||b===0)) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19)));
}
export async function fetchPhoto(value,options={}) {
    const url=validateMediaUrl(value,options.env);
    const signal=AbortSignal.timeout(10000);
    const lookup=options.lookup || dnsLookup;
    let addresses;
    try {
        addresses=await Promise.race([lookup(url.hostname,{all:true,family:4}),new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(invalid()),{once:true}))]);
    } catch {throw invalid(signal.aborted?'timeout':'dns_failed');}
    if(!Array.isArray(addresses) || !addresses.length || addresses.some(record=>!publicIPv4(record.address)))throw invalid('private_address');
    const address=addresses[0].address;
    // Pin the approved DNS result for this connection. Reject every redirect.
    return new Promise((resolve,reject)=>{
        const req=(options.request || httpsRequest)(url,{signal,family:4,headers:{Accept:'image/jpeg,image/png,image/webp,image/gif'},
            lookup:(_host,lookupOptions,callback)=>lookupOptions.all?callback(null,[{address,family:4}]):callback(null,address,4)},res=>{
            const max=10*1024*1024;
            const mime=String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            const binary=['','application/octet-stream','binary/octet-stream'].includes(mime);
            const mimeAllowed=binary || /^image\/(jpeg|jpg|png|webp|gif)$/.test(mime);
            const reason=res.statusCode!==200?'http_error':!mimeAllowed?'unsupported_type':Number(res.headers['content-length'])>max?'too_large':null;
            if(reason) {
                res.destroy();req.destroy();reject(invalid(reason,{httpStatus:res.statusCode}));return;
            }
            const chunks=[];let bytes=0;
            res.on('data',chunk=>{bytes+=chunk.length;if(bytes>max){res.destroy();req.destroy();reject(invalid('too_large'));}else chunks.push(chunk);});
            res.on('error',()=>reject(invalid('download_failed')));
            res.on('end',()=>{
                if(!bytes || bytes>max){reject(invalid(bytes?'too_large':'empty_content'));return;}
                const buffer=Buffer.concat(chunks);
                // Provider object storage can label a real image as binary. Only
                // known image signatures may pass; sharp still decodes and bounds
                // the pixels before ticket creation.
                const image=buffer.subarray(0,3).equals(Buffer.from([255,216,255])) ||
                    buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
                    /^GIF8[79]a$/.test(buffer.subarray(0,6).toString('ascii')) ||
                    (buffer.subarray(0,4).toString('ascii')==='RIFF' && buffer.subarray(8,12).toString('ascii')==='WEBP');
                if(binary&&!image){reject(invalid('unsupported_type'));return;}
                resolve(buffer);
            });
        });
        req.on('error',()=>reject(invalid(signal.aborted?'timeout':'download_failed')));req.end();
    });
}

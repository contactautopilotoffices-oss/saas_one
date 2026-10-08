import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMediaUrl, publicIPv4, fetchPhoto } from '../backend/lib/whatsapp/interpreter/media.mjs';
import { EventEmitter } from 'node:events';
test('photo ingestion accepts only configured exact HTTPS provider hosts and public network addresses',()=>{
    const env={WHATSAPP_MEDIA_ALLOWED_HOSTS:'media.aisensy.com'};
    assert.equal(validateMediaUrl('https://media.aisensy.com/photo.jpg',env).hostname,'media.aisensy.com');
    for(const url of ['http://media.aisensy.com/photo','https://other.example.com/photo','https://media.aisensy.com.evil.com/photo','https://user:pass@media.aisensy.com/photo','https://media.aisensy.com:444/photo','https://127.0.0.1/photo']) assert.throws(()=>validateMediaUrl(url,env),/Invalid photo/);
    for(const ip of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.1.1.1','::1']) assert.equal(publicIPv4(ip),false,ip);
    assert.equal(publicIPv4('8.8.8.8'),true);
});

function requestFixture({status=200,mime='image/jpeg',chunks=[Buffer.from('image-content')],length}={}) {
    let options;
    return {get options(){return options;},request(_url,config,callback){options=config;const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{
        const res=new EventEmitter();res.statusCode=status;res.headers={'content-type':mime,...(length!==undefined?{'content-length':length}:{})};res.destroy=()=>{};
        callback(res);for(const chunk of chunks)res.emit('data',chunk);res.emit('end');
    });return req;}};
}
test('download pins DNS, rejects redirects and non-image content, and bounds streamed bytes',async()=>{
    const base={env:{WHATSAPP_MEDIA_ALLOWED_HOSTS:'media.aisensy.com'},lookup:async()=>[{address:'8.8.8.8'}]};
    const image=requestFixture();
    const buffer=await fetchPhoto('https://media.aisensy.com/photo',{...base,request:image.request});
    assert.equal(buffer.toString(),'image-content');
    image.options.lookup('media.aisensy.com',{all:false},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
    for(const value of [{status:302},{mime:'text/html'},{length:11*1024*1024},{chunks:[Buffer.alloc(11*1024*1024)]}]) {
        const fixture=requestFixture(value);
        await assert.rejects(fetchPhoto('https://media.aisensy.com/photo',{...base,request:fixture.request}),/Invalid photo/);
    }
});
test('private DNS result is rejected before requesting the image',async()=>{
    await assert.rejects(fetchPhoto('https://media.aisensy.com/photo',{env:{WHATSAPP_MEDIA_ALLOWED_HOSTS:'media.aisensy.com'},lookup:async()=>[{address:'127.0.0.1'}],request:()=>assert.fail('no private network request')}),/Invalid photo/);
});

test('a real provider image with a binary content type is accepted by its image signature',async()=>{
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=','base64');
    const base={env:{WHATSAPP_MEDIA_ALLOWED_HOSTS:'media.aisensy.com'},lookup:async()=>[{address:'8.8.8.8'}]};
    for(const mime of ['application/octet-stream','binary/octet-stream','']) {
        const fixture=requestFixture({mime,chunks:[png]});
        assert.deepEqual(await fetchPhoto('https://media.aisensy.com/photo',{...base,request:fixture.request}),png);
    }
    const text=requestFixture({mime:'application/octet-stream',chunks:[Buffer.from('<html>access denied</html>')]});
    await assert.rejects(fetchPhoto('https://media.aisensy.com/photo',{...base,request:text.request}),error=>error.code==='INVALID_MEDIA'&&error.mediaReason==='unsupported_type');
});

test('photo diagnostics distinguish host configuration and expired links without returning a signed URL',async()=>{
    assert.throws(()=>validateMediaUrl('https://unconfigured.example/photo?token=secret',{}),error=>error.code==='INVALID_MEDIA'&&error.mediaReason==='host_not_allowed'&&!JSON.stringify(error).includes('secret'));
    const fixture=requestFixture({status:403});
    await assert.rejects(fetchPhoto('https://media.aisensy.com/photo?token=secret',{env:{WHATSAPP_MEDIA_ALLOWED_HOSTS:'media.aisensy.com'},lookup:async()=>[{address:'8.8.8.8'}],request:fixture.request}),
        error=>error.mediaReason==='http_error'&&error.httpStatus===403&&!JSON.stringify(error).includes('secret'));
});

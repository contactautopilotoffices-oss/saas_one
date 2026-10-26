'use client';
import { useEffect, useState } from 'react';

interface Config { enabled:boolean; bookingEnabled:boolean; ticketEnabled:boolean; defaultDate:'ask'|'today'; accessMode:'selected'|'all'; pilotUserIds:string[] }
interface OrganizationUser { id:string; name:string; email:string; phone:string; selectable:boolean }
const initial:Config={enabled:false,bookingEnabled:true,ticketEnabled:true,defaultDate:'ask',accessMode:'selected',pilotUserIds:[]};

export default function AssistantSettings({organizationId}:{organizationId:string}) {
    const [config,setConfig]=useState<Config>(initial);
    const [userId,setUserId]=useState('');
    const [users,setUsers]=useState<OrganizationUser[]>([]);
    const [search,setSearch]=useState('');
    const [reload,setReload]=useState(0);
    const [loaded,setLoaded]=useState(false);
    const [status,setStatus]=useState('');
    const [busy,setBusy]=useState(false);
    const [workflow,setWorkflow]=useState<'booking'|'ticket'>('booking');
    const [sample,setSample]=useState('Book conference room 1 tomorrow from 2.30 PM to 3 PM');
    const [preview,setPreview]=useState('');
    const [previewExplanation,setPreviewExplanation]=useState('');
    const [readiness,setReadiness]=useState<{llm:boolean;projectApi:boolean;globalEnabled:boolean}|null>(null);
    useEffect(()=>{
        const controller=new AbortController();
        setLoaded(false);setStatus('');setUsers([]);setConfig(initial);setUserId('');setSearch('');setReadiness(null);setPreview('');setPreviewExplanation('');
        const url=`/api/whatsapp-assistant/settings?organizationId=${encodeURIComponent(organizationId)}`;
        Promise.all([url,`${url}&view=users`].map(async endpoint=>{
            const response=await fetch(endpoint,{signal:controller.signal,cache:'no-store'});
            const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
        })).then(([data,directory])=>{
            if(controller.signal.aborted)return;
            setConfig({...initial,...data.config});setUsers(directory.users);setUserId(data.userId);setReadiness(data.readiness);setLoaded(true);
        })
            .catch(error=>{if(error.name!=='AbortError')setStatus(error.message);});
        return()=>controller.abort();
    },[organizationId,reload]);
    const selected=config.pilotUserIds.map(id=>users.find(user=>user.id===id)||{id,name:'Unavailable account',email:'',phone:'',selectable:false});
    const query=search.trim().toLowerCase();
    const matches=users.filter(user=>!config.pilotUserIds.includes(user.id)&&[user.name,user.email,user.phone].some(value=>value.toLowerCase().includes(query)));
    function addUser(id:string) {
        setConfig(current=>current.pilotUserIds.includes(id)||current.pilotUserIds.length>=100?current:{...current,pilotUserIds:[...current.pilotUserIds,id]});
    }
    async function request(method:'PUT'|'POST') {
        setBusy(true);setStatus('');
        if(method==='POST'){setPreview('');setPreviewExplanation('');}
        try {
            const body=method==='PUT'?{organizationId,config}:{organizationId,workflow,text:sample};
            const response=await fetch('/api/whatsapp-assistant/settings',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            const data=await response.json();if(!response.ok)throw new Error(data.error);
            if(method==='PUT'){setConfig(data.config);setStatus('WhatsApp AI settings saved.');}
            else {
                setPreview(JSON.stringify(data,null,2));
                setPreviewExplanation(data.result?.ok
                    ? 'AI interpreted the message. This preview has not created a booking or ticket.'
                    : `${data.result?.diagnostics?.hint || 'AI could not interpret the message. Check the result below.'} No booking or ticket was created.`);
            }
        } catch(error){setStatus(error instanceof Error?error.message:'Request failed');}
        finally{setBusy(false);}
    }
    return <section className="mt-8 border-t pt-8 space-y-4">
        <h3 className="text-lg font-semibold">WhatsApp AI</h3>
        <p className="text-sm text-slate-600">Users can choose a service from the menu or directly ask to book a meeting room. Clear booking instructions book immediately after access, availability and tenant credit checks; missing details prompt a question. Tickets still require Submit Ticket.</p>
        {!loaded&&(!status?<p role="status" className="text-sm text-slate-600">Loading WhatsApp AI settings and organization users…</p>:<div className="rounded border border-red-200 bg-red-50 p-3 space-y-2">
            <p role="alert" className="text-sm text-red-800">{status}</p>
            <button type="button" className="underline text-sm" onClick={()=>setReload(value=>value+1)}>Retry loading settings</button>
        </div>)}
        {readiness && <p className="text-sm">AI key: {readiness.llm?'ready':'missing'} · Project messaging: {readiness.projectApi?'ready':'missing'} · Global switch: {readiness.globalEnabled?'on':'off'}</p>}
        <fieldset disabled={!loaded||busy} className="space-y-4 disabled:opacity-60">
            {(['enabled','bookingEnabled','ticketEnabled'] as const).map(key=><label key={key} className="flex gap-2 items-center"><input type="checkbox" checked={config[key]} onChange={event=>setConfig({...config,[key]:event.target.checked})}/>{({enabled:'Enable WhatsApp AI for this organization',bookingEnabled:'Allow meeting-room booking',ticketEnabled:'Allow ticket creation'})[key]}</label>)}
            <label className="block">When the booking date is missing <select className="border rounded ml-2 p-2" value={config.defaultDate} onChange={event=>setConfig({...config,defaultDate:event.target.value as Config['defaultDate']})}><option value="ask">Ask the user</option><option value="today">Use today (reviewed bookings only)</option></select></label>
            <label className="block">Who can use WhatsApp AI <select className="border rounded ml-2 p-2" value={config.accessMode} onChange={event=>setConfig({...config,accessMode:event.target.value as Config['accessMode']})}>
                <option value="selected">Selected users — testing</option><option value="all">All authorized users — live</option>
            </select></label>
            {config.accessMode==='all'?<p className="text-sm text-slate-600">After saving, all approved users with access to this organization’s properties can use the enabled services. Their existing property permissions and tenant credit rules still apply.</p>:loaded&&<div className="space-y-3">
                <p className="text-sm text-slate-600">Choose up to 100 test users. Each user needs an approved account and a valid WhatsApp number in their profile.</p>
                <p className="font-medium text-sm">Selected test users ({selected.length})</p>
                {selected.length===0&&<p className="text-sm text-slate-500">No test users selected yet.</p>}
                <ul className="space-y-2">{selected.map(user=><li key={user.id} className="flex items-center justify-between gap-3 border rounded p-2 text-sm">
                    <div><span className="font-medium">{user.name||user.email||user.phone}</span><span className="block text-slate-500">{[user.email,user.phone].filter(Boolean).join(' · ')}</span>
                    {!user.selectable&&<span className="text-amber-700">Account approval, active membership or a valid phone number is required. Remove this selection before saving.</span>}</div>
                    <button type="button" aria-label={`Remove ${user.name||user.email||user.phone}`} className="text-red-700 underline" onClick={()=>setConfig(current=>({...current,pilotUserIds:current.pilotUserIds.filter(id=>id!==user.id)}))}>Remove</button>
                </li>)}</ul>
                <button type="button" className="text-sm underline" disabled={!users.some(user=>user.id===userId&&user.selectable)||config.pilotUserIds.includes(userId)||selected.length>=100} onClick={()=>addUser(userId)}>Add my account to testing</button>
                <label className="block text-sm">Search organization users<input type="search" className="block border rounded p-2 w-full mt-1" value={search} placeholder="Name, email or phone number" onChange={event=>setSearch(event.target.value)}/></label>
                <ul className="max-h-64 overflow-y-auto space-y-2">{matches.slice(0,50).map(user=><li key={user.id} className="flex items-center justify-between gap-3 border rounded p-2 text-sm">
                    <div><span className="font-medium">{user.name||user.email||user.phone}</span><span className="block text-slate-500">{[user.email,user.phone].filter(Boolean).join(' · ')}</span>
                    {!user.selectable&&<span className="text-amber-700">Approval and a valid WhatsApp phone number required.</span>}</div>
                    <button type="button" aria-label={`Add ${user.name||user.email||user.phone}`} className="text-primary underline" disabled={!user.selectable||selected.length>=100} onClick={()=>addUser(user.id)}>Add</button>
                </li>)}</ul>
                {matches.length===0&&<p className="text-sm text-slate-500">No matching unselected users.</p>}
                {matches.length>50&&<p className="text-sm text-slate-500">Showing 50 of {matches.length} matches. Refine your search to find a user.</p>}
            </div>}
            <div><button type="button" className="bg-primary text-white rounded px-4 py-2" onClick={()=>request('PUT')}>Save AI settings</button></div>
            <h4 className="font-semibold">Try a message without creating anything</h4>
            <p className="text-sm text-slate-600">This checks whether AI understands your message. It does not send WhatsApp messages or create bookings or tickets.</p>
            <select aria-label="Preview workflow" className="border rounded p-2" value={workflow} onChange={event=>setWorkflow(event.target.value as typeof workflow)}><option value="booking">Meeting-room booking</option><option value="ticket">Ticket creation</option></select>
            <textarea aria-label="Sample WhatsApp message" className="block border rounded p-2 w-full" value={sample} rows={2} onChange={event=>setSample(event.target.value)}/>
            <button type="button" className="border rounded px-4 py-2" onClick={()=>request('POST')}>Preview interpretation</button>
        </fieldset>
        {loaded&&status&&<p role="status" className="text-sm">{status}</p>}
        {previewExplanation&&<p role="status" className="text-sm">{previewExplanation}</p>}
        {preview&&<pre className="bg-slate-50 rounded p-3 text-xs whitespace-pre-wrap">{preview}</pre>}
    </section>;
}

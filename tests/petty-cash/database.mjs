import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
export const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export async function setup({ enumRoles = true } = {}){
 const db=new PGlite();
 await db.exec(`CREATE ROLE service_role; CREATE ROLE authenticated; CREATE ROLE anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
 CREATE TABLE organizations(id uuid primary key); CREATE TABLE users(id uuid primary key,full_name text,email text,is_master_admin boolean default false);
 CREATE TABLE properties(id uuid primary key,organization_id uuid,name text,code text,deleted_at timestamptz,is_active boolean default true);
 CREATE TYPE public.app_role AS ENUM ('org_super_admin','ops_super_admin','accounts','mst','staff','property_admin','food_vendor','tenant','vendor');
 CREATE TABLE organization_memberships(user_id uuid,organization_id uuid,role ${enumRoles ? 'app_role' : 'text'},is_active boolean default true);
 CREATE TABLE property_memberships(user_id uuid,organization_id uuid,property_id uuid,role ${enumRoles ? 'app_role' : 'text'},is_active boolean default true);
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE POLICY existing_storage_read ON storage.objects FOR SELECT TO authenticated USING(true);
 CREATE PUBLICATION supabase_realtime;
 INSERT INTO organizations VALUES ('${id(1)}'),('${id(2)}');
 INSERT INTO users(id,full_name) SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Fixture '||n FROM generate_series(10,19)n;
 INSERT INTO properties(id,organization_id,name,code) VALUES ('${id(3)}','${id(1)}','Property A','A'),('${id(4)}','${id(1)}','Property B','B');
 INSERT INTO organization_memberships(user_id,organization_id,role) VALUES ('${id(10)}','${id(1)}','org_super_admin'),('${id(14)}','${id(1)}','accounts');
 INSERT INTO property_memberships(user_id,organization_id,property_id,role) VALUES ('${id(11)}','${id(1)}','${id(3)}','mst'),('${id(12)}','${id(1)}','${id(3)}','staff'),('${id(13)}','${id(1)}','${id(3)}','property_admin'),('${id(15)}','${id(1)}','${id(3)}','food_vendor'),('${id(16)}','${id(1)}','${id(3)}','staff');`);
 for(const file of ['20260723000002_petty_cash.sql','20260903000001_petty_cash_ledger.sql','20260912000002_add_assigned_approver_to_petty_cash.sql','20261003000001_petty_cash_allocation_wallet.sql','20261004000001_petty_cash_plan_completion.sql','20261005000002_petty_cash_optional_expense_bills.sql','20261006000001_petty_cash_pending_counts.sql']) await db.exec(await readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.query('select pc_configure($1,$2,$3,$4)',[id(10),id(3),id(12),id(13)]);
 return db;
}
export const call=async(db,fn,args)=>(await db.query(`select ${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
export const create=(db,extra={})=>call(db,'pc_create_request',[id(11),id(1),{amount_requested:100,purpose:'Fixture cash',...extra}]);
export const action=(db,user,req,kind,extra={})=>call(db,'pc_action',[id(user),req.id,kind,{expected_version:req.version,...extra}]);
export async function paid(db){let r=await create(db);r=await action(db,12,r,'allocate',{allocated_amount:100});r=await action(db,13,r,'approve');const proof=await evidence(db,14);return action(db,14,r,'pay',{payment_ref:'TEST',paid_mode:'UPI',documents:[{upload_id:proof}]});}
export async function evidence(db,owner=11){const upload=id(90+owner);await db.query('insert into petty_cash_uploads(id,organization_id,uploaded_by,storage_path,file_name,file_type) values ($1,$2,$3,$4,$5,$6) on conflict do nothing',[upload,id(1),id(owner),`${id(1)}/${id(owner)}/${upload}.pdf`,'fixture.pdf','application/pdf']);return upload;}

const allocator={id:'00000000-0000-0000-0000-000000000012',full_name:'Fixture Allocator',email:'allocator@example.test'};
const accounts={id:'00000000-0000-0000-0000-000000000014',full_name:'Fixture Accounts',email:'accounts@example.test'};
const vendor={id:'00000000-0000-0000-0000-000000000015',full_name:'Fixture Vendor',email:'vendor@example.test'};
class Query {
    constructor(private table:string){}
    select(){return this;}eq(){return this;}in(){return this;}order(){return this;}limit(){return this;}gte(){return this;}maybeSingle(){return this;}
    async execute(){let data:any=[];if(this.table==='organization_settings')data=await (await fetch('/api/admin/organizations/00000000-0000-0000-0000-000000000001')).json();else if(this.table==='organization_memberships')data=[{user_id:accounts.id,role:'accounts',users:accounts}];else if(this.table==='properties')data=[{id:'property-a',name:'Fixture Property'}];else if(this.table==='property_memberships')data=[{user_id:allocator.id,property_id:'property-a',role:'staff',users:allocator},{user_id:vendor.id,property_id:'property-a',role:'vendor',users:vendor}];else if(this.table==='users')data=[allocator,accounts,vendor];return {data,error:null};}
    then(resolve:any,reject:any){return this.execute().then(resolve,reject);}
}
const client={from:(table:string)=>new Query(table)};
export function createClient(){return client;}

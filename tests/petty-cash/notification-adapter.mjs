/** Test transport backed by real isolated PostgreSQL; providers are fixture adapters. */
export function notificationAdapter(db){
 const identifier=name=>{if(!/^[a-z_]+$/.test(name))throw Error('Invalid fixture SQL identifier');return name;};
 class Query {
  constructor(table){this.table=identifier(table);this.filters=[];this.mode='select';this.returning=false;this.one=false;}
  select(){this.returning=true;return this;}
  order(){return this;}
  single(){this.one=true;return this;}
  insert(rows){this.mode='insert';this.rows=Array.isArray(rows)?rows:[rows];return this;}
  eq(column,value){this.filters.push({column:identifier(column),value});return this;}
  in(column,value){this.filters.push({column:identifier(column),value,in:true});return this;}
  update(value){this.mode='update';this.values=value;return this;}
  upsert(rows){this.mode='insert';this.rows=Array.isArray(rows)?rows:[rows];return this;}
  maybeSingle(){this.one=true;return this;}
  async execute(){
   try{
    const args=[];let sql;
    if(this.mode==='insert'){
     const columns=Object.keys(this.rows[0]).map(identifier);const tuples=this.rows.map(row=>'('+columns.map(column=>{args.push(row[column]);return '$'+args.length;}).join(',')+')');
     sql=`insert into ${this.table}(${columns.join(',')}) values ${tuples.join(',')} on conflict do nothing returning *`;
    }else{
     if(this.mode==='update')sql=`update ${this.table} set `+Object.entries(this.values).map(([column,value])=>{args.push(value);return `${identifier(column)}=$${args.length}`;}).join(',');else sql=`select * from ${this.table}`;
     if(this.filters.length)sql+=' where '+this.filters.map(filter=>{args.push(filter.value);return filter.in?`${filter.column}::text=any($${args.length}::text[])`:`${filter.column}=$${args.length}`;}).join(' and ');
     if(this.mode==='update')sql+=' returning *';
    }
    const rows=(await db.query(sql,args)).rows;return {data:this.one?rows[0]||null:rows,error:null};
   }catch(error){return {data:null,error:{message:error.message}};}
  }
  then(resolve,reject){return this.execute().then(resolve,reject);}
 }
 return {from:table=>new Query(table),rpc:async(name,args)=>{
  try{
   const params=name==='pc_notification_recipients'?[args.rid,args.feature,args.rule]:[args.batch_limit,args.target_event,args.target_channel];
   return {data:(await db.query(`select * from ${identifier(name)}(${params.map((_,i)=>'$'+(i+1)).join(',')})`,params)).rows,error:null};
  }catch(error){return {data:null,error:{message:error.message}};}
 }};
}

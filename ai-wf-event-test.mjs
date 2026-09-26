// Item 35 — AI quick customer registration → real event → real workflow (self-cleaning)
import { createRequire } from 'node:module';
const require = createRequire('/home/user/baspar-crm/x.js');
const B = 'http://localhost:3050';
let pass=0, fail=0;
const ok=(n,c,x='')=>{ if(c){pass++;console.log('PASS',n,x);}else{fail++;console.log('FAIL',n,x);} };
const j=async(r)=>({status:r.status,d:await r.json().catch(()=>({}))});
const login=async(u,p)=>{const r=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});return (await r.json()).access;};

(async()=>{
  const A=await login('admin','admin1234');
  const H={Authorization:'Bearer '+A,'Content-Type':'application/json'};

  // 1) AI registers a customer via chat
  const stamp=Date.now().toString().slice(-6);
  const mobile='0912'+String(1000000+Number(stamp)).slice(0,7);
  const q='ثبت مشتری شرکت تست AI '+stamp+'، موبایل '+mobile+'، شهر شیراز';
  let r=await fetch(B+'/api/ai/chat',{method:'POST',headers:H,body:JSON.stringify({query:q})});
  let b=await j(r);
  console.log('AI resp:', JSON.stringify(b.d).slice(0,300));
  ok('AI-1 register_customer intent', b.d.intent==='register_customer', 'intent='+b.d.intent);
  const cid=b.d.data&&b.d.data.customer;
  ok('AI-2 customer created via AI', !!cid, 'id='+cid);
  ok('AI-3 customer number assigned', b.d.data && !!b.d.data.number, 'number='+(b.d.data&&b.d.data.number));
  ok('AI-4 workflow triggered from AI event', (b.d.data&&b.d.data.workflows&&b.d.data.workflows.length)>=1, 'wf='+JSON.stringify(b.d.data&&b.d.data.workflows));

  // 2) verify customer persisted in DB
  r=await fetch(B+'/api/r/customer/'+cid,{headers:H});
  const cb=await j(r);
  ok('AI-5 customer persisted in DB', cb.d.item && cb.d.item.name, 'name='+(cb.d.item&&cb.d.item.name));
  ok('AI-6 mobile persisted', cb.d.item && cb.d.item.mobile===mobile, 'mobile='+(cb.d.item&&cb.d.item.mobile));

  // 3) workflow instance created for this customer (event → engine)
  r=await fetch(B+'/api/wf/entity/customer/'+cid+'/instances',{headers:H});
  const ib=await j(r);
  const insts=ib.d.items||[];
  ok('AI-7 workflow instance exists (event→engine)', insts.length>=1, 'n='+insts.length);
  ok('AI-8 execution ID format WF-YYYY-NNNNNN', insts.length>=1 && /^WF-\d{4}-\d{6}$/.test(insts[0].execution_no||''), 'execNo='+(insts[0]&&insts[0].execution_no));

  // 4) duplicate detection (same name/mobile again)
  r=await fetch(B+'/api/ai/chat',{method:'POST',headers:H,body:JSON.stringify({query:q})});
  const d2=await j(r);
  ok('AI-9 duplicate detected (no double create)', d2.d.note==='duplicate', 'note='+(d2.d.note));

  // 5) needs-name case
  r=await fetch(B+'/api/ai/chat',{method:'POST',headers:H,body:JSON.stringify({query:'ثبت مشتری'})});
  const nn=await j(r);
  ok('AI-10 asks for name when missing', nn.d.note==='needs_name', 'note='+(nn.d.note));

  // 6) RBAC: a user without customer:create should be denied
  const lab=await login('saeid.t','12345678');
  if (lab) {
    r=await fetch(B+'/api/ai/chat',{method:'POST',headers:{Authorization:'Bearer '+lab,'Content-Type':'application/json'},body:JSON.stringify({query:q})});
    const rb=await j(r);
    ok('AI-11 RBAC deny (no create perm)', rb.d.note==='no_permission', 'note='+(rb.d.note));
  }

  // cleanup
  await fetch(B+'/api/r/customer/'+cid+'?hard=1',{method:'DELETE',headers:H});
  await fetch(B+'/api/r/customer/'+ (rp=>rp)(0) + '?hard=1',{method:'DELETE',headers:H}).catch(()=>{});

  console.log('');
  console.log('AI-WF EVENT: '+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});

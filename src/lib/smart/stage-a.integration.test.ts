import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDatabase } from './stage-a-db.fixture';
import { startSmartFlow, evaluateSmartRun, smartPreSendCheck } from './engine.server';
import { executeClaimedAction } from '../followup/engine.server';
import { patchControl } from './control.server';
import { nextSilenceContact } from './post-quote-cadence';
import { recordPostQuoteAccepted } from './post-quote-runtime.server';
const fake=vi.hoisted(()=>({send:vi.fn(),decision:vi.fn()}));
vi.mock('@/lib/audit/log.server',()=>({writeAudit:vi.fn()}));
vi.mock('@/lib/crm.server',()=>({logEvent:vi.fn()}));
vi.mock('./decision.server',()=>({decideNextStep:fake.decision}));
vi.mock('./learning.server',()=>({strategyPerformance:async()=>[],describePerformance:()=>'',rankStrategies:()=>[]}));
vi.mock('./timing.server',()=>({learnContactTiming:async()=>({preferredHour:null}),alignToPreferredHour:({target}:{target:Date})=>target}));
vi.mock('./return.server',()=>({consultantNotes:async()=>[]}));
vi.mock('./quality.server',()=>({reviewMessage:()=>({verdict:'accept'})}));
vi.mock('@/lib/whatsapp/store.server',()=>({loadPrimaryConnection:async()=>({status:'connected'})}));
vi.mock('@/lib/whatsapp/service.server',()=>({sendText:fake.send}));
vi.mock('@/lib/automation/policy.server',()=>({loadPolicySettings:async()=>({}),evaluatePolicy:async()=>({decision:'allowed',rules:[],reason:'allowed'})}));
vi.mock('@/lib/automation/audit.server',()=>({recordDecision:vi.fn()}));
vi.mock('@/lib/automation/adaptive.server',()=>({resolveAdaptiveContent:async(_db:unknown,_action:unknown,_policy:unknown,text:string)=>({kind:'send',text,media:null})}));
const user='10000000-0000-4000-8000-000000000001',contact='10000000-0000-4000-8000-000000000002',conv='10000000-0000-4000-8000-000000000003',flow='10000000-0000-4000-8000-000000000004',opp='10000000-0000-4000-8000-000000000005';
let fixture:Awaited<ReturnType<typeof testDatabase>>;
const db=()=>fixture.db as never;
beforeEach(async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-03-09T12:00:00Z'));
 fixture=await testDatabase();
 await fixture.pg.exec(`INSERT INTO contacts(id,user_id,name)VALUES('${contact}','${user}','Teste'); INSERT INTO opportunities(id,user_id,contact_id,status,next_action_description)VALUES('${opp}','${user}','${contact}','open','Tarefa manual'); INSERT INTO followup_flows(id,user_id,kind,is_active,name,window_start,window_end)VALUES('${flow}','${user}','smart',true,'Teste','09:00','19:00'); INSERT INTO smart_flow_configs(flow_id,user_id,autonomy,max_duration_days,min_hours_between_actions,max_actions_per_week,max_pressure,confidence_min,goal,allowed_strategies)VALUES('${flow}','${user}','auto',90,36,2,100,0.6,'Acompanhar', '["CHECK_IN"]'); INSERT INTO conversation_control(conversation_id,user_id,owner,next_responsible,context_version)VALUES('${conv}','${user}','ai','customer',1);`);
 fake.decision.mockResolvedValue({action:'send',message:'Como ficou sua análise da proposta?',strategy:'CHECK_IN',waitHours:0,confidence:0.9,reason:'Cadência',nextResponsible:'customer'});
 fake.send.mockImplementation(async()=>({messageId:crypto.randomUUID()}));
});
afterEach(async()=>{vi.useRealTimers();await fixture.pg.close();vi.clearAllMocks();});
async function start(){return startSmartFlow(db(),user,{flowId:flow,contactId:contact,conversationId:conv,opportunityId:opp,policyKey:'post_quote_v1'});}
async function actionFor(runId:string){const r=await fixture.pg.query('SELECT * FROM scheduled_actions WHERE flow_run_id=$1 ORDER BY created_at DESC',[runId]);return r.rows[0] as Record<string,unknown>;}
async function runFor(runId:string){return (await fixture.pg.query('SELECT * FROM followup_runs WHERE id=$1',[runId])).rows[0] as Record<string,unknown>;}
describe('Stage A actual engine + isolated PostgreSQL + fake provider',()=>{
 it('activate → persist → execute → accepted → next; first Smart send stays active',async()=>{
  const {runId}=await start();expect((await runFor(runId))['next_contact_at']).toEqual(new Date('2026-03-10T13:00:00Z'));
  expect(await evaluateSmartRun(db(),runId)).toBe('waiting_cadence');
  vi.setSystemTime(new Date('2026-03-10T13:00:00Z'));
  expect(await evaluateSmartRun(db(),runId)).toBe('scheduled');
  const action=await actionFor(runId);
  expect((await fixture.pg.query('SELECT context_version FROM conversation_control')).rows[0]).toEqual({context_version:1});
  await fixture.pg.query("UPDATE scheduled_actions SET status='processing' WHERE id=$1",[action['id']]);
  expect(await executeClaimedAction(db(),action as never)).toBe('sent');
  const run=await runFor(runId);expect(run['status']).toBe('active');expect(run['contacts_done']).toBe(1);expect(run['next_contact_at']).toEqual(new Date('2026-03-13T18:00:00Z'));
  expect(fake.send).toHaveBeenCalledTimes(1);
 });
 it('operational update does not stale text; real context changes atomically',async()=>{
  await patchControl(db(),conv,{decision_reason:'operational'},{bumpVersion:false});
  expect((await fixture.pg.query('SELECT context_version FROM conversation_control')).rows[0]).toEqual({context_version:1});
  await Promise.all([patchControl(db(),conv,{owner:'human'}),patchControl(db(),conv,{state:'waiting_human'})]);
  expect((await fixture.pg.query('SELECT context_version FROM conversation_control')).rows[0]).toEqual({context_version:3});
 });
 it('parallel evaluation creates one action',async()=>{
  const {runId}=await start();vi.setSystemTime(new Date('2026-03-10T13:00:00Z'));
  await Promise.all([evaluateSmartRun(db(),runId),evaluateSmartRun(db(),runId)]);
  expect((await fixture.pg.query('SELECT count(*)::int AS n FROM scheduled_actions')).rows[0]).toEqual({n:1});
 });
 it('discard decision when customer context changes during generation',async()=>{
  const {runId}=await start();vi.setSystemTime(new Date('2026-03-10T13:00:00Z'));
  fake.decision.mockImplementationOnce(async()=>{await patchControl(db(),conv,{state:'waiting_human'});return {action:'send',strategy:'CHECK_IN',message:'Texto antigo',confidence:0.9,waitHours:0};});
  expect(await evaluateSmartRun(db(),runId)).toBe('context_changed_during_generation');
  expect((await fixture.pg.query('SELECT count(*)::int AS n FROM scheduled_actions')).rows[0]).toEqual({n:0});
 });
 it('known reply allows return; new reply with same timestamp invalidates pending text',async()=>{
  const {runId}=await start();vi.setSystemTime(new Date('2026-03-10T13:00:00Z'));
  const message=crypto.randomUUID();await fixture.pg.query("INSERT INTO messages(id,user_id,conversation_id,direction,sent_at)VALUES($1,$2,$3,'inbound','2026-03-10T12:00:00Z')",[message,user,conv]);
  await evaluateSmartRun(db(),runId);const action=await actionFor(runId);
  expect((await smartPreSendCheck(db(),action as never)).allowed).toBe(true);
  await fixture.pg.query("INSERT INTO messages(user_id,conversation_id,direction,sent_at)VALUES($1,$2,'inbound','2026-03-10T12:00:00Z')",[user,conv]);
  expect((await smartPreSendCheck(db(),action as never)).allowed).toBe(false);
 });
 it('eight accepted logical contacts idempotently close only cycle and preserve manual task',async()=>{
  const {runId}=await start();let at=new Date('2026-03-10T13:00:00Z');
  for(let i=1;i<=8;i++){
   const aid=crypto.randomUUID(),mid=crypto.randomUUID();await fixture.pg.query("INSERT INTO scheduled_actions(id,user_id,conversation_id,flow_run_id,opportunity_id,logical_contact,status,send_state)VALUES($1,$2,$3,$4,$5,$6,'processing','started')",[aid,user,conv,runId,opp,i]);
   const action=(await fixture.pg.query('SELECT * FROM scheduled_actions WHERE id=$1',[aid])).rows[0];
   await recordPostQuoteAccepted(db(),action as never,mid,at);await recordPostQuoteAccepted(db(),action as never,mid,at);
   expect((await runFor(runId))['contacts_done']).toBe(i);
   at=nextSilenceContact({doneContacts:i,activatedAt:new Date('2026-03-09T12:00:00Z'),lastContactAt:at})?.at ?? at;
  }
  const run=await runFor(runId);expect(run['status']).toBe('completed');expect(run['next_evaluation_at']).toBeNull();
  expect((await fixture.pg.query('SELECT status,next_action_description FROM opportunities')).rows[0]).toEqual({status:'open',next_action_description:'Tarefa manual'});
 });
});

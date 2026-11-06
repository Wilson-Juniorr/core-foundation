import { describe, expect, it, vi } from 'vitest';
import { makeWindow, mergeWindows, isWithinWindow } from '../followup/time';
import { extractCommitments } from './rules';
import { approveSmartAction } from './approvals.server';
vi.mock('@/lib/audit/log.server', () => ({ writeAudit: vi.fn() }));
describe('Stage A safety regressions', () => {
 it('disjoint windows cannot allow sending', () => {
  const w=mergeWindows(makeWindow('08:00','09:00'),makeWindow('15:00','17:00'));
  expect(isWithinWindow(new Date('2026-11-09T18:00:00Z'),w,'America/Sao_Paulo')).toBe(false);
 });
 it('ordinary approval preserves a future appointment', async () => {
  let patch: Record<string,unknown>={};
  const chain: Record<string,unknown>={};
  for(const method of ['select','eq','in']) chain[method]=()=>chain;
  chain['maybeSingle']=async()=>({data:{id:'action',status:'needs_approval',content:'hello',scheduled_for:'2026-11-12T18:30:00Z'}});
  chain['update']=(p:Record<string,unknown>)=>{patch=p;return chain;};
  chain['then']=(resolve:(v:unknown)=>void)=>resolve({error:null});
  await approveSmartAction({from:()=>chain} as never,'user',{actionId:'action'});
  expect(patch['scheduled_for']).toBeUndefined();
 });
 it('recognizes accented tomorrow and exact minutes',()=>{
  const result=extractCommitments({text:'me chama amanhã às 15:30',direction:'inbound',now:new Date('2026-11-09T12:00:00Z')});
  expect(result[0]?.due_at).toBe('2026-11-10T18:30:00.000Z');
 });
 it('rejects impossible calendar dates instead of rolling months',()=>{
  expect(extractCommitments({text:'me chama dia 31/02/2027',direction:'inbound',now:new Date('2026-11-09T12:00:00Z')})).toEqual([]);
 });
});

<script lang="ts">
  import { onDestroy } from 'svelte';
import { calculateConstructionEstimate, validateConstructionEstimate, type ConstructionEstimateResult, type ParamFieldSchema, type ToolModule } from '@wyreup/core/execution';
  import UtilityForm from './UtilityForm.svelte';
  import { humanizeKey } from './jsonView';
  import type { SerializedTool } from './types';
  import { buildingInputSnapshot } from './buildingRowsState';
  export let tool:SerializedTool;
  export let injectedTool:ToolModule<Record<string,unknown>>|undefined=undefined;
  type Draft=Record<string,string>;
  const columns={materials:[['description','Description'],['quantity','Quantity'],['unit','Unit'],['unitPrice','Unit price']],labor:[['description','Description'],['hours','Hours'],['hourlyRate','Hourly rate']]} as const;
  const initial=(value:unknown)=>(value as Record<string,string|number>[]).map(row=>Object.fromEntries(Object.entries(row).map(([key,cell])=>[key,String(cell)])));
  let materialDrafts=initial(tool.defaults.materials),laborDrafts=initial(tool.defaults.labor);
  const omit=<T,>(value:Record<string,T>)=>Object.fromEntries(Object.entries(value).filter(([key])=>!['materials','labor','format'].includes(key)));
  const defaults=omit(tool.defaults),schema=omit(tool.paramSchema as Record<string,ParamFieldSchema>);
  let params={...defaults},scalarValid=false,validationError='',preview:ConstructionEstimateResult|null=null,snapshot:Record<string,unknown>|null=null;
  let running=false,error='',notice='',generation=0,controller:AbortController|null=null,url:string|null=null;
  let pages={materials:0,labor:0};
  $: previewRows=preview?{materials:preview.materials as Record<string,unknown>[],labor:preview.labor as Record<string,unknown>[]}:{materials:[],labor:[]};
  $: previewTotals=preview?Object.entries(preview.formattedTotals as Record<string,string>):[];
  const lineTotal=(value:unknown)=>{const minor=BigInt(value as number);return `${minor/100n}.${String(minor%100n).padStart(2,'0')}`;};
  function invalidate(){generation++;controller?.abort();controller=null;running=false;error='';notice='';if(url)URL.revokeObjectURL(url);url=null;}
  function parsed(drafts:Draft[],kind:'materials'|'labor'){
    return drafts.map((row,i)=>Object.fromEntries(columns[kind].map(([key])=>{
      const value=row[key];if(typeof value!=='string')throw new Error(`$.${kind}[${i}].${key}: Enter a value.`);
      if(key==='description'||key==='unit')return[key,value];
      if(!value.trim()||!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())||!Number.isFinite(Number(value)))throw new Error(`$.${kind}[${i}].${key}: Enter a finite number.`);
      return[key,Number(value)];
    })));
  }
  function review(){preview=null;snapshot=null;pages={materials:0,labor:0};validationError='';if(!scalarValid)return;try{const p=validateConstructionEstimate({...params,materials:parsed(materialDrafts,'materials'),labor:parsed(laborDrafts,'labor'),format:'json'});preview=calculateConstructionEstimate(p);snapshot=buildingInputSnapshot({...p});}catch(cause){validationError=cause instanceof Error?cause.message:'Check the estimate.';}}
  function scalarChanged(event:CustomEvent<{params:Record<string,unknown>;valid:boolean}>){if(params!==event.detail.params||!event.detail.valid)invalidate();params=event.detail.params;scalarValid=event.detail.valid;review();}
  function changed(kind:'materials'|'labor',index:number,key:string,event:Event){invalidate();const update=(rows:Draft[])=>rows.map((row,i)=>i===index?{...row,[key]:(event.currentTarget as HTMLInputElement).value}:row);if(kind==='materials')materialDrafts=update(materialDrafts);else laborDrafts=update(laborDrafts);review();}
  function add(kind:'materials'|'labor'){invalidate();if(kind==='materials')materialDrafts=[...materialDrafts,{description:'Material',quantity:'1',unit:'each',unitPrice:'0'}];else laborDrafts=[...laborDrafts,{description:'Labor',hours:'1',hourlyRate:'0'}];review();}
  function remove(kind:'materials'|'labor',index:number){invalidate();if(kind==='materials')materialDrafts=materialDrafts.filter((_,i)=>i!==index);else laborDrafts=laborDrafts.filter((_,i)=>i!==index);review();}
  async function download(format:'json'|'pdf'){if(!snapshot)return;invalidate();const own=generation,control=new AbortController();controller=control;running=true;const ownParams=buildingInputSnapshot({...snapshot,format});
    try{const module=injectedTool??(await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id);if(own!==generation)return;if(!module)throw new Error('Tool unavailable.');const result=await module.run([],ownParams,{signal:control.signal,executionId:crypto.randomUUID(),cache:new Map(),onProgress(){}});if(own!==generation)return;const blobs=Array.isArray(result)?result:[result],expected=format==='pdf'?'application/pdf':'application/json';if(blobs.length!==1||blobs[0]!.type!==expected)throw new Error('Unexpected estimate artifact.');url=URL.createObjectURL(blobs[0]!);const a=document.createElement('a');a.href=url;a.download=`construction-estimate.${format}`;a.click();notice=`Downloaded ${format.toUpperCase()} estimate.`;
    }catch(cause){if(own===generation)error=cause instanceof Error?cause.message:'Export failed.';}finally{if(own===generation){running=false;controller=null;}}
  }
  onDestroy(invalidate);
</script>
<div class="estimate">
  <UtilityForm {defaults} {params} paramSchema={schema} on:change={scalarChanged}/>
  <p>Currency provides context. Every currency uses explicit hundredths; this tool makes no exchange-rate or tax-rule inference. Rates may use up to six decimals. Rounded line totals add exactly in minor units.</p>
  {#each ['materials','labor'] as kind}
    <section><h3>{kind==='materials'?'Materials':'Labor'}</h3>
      {#each kind==='materials'?materialDrafts:laborDrafts as row,index}
        <fieldset><legend>{kind} {index+1}</legend><div class="columns">{#each columns[kind as 'materials'|'labor'] as [key,label]}<label>{label}<input type="text" inputmode={key==='description'||key==='unit'?undefined:'decimal'} aria-label={`${kind} ${label} ${index+1}`} value={row[key]} on:input={event=>changed(kind as 'materials'|'labor',index,key,event)}/></label>{/each}</div><button type="button" on:click={()=>remove(kind as 'materials'|'labor',index)}>Remove {kind} row {index+1}</button></fieldset>
      {/each}
      <button type="button" disabled={(kind==='materials'?materialDrafts:laborDrafts).length>=100} on:click={()=>add(kind as 'materials'|'labor')}>Add {kind} row</button>
    </section>
  {/each}
  {#if validationError}<p role="alert">{validationError}</p>{/if}
  {#if preview}
    <h3>Validated estimate preview</h3>
    <p>{preview.title} — {preview.currency}</p>
    <dl aria-label="Result summary">{#each previewTotals as [key,value]}<div><dt>{humanizeKey(key.replace(/Minor$/,''))}</dt><dd>{value}</dd></div>{/each}</dl>
    {#each ['materials','labor'] as section}
      {@const kind=section as 'materials'|'labor'}
      {@const label=kind==='materials'?'Materials':'Labor'}
      <h4>{label} line items</h4>
      <div class="table-scroll" role="region" aria-label={`${label} results`} tabindex="0"><table aria-label={`${label} table`}><thead><tr>{#each columns[kind] as [,name]}<th scope="col">{name}</th>{/each}<th scope="col">Line total ({preview.currency})</th></tr></thead><tbody>{#each previewRows[kind].slice(pages[kind]*25,(pages[kind]+1)*25) as row}<tr>{#each columns[kind] as [key]}<td>{String(row[key])}</td>{/each}<td>{lineTotal(row.lineMinor)}</td></tr>{/each}</tbody></table></div>
      <p>{previewRows[kind].length} line items. Page {pages[kind]+1} of {Math.max(1,Math.ceil(previewRows[kind].length/25))}.</p>
      <div class="actions"><button type="button" aria-label={`Previous ${label} page`} disabled={pages[kind]===0} on:click={()=>pages={...pages,[kind]:pages[kind]-1}}>Previous</button><button type="button" aria-label={`Next ${label} page`} disabled={(pages[kind]+1)*25>=previewRows[kind].length} on:click={()=>pages={...pages,[kind]:pages[kind]+1}}>Next</button></div>
    {/each}
    <details><summary>Full JSON preview</summary><pre>{JSON.stringify(preview,null,2)}</pre></details>
  {/if}
  <div class="actions"><button type="button" disabled={!snapshot||running} on:click={()=>download('json')}>Download JSON</button><button type="button" disabled={!snapshot||running} on:click={()=>download('pdf')}>Download PDF</button>{#if running}<button type="button" on:click={invalidate}>Cancel</button>{/if}</div>
  <p>PDF uses standard WinAnsi fonts and rejects unsupported glyphs; JSON preserves Unicode. Maximum100 material rows and100 labor rows,64 PDF pages and8MiB.</p>
  {#if running}<p role="status">Generating estimate…</p>{/if}{#if error}<p role="alert">{error}</p>{/if}{#if notice}<p role="status">{notice}</p>{/if}
</div>
<style>
  .table-scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:var(--space-2);border:1px solid var(--border);text-align:left}dl>div{display:flex;flex-wrap:wrap;gap:var(--space-2)}dt{font-weight:600}dd{margin:0}pre{overflow:auto;max-height:20rem}
  .estimate{display:grid;gap:var(--space-3)}.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:var(--space-2)}fieldset{min-width:0;border:1px solid var(--border);padding:var(--space-3);margin-bottom:var(--space-2)}label{display:grid;gap:var(--space-1)}input{box-sizing:border-box;width:100%;padding:var(--space-2);font:inherit;color:var(--text-primary);background:var(--bg-raised);border:1px solid var(--border)}button{padding:var(--space-2) var(--space-3);font:inherit;color:var(--text-primary);background:var(--bg-raised);border:1px solid var(--border);cursor:pointer}button:disabled{opacity:.6;cursor:default}.actions{display:flex;gap:var(--space-2);flex-wrap:wrap}button:focus-visible,input:focus-visible{outline:2px solid var(--accent-text);outline-offset:2px}
</style>

<script lang="ts">
  import { onDestroy } from 'svelte';
import { validateUtilityParams, type ParamFieldSchema, type ToolModule } from '@wyreup/core/execution';
  import UtilityForm from './UtilityForm.svelte';
  import { humanizeKey } from './jsonView';
  import type { SerializedTool } from './types';
  import { buildingDrafts, buildingInputSnapshot, buildingRowContract, buildingScalarProjection, parseBuildingPaste, validateBuildingDraft } from './buildingRowsState';
  export let tool:SerializedTool;
  export let injectedTool:ToolModule<Record<string,unknown>>|undefined=undefined;
  const contract=buildingRowContract(tool.id),schema=tool.paramSchema as Record<string,ParamFieldSchema>;
  const scalar=buildingScalarProjection(tool.id,tool.defaults,schema,tool.defaults);
  let scalarParams=scalar.params,scalarValid=Object.keys(scalar.defaults).length===0;
  let drafts=buildingDrafts(tool.id,tool.defaults[contract.key]),rows:unknown[]=[];
  let rowError='',paste='',pasteError='',pending:unknown[]|null=null;
  let error='',notice='',result='',blob:Blob|null=null,url:string|null=null,controller:AbortController|null=null,generation=0,running=false;
  let resultValue:Record<string,unknown>|null=null,resultPage=0;
  $: resultRows=(resultValue&&Array.isArray(resultValue[contract.key])?resultValue[contract.key]:blob?rows:[]) as Record<string,unknown>[];
  $: resultColumns=[...new Set(resultRows.flatMap(row=>Object.keys(row)))];
  $: resultSummary=resultValue?Object.entries(resultValue).filter(([,value])=>value===null||['number','string','boolean'].includes(typeof value)):[];
  $: resultUnits=resultValue&&resultValue.units&&typeof resultValue.units==='object'&&!Array.isArray(resultValue.units)?Object.entries(resultValue.units).filter(([,value])=>typeof value==='string'):[];
  $: resultAssumptions=resultValue&&Array.isArray(resultValue.assumptions)?resultValue.assumptions.filter((value):value is string=>typeof value==='string'):[];
  const display=(value:unknown)=>value===null?'Not available':typeof value==='object'?JSON.stringify(value):String(value);
  function invalidate(){generation++;controller?.abort();controller=null;running=false;result='';resultValue=null;resultPage=0;blob=null;notice='';error='';if(url)URL.revokeObjectURL(url);url=null;}
  function validateRows(){try{rows=validateBuildingDraft(tool.id,drafts);rowError='';}catch(cause){rows=[];rowError=cause instanceof Error?cause.message:'Check rows.';}}
  validateRows();
  function scalarChanged(event:CustomEvent<{params:Record<string,unknown>;valid:boolean}>){if(scalarParams!==event.detail.params||!event.detail.valid)invalidate();scalarParams=event.detail.params;scalarValid=event.detail.valid;}
  function cell(index:number,key:string,event:Event){invalidate();drafts=drafts.map((row,i)=>i===index?{...row,[key]:(event.currentTarget as HTMLInputElement).value}:row);validateRows();}
  function add(){invalidate();drafts=[...drafts,{...contract.emptyRow}];validateRows();}
  function remove(index:number){invalidate();drafts=drafts.filter((_,i)=>i!==index);validateRows();}
  function pasteChanged(event:Event){invalidate();paste=(event.currentTarget as HTMLTextAreaElement).value;pending=null;pasteError='';try{pending=parseBuildingPaste(tool.id,paste);}catch(cause){pasteError=cause instanceof Error?cause.message:'Check paste.';}}
  function apply(){if(!pending)return;invalidate();drafts=buildingDrafts(tool.id,pending);paste='';pending=null;pasteError='';validateRows();}
  function discard(){invalidate();paste='';pending=null;pasteError='';validateRows();}
  $: valid=scalarValid&&!rowError&&!paste&&!pending;
  async function calculate(){if(!valid)return;invalidate();const own=generation,control=new AbortController();controller=control;running=true;
    try{const snapshot=buildingInputSnapshot(validateUtilityParams(tool.defaults,schema,{...scalarParams,[contract.key]:rows}));
      const module=injectedTool??(await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id);if(own!==generation)return;if(!module)throw new Error('Tool unavailable.');
      const output=await module.run([],snapshot,{signal:control.signal,executionId:crypto.randomUUID(),cache:new Map(),onProgress(){}});if(own!==generation)return;const artifacts=Array.isArray(output)?output:[output];if(artifacts.length!==1||artifacts[0]!.type!=='application/json'||artifacts[0]!.size>1048576)throw new Error('Expected one bounded JSON artifact.');const text=await artifacts[0]!.text();if(own!==generation)return;const parsed=JSON.parse(text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Expected a JSON result record.');resultValue=parsed;result=text;blob=artifacts[0]!;
    }catch(cause){if(own===generation)error=cause instanceof Error?cause.message:'Calculation failed.';}finally{if(own===generation){running=false;controller=null;}}
  }
  function download(){if(!blob)return;url??=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`${tool.id}.json`;link.click();}
  async function copy(){const own=generation;try{await navigator.clipboard.writeText(result);if(own===generation)notice='Copied JSON.';}catch{if(own===generation)notice='Copy unavailable. Use Download JSON.';}}
  onDestroy(invalidate);
</script>
<div class="rows-runner">
  {#if Object.keys(scalar.defaults).length}<UtilityForm defaults={scalar.defaults} params={scalarParams} paramSchema={scalar.paramSchema} on:change={scalarChanged}/>{/if}
  <h3>Editable {contract.key}</h3>
  <p>Values stay local. Enter actual dimensions or ratings; named defaults are editable examples.</p>
  {#each drafts as row,index}
    <fieldset><legend>{contract.key} {index+1}</legend><div class="columns">{#each contract.columns as column}<label>{column.label}<input type="text" inputmode={column.kind==='number'?'decimal':undefined} aria-label={`${column.label} ${index+1}`} value={row[column.key]} on:input={(event)=>cell(index,column.key,event)}/></label>{/each}</div><button type="button" on:click={()=>remove(index)}>Remove row {index+1}</button></fieldset>
  {/each}
  <button type="button" disabled={drafts.length>=contract.maxRows} on:click={add}>Add row</button>
  {#if rowError}<p role="alert">{rowError}</p>{/if}
  <details><summary>Paste a JSON row array</summary><label>Paste {contract.key}<textarea aria-label={`Paste ${contract.key}`} value={paste} on:input={pasteChanged}/></label>{#if pasteError}<p role="alert">{pasteError}</p>{/if}{#if pending}<pre aria-label="Parsed row preview">{JSON.stringify(pending,null,2)}</pre><p>Preview is pending. Apply rows before calculating.</p><button type="button" on:click={apply}>Apply rows</button>{/if}<button type="button" on:click={discard}>Discard paste</button></details>
  {#if !rowError}<p role="status">{rows.length} validated rows.</p>{/if}
  <div class="actions"><button type="button" disabled={!valid||running} on:click={calculate}>{running?'Calculating…':'Calculate'}</button>{#if running}<button type="button" on:click={invalidate}>Cancel</button>{/if}</div>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if blob}
    <dl aria-label="Result summary">{#each resultSummary as [key,value]}<div><dt>{humanizeKey(key)}</dt><dd>{display(value)}</dd></div>{/each}</dl>
    <h3>Units</h3><dl aria-label="Result units">{#each resultUnits as [key,value]}<div><dt>{humanizeKey(key)}</dt><dd>{display(value)}</dd></div>{/each}</dl>
    <h3>Assumptions</h3><ul aria-label="Result assumptions">{#each resultAssumptions as assumption}<li>{assumption}</li>{/each}</ul>
    <h3>{resultValue&&Array.isArray(resultValue[contract.key])?'Calculated':'Validated input'} {contract.key}</h3>
    <div class="table-scroll" role="region" aria-label={`${contract.key} results`} tabindex="0"><table aria-label={`${contract.key} table`}><thead><tr>{#each resultColumns as key}<th scope="col">{humanizeKey(key)}</th>{/each}</tr></thead><tbody>{#each resultRows.slice(resultPage*25,(resultPage+1)*25) as row}<tr>{#each resultColumns as key}<td>{Object.hasOwn(row,key)?display(row[key]):'Not available'}</td>{/each}</tr>{/each}</tbody></table></div>
    <p>{resultRows.length} rows. Page {resultPage+1} of {Math.max(1,Math.ceil(resultRows.length/25))}.</p>
    <div class="actions"><button type="button" aria-label={`Previous ${contract.key} page`} disabled={resultPage===0} on:click={()=>resultPage--}>Previous</button><button type="button" aria-label={`Next ${contract.key} page`} disabled={(resultPage+1)*25>=resultRows.length} on:click={()=>resultPage++}>Next</button></div>
    <details><summary>Full JSON result</summary><pre>{result}</pre></details>
    <div class="actions"><button type="button" on:click={copy}>Copy JSON</button><button type="button" on:click={download}>Download JSON</button></div>
  {/if}
  {#if notice}<p role="status">{notice}</p>{/if}
</div>
<style>
  .table-scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:var(--space-2);border:1px solid var(--border);text-align:left}dl>div{display:flex;flex-wrap:wrap;gap:var(--space-2)}dt{font-weight:600}dd{margin:0;min-width:0}.rows-runner>dl,.rows-runner>ul{min-width:0;overflow-wrap:anywhere}
  .rows-runner{display:grid;gap:var(--space-3)}.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:var(--space-2)}fieldset{border:1px solid var(--border);min-width:0;padding:var(--space-3)}label{display:grid;gap:var(--space-1)}input,textarea{width:100%;box-sizing:border-box;padding:var(--space-2);font:inherit;color:var(--text-primary);background:var(--bg-raised);border:1px solid var(--border)}pre{overflow:auto;max-height:20rem}button{padding:var(--space-2) var(--space-3);font:inherit;color:var(--text-primary);background:var(--bg-raised);border:1px solid var(--border);cursor:pointer}button:disabled{opacity:.6;cursor:default}.actions{display:flex;gap:var(--space-2);flex-wrap:wrap}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent-text);outline-offset:2px}
</style>

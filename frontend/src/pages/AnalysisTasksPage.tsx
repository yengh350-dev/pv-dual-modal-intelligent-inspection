import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Download, Layers2, Plus, RefreshCw, ScanSearch, X } from 'lucide-react';
import { Button, Field, IconButton, Status } from '../components/ui';
import { getApiErrorMessage } from '../lib/api';
import { downloadJson } from '../lib/actions';
import { getLiveMissions, type LiveModality } from '../lib/liveInspection';
import { changeAnalysis, exportAnalysis, getAnalysis, listAnalysis, submitAnalysis, type TaskState } from '../lib/analysisTasks';
import './analysis-tasks.css';

const stateText:Record<TaskState,string> = {queued:'排队中',running:'检测中',cancel_requested:'取消待确认',cancelled:'已取消',succeeded:'检测完成',failed:'执行失败'};
const active = (state:TaskState) => ['queued','running','cancel_requested'].includes(state);
const tone = (state:TaskState) => state==='failed'?'danger':state==='succeeded'?'good':state==='running'?'info':'neutral';
const reasons:Record<string,string> = {
  CAPTURE_CLOCK_UNVERIFIED:'设备采集时钟未校验', CAPTURE_SKEW_EXCEEDED:'采集时间差超过 120 ms',
  REGISTRATION_UNVERIFIED:'缺少配准质量证明', REGISTRATION_ERROR_EXCEEDED:'配准误差超过 3 px',
  MAPPING_MISSING:'缺少 RGB → Thermal 坐标映射', MAPPING_DEGENERATE:'坐标映射退化', MAPPING_POLE:'坐标映射包含无效区域',
  PAIR_NOT_PROVIDED:'单通道检测', MODALITY_UNAVAILABLE:'一个通道未能执行，保留另一通道结果',
};
const dateText=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';

export default function AnalysisTasksPage() {
  const [params,setParams]=useSearchParams(), cache=useQueryClient();
  const missionFilter=params.get('mission')??'', selectedId=params.get('task');
  const missions=useQuery({queryKey:['live-missions'],queryFn:getLiveMissions});
  const tasks=useQuery({queryKey:['analysis-tasks',missionFilter],queryFn:()=>listAnalysis(missionFilter),
    refetchInterval:query=>query.state.data?.some(item=>active(item.state))?2000:false});
  const selected=useQuery({queryKey:['analysis-task',selectedId],queryFn:()=>getAnalysis(selectedId!),enabled:!!selectedId,
    refetchInterval:query=>query.state.data && active(query.state.data.state)?1500:false});
  const [createOpen,setCreateOpen]=useState(false), [busy,setBusy]=useState(false), [error,setError]=useState('');
  const [image,setImage]=useState<File|null>(null), [pair,setPair]=useState<File|null>(null);
  const [mission,setMission]=useState(''), [modality,setModality]=useState<LiveModality>('THERMAL');
  const [confidence,setConfidence]=useState(.4), [registration,setRegistration]=useState('');
  const [clock,setClock]=useState(''), [capture,setCapture]=useState(''), [pairCapture,setPairCapture]=useState('');
  const key=useRef(crypto.randomUUID());
  useEffect(()=>{key.current=crypto.randomUUID();},[image,pair,mission,modality,confidence,registration,clock,capture,pairCapture]);
  const select=(id:string|null)=>{const next=new URLSearchParams(params);if(id)next.set('task',id);else next.delete('task');setParams(next);};
  const submit=async(event:FormEvent)=>{
    event.preventDefault(); if(!image||busy)return;setBusy(true);setError('');
    try {
      let mapping:Record<string,unknown>={};
      if(registration.trim()) mapping=JSON.parse(registration);
      const hasClock=!!clock.trim()&&!!capture&&!!pairCapture;
      if (pair && (clock.trim()||capture||pairCapture) && !hasClock) throw new Error('请完整填写共同设备时钟及两张图的采集时间，或全部留空。');
      const task=await submitAnalysis({image,pairedImage:pair??undefined,missionId:mission||missions.data?.[0]?.id||'',modality,confidence,key:key.current,
        metadata:{source_kind:'upload',source_name:image.name.slice(0,120),timestamp_kind:hasClock?'device_capture':'unknown',...(hasClock?{clock_id:clock.trim(),captured_at:capture}:{})},
        pairedMetadata:pair?{source_kind:'upload',source_name:pair.name.slice(0,120),timestamp_kind:hasClock?'device_capture':'unknown',...(hasClock?{clock_id:clock.trim(),captured_at:pairCapture}:{})}:undefined,
        registration:mapping});
      select(task.id);setCreateOpen(false);key.current=crypto.randomUUID();
      await cache.invalidateQueries({queryKey:['analysis-tasks']});
    } catch(caught){setError(getApiErrorMessage(caught,caught instanceof Error?caught.message:'任务未提交，请重试。'));}
    finally{setBusy(false);}
  };
  const action=async(id:string,command:'cancel'|'retry')=>{
    if(busy)return;setBusy(true);setError('');
    try{await changeAnalysis(id,command);await cache.invalidateQueries({queryKey:['analysis-tasks']});await cache.invalidateQueries({queryKey:['analysis-task',id]});}
    catch(caught){setError(getApiErrorMessage(caught));}finally{setBusy(false);}
  };
  const exportResult=async()=>{
    if(!selectedId||busy)return;setBusy(true);setError('');
    try{downloadJson('analysis-'+selectedId+'.json',await exportAnalysis(selectedId));}
    catch(caught){setError(getApiErrorMessage(caught));}finally{setBusy(false);}
  };
  const result=selected.data?.result, observation=selected.data?.observation;
  const startWaitMs=result?.timing.submissionToAttemptStartMs??result?.timing.queueWaitMs;
  return <div className="page analysis-tasks">
    <header className="analysis-heading"><div><h1>证据分析队列</h1><p>原图检测、双通道关联与复核留档</p></div><div><Link to="/command-center"><ArrowRight />视频巡检</Link><Button onClick={()=>void tasks.refetch()} disabled={tasks.isFetching}><RefreshCw />刷新</Button><Button variant="primary" onClick={()=>setCreateOpen(value=>!value)} disabled={busy}><Plus />提交原图</Button></div></header>
    {error?<div className="analysis-alert" role="alert">{error}</div>:null}
    {missions.isError?<div className="analysis-alert" role="alert">任务库暂不可达，不能提交新分析。<Button onClick={()=>void missions.refetch()}><RefreshCw />重读任务库</Button></div>:null}
    {createOpen?<form className="analysis-submit" onSubmit={submit}>
      <div className="analysis-form-grid"><Field label="巡检任务"><select required value={mission||missions.data?.[0]?.id||''} disabled={busy} onChange={event=>setMission(event.target.value)}>{missions.data?.map(item=><option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select></Field><Field label="原图通道"><select value={modality} disabled={busy} onChange={event=>setModality(event.target.value as LiveModality)}><option value="THERMAL">热红外</option><option value="RGB">可见光 RGB</option></select></Field><Field label="原始图像 · 不超过 8 MB"><input type="file" required accept="image/jpeg,image/png" disabled={busy} onChange={event=>{setImage(event.target.files?.[0]??null);setError('');}} /></Field><Field label={'同场景配对图 · '+(modality==='THERMAL'?'RGB':'热红外')+'（可选）'}><input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={event=>{setPair(event.target.files?.[0]??null);setError('');}} /></Field><Field label="候选置信度阈值"><input type="number" min=".05" max=".95" step=".05" value={confidence} disabled={busy} onChange={event=>setConfidence(Number(event.target.value))} /></Field></div>
      {pair?<details className="analysis-calibration"><summary><Layers2 />设备时间与配准记录</summary><div className="analysis-form-grid"><Field label="共同设备时钟 ID"><input value={clock} disabled={busy} maxLength={80} onChange={event=>setClock(event.target.value)} /></Field><Field label="原图采集时间（含时区）"><input value={capture} disabled={busy} placeholder="2026-10-05T08:00:00+08:00" onChange={event=>setCapture(event.target.value)} /></Field><Field label="配对图采集时间（含时区）"><input value={pairCapture} disabled={busy} placeholder="2026-10-05T08:00:00+08:00" onChange={event=>setPairCapture(event.target.value)} /></Field></div><Field label="配准 JSON · RGB 归一化坐标 → Thermal 归一化坐标"><textarea value={registration} disabled={busy} onChange={event=>setRegistration(event.target.value)} placeholder={'{"homography":[...9个数],"reference":"标定记录ID","rmse_px":1.5}'} /></Field></details>:null}
      <div className="analysis-submit-footer"><span>模型原生检测配置 · 结果须人工复核{pair?' · 缺少同步或配准记录时暂停融合':''}</span><Button onClick={()=>setCreateOpen(false)} disabled={busy}>收起</Button><Button type="submit" variant="primary" disabled={!image||!missions.data?.length} loading={busy}><ScanSearch />进入分析队列</Button></div>
    </form>:null}
    <div className="analysis-scope"><label>任务范围<select aria-label="分析任务范围" value={missionFilter} onChange={event=>{const next=new URLSearchParams();if(event.target.value)next.set('mission',event.target.value);setParams(next);}}><option value="">全部任务</option>{missions.data?.map(item=><option key={item.id} value={item.id}>{item.id}</option>)}</select></label><span role="status">{tasks.isPending?'正在读取队列':tasks.isError?'服务不可达':`最近 ${tasks.data?.length??0} 条 · ${tasks.data?.filter(item=>active(item.state)).length??0} 条处理中`}</span></div>
    {tasks.isError?<div className="analysis-empty" role="alert"><p>{getApiErrorMessage(tasks.error)}</p><Button onClick={()=>void tasks.refetch()}><RefreshCw />重新读取</Button></div>:tasks.data?.length?<div className="analysis-table-scroll"><table><thead><tr><th>证据任务</th><th>通道</th><th>提交时间</th><th>状态</th><th>执行次数</th><th>操作</th></tr></thead><tbody>{tasks.data.map(item=><tr key={item.id} className={item.id===selectedId?'selected':''}><td><button className="analysis-row-title" onClick={()=>select(item.id)}><strong>{item.missionId}</strong><small>{item.id.slice(0,8)}</small></button></td><td>{item.paired?'RGB + Thermal':'单通道'}</td><td><time>{dateText(item.createdAt)}</time></td><td><Status tone={tone(item.state)}>{stateText[item.state]}</Status></td><td>{item.attempts} / 3</td><td><Button variant="ghost" onClick={()=>select(item.id)}>详情<ArrowRight /></Button>{active(item.state)&&item.state!=='cancel_requested'?<IconButton label="取消分析任务" disabled={busy} onClick={()=>void action(item.id,'cancel')}><X /></IconButton>:item.state==='failed'&&item.attempts<3?<IconButton label="重试失败任务" disabled={busy} onClick={()=>void action(item.id,'retry')}><RefreshCw /></IconButton>:null}</td></tr>)}</tbody></table></div>:<div className="analysis-empty"><ScanSearch /><h2>{tasks.isPending?'正在读取…':'暂无分析任务'}</h2><p>原图检测记录和视频留档任务会显示在这里。</p></div>}
    {selectedId?<section className="analysis-detail" aria-label="分析任务详情"><header><h2>分析详情</h2><IconButton label="收起分析详情" onClick={()=>select(null)}><X /></IconButton></header>
      {selected.isError?<p role="alert">{getApiErrorMessage(selected.error)}</p>:!selected.data?<p role="status">正在读取…</p>:<>
        <div className="analysis-detail-status"><Status tone={tone(selected.data.state)}>{stateText[selected.data.state]}</Status><span>{selected.data.id}</span>{selected.data.state==='cancel_requested'?<p>当前推理结束后确认取消，不会发布此次结果。</p>:null}</div>
        {selected.data.error?<p className="analysis-alert" role="alert">{selected.data.error==='WORKER_RESTART_LIMIT'?'任务恢复次数达到上限，请检查服务日志。':'模型或输入暂不可用，请检查权重与原图后重试。'}</p>:null}
        {result?<><dl className="analysis-facts"><div><dt>{selected.data.attempts>1?'提交至本次启动':'排队耗时'}</dt><dd>{startWaitMs==null?'未记录':startWaitMs.toFixed(0)+' ms'}</dd></div><div><dt>处理耗时</dt><dd>{result.timing.processingMs.toFixed(0)} ms</dd></div><div><dt>关联状态</dt><dd>{result.fusion.state==='associated'?'空间证据已关联':result.fusion.state==='held'?'质量门控暂停融合':result.fusion.state==='degraded'?'单通道降级':'单通道检测'}</dd></div><div><dt>空间匹配</dt><dd>{result.fusion.matches.length} 对</dd></div><div><dt>设备采集时间差</dt><dd>{result.fusion.captureSkewMs==null?'未校验':result.fusion.captureSkewMs.toFixed(1)+' ms'}</dd></div><div><dt>声明的配准误差</dt><dd>{result.fusion.registrationRmsePx==null?'未校验':result.fusion.registrationRmsePx+' px'}</dd></div></dl>
          {result.fusion.reasons.length?<ul className="analysis-reasons">{result.fusion.reasons.map(reason=><li key={reason}>{reasons[reason]??reason}</li>)}</ul>:null}
          <div className="analysis-output-grid">{observation?.imageData&&observation.prediction?<div className="analysis-result-image" style={{aspectRatio:observation.prediction.image.width/observation.prediction.image.height}}><img src={observation.imageData} alt="正式检测原始帧" /><svg viewBox={`0 0 ${observation.prediction.image.width} ${observation.prediction.image.height}`} aria-label="正式检测候选框">{observation.prediction.detections.map((item,index)=><rect key={index} x={item.box.x1} y={item.box.y1} width={item.box.x2-item.box.x1} height={item.box.y2-item.box.y1} />)}</svg></div>:null}<div>{Object.entries(result.predictions).map(([channel,prediction])=><section className="analysis-prediction" key={channel}><h3>{channel==='RGB'?'可见光':'热红外'} · {prediction.count} 个候选</h3><p>{prediction.modelId}</p>{prediction.detections.length?<ol>{prediction.detections.map((item,index)=><li key={index}><span>{index+1} · {item.className}</span><strong>{item.confidence.toFixed(3)}</strong></li>)}</ol>:<p>未检出超过阈值的候选，不代表无故障。</p>}</section>)}</div></div>
          <details className="analysis-lineage"><summary>原图哈希与来源追溯</summary>{result.lineage.map(frame=><dl key={frame.frameId}><dt>{frame.modality} · {frame.width} × {frame.height}</dt><dd>{frame.sha256}</dd><dt>来源</dt><dd>{String(frame.metadata.source_name)}</dd><dt>时间来源</dt><dd>{frame.metadata.timestamp_kind==='device_capture'?'声明的设备采集时间':frame.metadata.timestamp_kind==='browser_sample'?'浏览器取帧时间':'采集时间未知'}</dd></dl>)}</details><p className="analysis-boundary">{result.boundary}</p>
        </>:null}
        <footer className="analysis-detail-actions">{selected.data.state==='succeeded'?<Button onClick={()=>void exportResult()} disabled={busy}><Download />导出可追溯结果</Button>:null}{observation?.workOrderId?<Link to={'/work-orders?order='+observation.workOrderId}>查看已派工单<ArrowRight /></Link>:selected.data.observationId?<Link to={'/command-center?mission='+selected.data.missionId+'&observation='+selected.data.observationId}>人工复核与工单<ArrowRight /></Link>:null}</footer>
      </>}
    </section>:null}
  </div>;
}

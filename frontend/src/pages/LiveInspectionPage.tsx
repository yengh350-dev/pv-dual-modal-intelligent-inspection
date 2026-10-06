import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type Hls from 'hls.js';
import { isAxiosError } from 'axios';
import { submitAnalysis } from '../lib/analysisTasks';
import { ArrowRight, Camera, CheckCircle2, FileVideo, MapPinned, Maximize2, Pause, Play, Radio, Save, ScanLine, Unplug, Upload, Video } from 'lucide-react';
import { Button, Drawer, Field, IconButton, Status } from '../components/ui';
import { getApiErrorMessage } from '../lib/api';
import { analyzeFrame, dispatchObservation, getLiveMissions, getObservation, getObservations,
  type LiveModality, type LivePrediction, type Observation, type SourceKind } from '../lib/liveInspection';
import './live-inspection.css';

interface FrozenFrame {
  blob: Blob; image: string; prediction: LivePrediction; capturedAt: string; mediaTime: number;
  missionId: string; modality: LiveModality; sourceName: string; kind: SourceKind; confidence: number; roundTripMs: number;
}
const timeText = (seconds: number) => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60].map(value => String(value).padStart(2,'0')).join(':');
const newReview = () => {
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const localDate = new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60_000);
  return { detection_index:0, location:'', review_note:'', owner:'', reviewer:'', priority:'中', due_at:localDate.toISOString().slice(0,16) };
};

function FrameView({ image, prediction }: { image: string; prediction: LivePrediction }) {
  return <div className="live-frozen-image" style={{ aspectRatio: prediction.image.width / prediction.image.height }}>
    <img src={image} alt="模型分析所对应的冻结帧" />
    <svg viewBox={`0 0 ${prediction.image.width} ${prediction.image.height}`} aria-label="冻结帧检测框" style={{fontSize:Math.max(18,prediction.image.width/28)}}>
      {prediction.detections.map((item, index) => <g key={index}><rect x={item.box.x1} y={item.box.y1} width={item.box.x2-item.box.x1} height={item.box.y2-item.box.y1} /><text textAnchor={item.box.x1>prediction.image.width/2?'end':'start'} x={item.box.x1>prediction.image.width/2?Math.min(prediction.image.width-8,item.box.x2):Math.max(8,item.box.x1)} y={Math.max(prediction.image.width/28+4,item.box.y1-6)}>{index + 1} · {item.confidence.toFixed(2)}</text></g>)}
    </svg>
  </div>;
}

export default function LiveInspectionPage({ activeSite }: { activeSite: string }) {
  const navigate = useNavigate();
  const [params,setParams] = useSearchParams();
  const cache = useQueryClient();
  const missions = useQuery({ queryKey: ['live-missions'], queryFn: getLiveMissions });
  const missionId = params.get('mission') || missions.data?.find(item => item.site === activeSite)?.id || missions.data?.[0]?.id || '';
  const mission = missions.data?.find(item => item.id === missionId);
  const observations = useQuery({ queryKey: ['live-observations',missionId], queryFn: () => getObservations(missionId), enabled: !!missionId });
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const epoch = useRef(0);
  const request = useRef<AbortController | null>(null);
  const analyzing = useRef(false);
  const nextSampleAt = useRef(0);
  const submissionKey = useRef(crypto.randomUUID());
  const [skipped,setSkipped] = useState(0);
  const [source, setSource] = useState<{ url: string; name: string; kind: SourceKind } | null>(null);
  const [sourceOpen,setSourceOpen] = useState(false);
  const [url,setUrl] = useState('');
  const [modality,setModality] = useState<LiveModality>('THERMAL');
  const [intervalSeconds,setIntervalSeconds] = useState(10);
  const [confidence,setConfidence] = useState(.4);
  const [mediaState,setMediaState] = useState<'disconnected'|'loading'|'playing'|'paused'|'buffering'|'error'>('disconnected');
  const [running,setRunning] = useState(false);
  const [busy,setBusy] = useState(false);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const [frame,setFrame] = useState<FrozenFrame | null>(null);
  const [selected,setSelected] = useState<Observation | null>(null);
  const [reviewOpen,setReviewOpen] = useState(false);
  const [reviewError,setReviewError] = useState('');
  const [draft,setDraft] = useState(newReview);
  const [now,setNow] = useState(Date.now());
  const stateLabels = { disconnected:'未接入视频', loading:'连接中', playing:'视频播放中', paused:'画面已暂停', buffering:'视频缓冲中', error:'视频不可用' };

  useEffect(() => { const timer=window.setInterval(()=>setNow(Date.now()),1000); return ()=>window.clearInterval(timer); },[]);
  useEffect(() => {
    epoch.current += 1; request.current?.abort(); setRunning(false); setFrame(null); setError(''); setSkipped(0); nextSampleAt.current=0;
  },[missionId,modality,source]);
  useEffect(() => {
    const video = videoRef.current;
    if (!source || !video) { setMediaState('disconnected'); return; }
    let hls: Hls | undefined;
    let disposed = false;
    setMediaState('loading');
    video.crossOrigin = 'anonymous';
    if (source.kind === 'hls' && !video.canPlayType('application/vnd.apple.mpegurl')) {
      void import('hls.js').then(({default:Player}) => {
        if (disposed) return;
        if (!Player.isSupported()) { setMediaState('error'); setError('当前浏览器不支持 HLS，请更换浏览器或上传录像。'); return; }
        hls = new Player({ lowLatencyMode:true, maxBufferLength:10 });
        hls.on(Player.Events.ERROR, (_,data) => { if (data.fatal) { setMediaState('error'); setRunning(false); setError('视频连接失败，请检查推流状态、跨域设置和地址后重新连接。'); hls?.destroy(); } });
        hls.loadSource(source.url); hls.attachMedia(video);
      }).catch(()=>{if(!disposed){setMediaState('error');setError('HLS 播放模块加载失败，请刷新后重试。');}});
    } else video.src = source.url;
    return () => { disposed = true; hls?.destroy(); video.pause(); video.removeAttribute('src'); video.load(); if (source.kind==='recording') URL.revokeObjectURL(source.url); };
  },[source]);
  useEffect(() => () => { epoch.current += 1; request.current?.abort(); },[]);
  useEffect(() => {
    const suspend = () => { if (document.hidden) setRunning(false); };
    document.addEventListener('visibilitychange',suspend);
    return ()=>document.removeEventListener('visibilitychange',suspend);
  },[]);

  const sample = async () => {
    const video=videoRef.current;
    if (!video || !source || !mission || video.readyState<2) return;
    if (analyzing.current || Date.now()<nextSampleAt.current) { setSkipped(value=>value+1); return; }
    const currentEpoch=epoch.current;
    const currentSource=source;
    analyzing.current=true; setBusy(true); setError('');
    const controller=new AbortController(); request.current=controller;
    try {
      const canvas=document.createElement('canvas');
      if (video.videoWidth*video.videoHeight>16_000_000) throw new Error('视频帧超过 1600 万像素，请更换较低分辨率的视频源。');
      canvas.width=video.videoWidth; canvas.height=video.videoHeight;
      const context=canvas.getContext('2d'); if (!context) throw new Error('无法采样');
      context.drawImage(video,0,0,canvas.width,canvas.height);
      const capturedAt=new Date().toISOString(), mediaTime=video.currentTime;
      const blob=await new Promise<Blob>((resolve,reject)=>{try {canvas.toBlob(value=>value?resolve(value):reject(new Error('无法读取视频帧')), 'image/jpeg',.9);} catch(caught){reject(caught);}});
      const preview=document.createElement('canvas'), scale=Math.min(1,1280/canvas.width);
      preview.width=Math.round(canvas.width*scale); preview.height=Math.round(canvas.height*scale);
      preview.getContext('2d')?.drawImage(canvas,0,0,preview.width,preview.height);
      const image=preview.toDataURL('image/jpeg',.9);
      const previewBlob=await new Promise<Blob>((resolve,reject)=>preview.toBlob(value=>value?resolve(value):reject(new Error('无法读取预览帧')),'image/jpeg',.9));
      const requestStart=performance.now();
      const prediction=await analyzeFrame(previewBlob,modality,confidence,controller.signal);
      if (currentEpoch===epoch.current) {
        submissionKey.current=crypto.randomUUID();
        setFrame({blob,image,prediction,capturedAt,mediaTime,missionId,modality,sourceName:currentSource.name,kind:currentSource.kind,confidence,roundTripMs:performance.now()-requestStart});
      }
    } catch(caught) {
      if (!controller.signal.aborted && currentEpoch===epoch.current) {
        if (isAxiosError(caught) && caught.response?.status===429) {
          nextSampleAt.current=Date.now()+5000; setSkipped(value=>value+1); return;
        }
        setRunning(false);
        setError(caught instanceof DOMException && caught.name==='SecurityError' ? '视频服务器未允许跨域采样。可播放不代表可分析，请配置 CORS 或先上传录像。' : getApiErrorMessage(caught,'分析失败，请检查视频帧与模型服务后重试。'));
      }
    } finally { analyzing.current=false; setBusy(false); }
  };
  useEffect(() => {
    if (!running) return;
    const timer=window.setInterval(()=>{const video=videoRef.current; if (video && !video.paused && !video.ended && video.readyState>=2) void sample();},intervalSeconds*1000);
    return ()=>window.clearInterval(timer);
  },[running,intervalSeconds,missionId,source,modality,confidence]);

  const connect = (event: FormEvent) => {
    event.preventDefault();
    try {
      const parsed=new URL(url);
      if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.pathname.endsWith('.m3u8')) throw new Error();
      if (window.location.protocol==='https:' && parsed.protocol!=='https:') throw new Error();
      setSource({url:parsed.toString(),name:'HLS 视频源',kind:'hls'}); setSourceOpen(false);
    } catch {setError('请输入无内嵌账号密码的 HLS .m3u8 地址。HTTPS 页面须使用 HTTPS 视频源。RTMP/RTSP 请先由媒体服务转换。');}
  };
  const keepFrame = async () => {
    if (!frame || saving || busy) return;
    setRunning(false); videoRef.current?.pause(); setSaving(true); setError('');
    try {
      const task=await submitAnalysis({image:frame.blob,missionId:frame.missionId,modality:frame.modality,confidence:frame.confidence,key:submissionKey.current,
        metadata:{source_kind:frame.kind,source_name:frame.sourceName,timestamp_kind:'browser_sample',captured_at:frame.capturedAt,media_time:frame.mediaTime}});
      navigate('/analysis?task='+task.id);
    } catch(caught){setError(getApiErrorMessage(caught,'检测任务未提交，请重试。'));}
    finally{setSaving(false);}
  };
  const openObservation = async (id:string) => {
    setRunning(false); setSaving(true); setError('');
    try { setSelected(await getObservation(id)); setDraft(newReview()); setReviewError(''); setReviewOpen(true); }
    catch(caught){setError(getApiErrorMessage(caught));} finally{setSaving(false);}
  };
  useEffect(() => {
    const observationId = params.get('observation');
    if (observationId) void openObservation(observationId);
  },[params.get('observation')]);
  const dispatch = async (event:FormEvent) => {
    event.preventDefault(); if (!selected || saving) return;
    setSaving(true); setReviewError('');
    try {
      const result=await dispatchObservation(selected.id,{...draft,due_at:new Date(draft.due_at).toISOString()});
      await cache.invalidateQueries({queryKey:['workflow-orders']});
      await cache.invalidateQueries({predicate:query=>String(query.queryKey[0]).startsWith('workspace')});
      await cache.invalidateQueries({queryKey:['live-observations',missionId]});
      navigate('/work-orders?order='+result.id);
    } catch(caught){setReviewError(getApiErrorMessage(caught,'工单未创建，复核内容仍然保留。'));} finally{setSaving(false);}
  };
  const disconnect = () => {setRunning(false); request.current?.abort(); setSource(null);};
  const loadTestClip = () => setSource({ url:'/media/dataset-still-test.mp4', name:'数据集静帧循环测试 · 非飞行录像', kind:'recording' });
  const freshSeconds=frame?Math.max(0,Math.floor((now-new Date(frame.capturedAt).getTime())/1000)):null;
  const buffered=videoRef.current?.buffered;
  const bufferLag=source?.kind==='hls' && buffered?.length ? Math.max(0,buffered.end(buffered.length-1)-(videoRef.current?.currentTime??0)) : null;

  return <div className="page live-inspection">
    <header className="live-heading"><div><h1>视频巡检指挥台</h1><p>{mission?mission.site+' · 任务登记设备：'+mission.aircraft:'等待选择任务'}</p></div><div><Button onClick={()=>navigate('/command-center?mode=map')}><MapPinned />演示态势图</Button><Button onClick={()=>setSourceOpen(true)} disabled={saving}><Radio />接入视频</Button><IconButton label="全屏视频巡检" onClick={()=>{void document.querySelector('.live-inspection')?.requestFullscreen().catch(()=>setError('全屏未打开，请检查浏览器权限。'));}}><Maximize2 /></IconButton></div></header>
    <div className="live-context"><label>巡检任务<select aria-label="巡检任务" disabled={busy||saving} value={missionId} onChange={event=>{const next=new URLSearchParams(params);next.set('mission',event.target.value);setParams(next);}}>{missions.data?.map(item=><option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select></label><label>视频通道<select aria-label="视频通道" disabled={busy||saving} value={modality} onChange={event=>setModality(event.target.value as LiveModality)}><option value="THERMAL">热红外</option><option value="RGB">可见光 RGB</option></select></label><Status tone={mediaState==='playing'?'good':mediaState==='error'?'danger':'neutral'}>{stateLabels[mediaState]}</Status><span>{source?.kind==='recording'?'本地录像回放，不是无人机直播':source?'HLS 接入，设备身份尚未校验':'无人机尚未连接'}</span></div>
    {error || missions.isError ? <div className="live-error" role="alert">{error || getApiErrorMessage(missions.error,'任务服务不可达，请刷新。')}</div>:null}
    <div className="live-workspace">
      <section className="live-monitor"><div className="live-player">
        <video ref={videoRef} controls onLoadedData={() => setMediaState(videoRef.current?.paused ? "paused" : "playing")} playsInline muted crossOrigin="anonymous" onPlaying={()=>setMediaState('playing')} onPause={()=>setMediaState('paused')} onWaiting={()=>setMediaState('buffering')} onEnded={()=>{setRunning(false);setMediaState('paused');}} onError={()=>{if(source){setMediaState('error');setRunning(false);setError('视频无法播放，请检查格式、跨域设置或更换录像。');}}} />
        {!source?<div className="live-no-source"><Video /><h2>等待视频接入</h2><p>大疆推流接入后显示现场画面。当前未连接设备。</p><div><Button variant="primary" onClick={()=>setSourceOpen(true)}><Radio />接入 HLS</Button><Button onClick={()=>uploadRef.current?.click()}><Upload />打开巡检录像</Button><Button onClick={loadTestClip}><FileVideo />数据集测试片段</Button></div></div>:<div className="live-source-label"><span>{modality==='THERMAL'?'THERMAL':'RGB'}</span><span>{source.name}</span></div>}
      </div><input ref={uploadRef} className="sr-only" type="file" accept="video/mp4,video/webm,video/quicktime" aria-label="选择巡检录像" onChange={event=>{const file=event.target.files?.[0]; if(file){if(file.size>500*1024*1024){setError('录像不能超过 500 MB，请先截取巡检片段。');}else setSource({url:URL.createObjectURL(file),name:file.name.slice(0,120),kind:'recording'});}event.target.value='';}} />
      <div className="live-monitor-toolbar"><IconButton label={mediaState === "playing" ? "暂停视频" : "播放视频"} disabled={!source || saving || mediaState === "error" || mediaState === "loading"} onClick={() => { const video = videoRef.current; if (video?.paused) void video.play().catch(() => setError("视频未能播放，请点击播放器重试。")); else video?.pause(); }}>{mediaState === "playing" ? <Pause /> : <Play />}</IconButton><Button disabled={!source||busy||saving||!mission||!['playing','paused'].includes(mediaState)} onClick={()=>{setRunning(false);videoRef.current?.pause();void sample();}} loading={busy}><Camera />分析当前帧</Button><Button disabled={!source||saving||mediaState!=='playing'} variant={running?'secondary':'primary'} onClick={()=>setRunning(value=>!value)}>{running?<Pause />:<Play />}{running?'停止连续分析':'连续分析'}</Button><IconButton label="断开视频" disabled={!source||saving} onClick={disconnect}><Unplug /></IconButton><span role="status">{busy?'模型分析中':running?'连续采样中':'按需采样'}</span></div>
      <div className="live-analysis-settings"><label>采样间隔<select aria-label="采样间隔" value={intervalSeconds} onChange={event=>setIntervalSeconds(Number(event.target.value))}><option value="5">5 秒</option><option value="10">10 秒</option><option value="30">30 秒</option></select></label><label>候选阈值<input aria-label="候选阈值" type="range" min=".1" max=".9" step=".05" value={confidence} onChange={event=>setConfidence(Number(event.target.value))} /><output>{confidence.toFixed(2)}</output></label></div>
      <p className="live-boundary">预览采样 320 px · 已跳过 {skipped} 次忙碌采样。{bufferLag!==null?'播放距缓存末端 '+bufferLag.toFixed(1)+' 秒 · ':''}设备采集时间与单程传输延迟未校验；普通视频不提供辐射测温或地理定位。</p>
      </section>
      <aside className="live-analysis"><header><h2>当前帧分析</h2><Status tone={frame?.prediction.count?'warn':'neutral'}>{frame?frame.prediction.count+' 个候选':'尚未分析'}</Status></header>
        {frame?<><FrameView image={frame.image} prediction={frame.prediction}/><dl><div><dt>视频时刻</dt><dd>{timeText(frame.mediaTime)}</dd></div><div><dt>浏览器采样时间</dt><dd>{new Date(frame.capturedAt).toLocaleTimeString('zh-CN')}</dd></div><div><dt>服务推理耗时</dt><dd>{frame.prediction.elapsedMs.toFixed(0)} ms</dd></div><div><dt>请求往返耗时</dt><dd>{frame.roundTripMs.toFixed(0)} ms</dd></div><div><dt>采样距今</dt><dd>{freshSeconds} 秒</dd></div><div><dt>检测配置</dt><dd>快速预览 · 320 px</dd></div></dl><p className="live-model">{frame.prediction.modelId}</p>{frame.prediction.count?<ol className="live-detections">{frame.prediction.detections.map((item,index)=><li key={index}><span>{index+1} · {item.className}</span><strong>{item.confidence.toFixed(2)}</strong></li>)}</ol>:<p>该帧未检出超过阈值的候选，不代表设备无故障。</p>}<Button variant="primary" onClick={()=>void keepFrame()} disabled={busy||saving} loading={saving}><Save />原始帧送高精度检测</Button></>:<div className="live-analysis-empty"><ScanLine /><p>等待视频帧分析</p><span>只在对应冻结帧上显示检测框。</span></div>}
      </aside>
    </div>
    <section className="live-records"><header><h2>任务冻结帧</h2><span>{observations.data?.length??0} 条最近记录</span></header>{observations.isError?<p role="alert">冻结帧列表不可达，请刷新后重试。</p>:observations.data?.length?<div className="live-record-list">{observations.data.map(item=><button key={item.id} disabled={saving} onClick={()=>void openObservation(item.id)}><FileVideo /><div><strong>{item.sourceName}</strong><span>{timeText(item.mediaTime)} · {item.modality} · {item.count} 个候选</span></div><Status tone={item.workOrderId?'info':'neutral'}>{item.workOrderId?'已派单':'待复核'}</Status><ArrowRight /></button>)}</div>:<p>{observations.isPending?'正在读取…':'暂无留档帧。'}</p>}</section>
    <Drawer open={sourceOpen} title="视频接入" onClose={()=>setSourceOpen(false)}><form className="form-stack workflow-create" onSubmit={connect}><Field label="HLS 播放地址"><input aria-label="HLS 播放地址" required type="url" value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://media.example.com/inspection/index.m3u8" /></Field><p>大疆 RTMP/RTSP 推流须经媒体网关转换为 HLS，并允许浏览器跨域取帧。请勿填写推流密钥或内嵌账号密码。</p>{error?<p role="alert" className="live-error">{error}</p>:null}<Button variant="primary" type="submit"><Radio />连接视频源</Button><Button type="button" onClick={()=>{setSourceOpen(false);uploadRef.current?.click();}}><Upload />打开本地录像</Button></form></Drawer>
    <Drawer open={reviewOpen} title="冻结帧复核与派单" width="wide" onClose={()=>{if(!saving&&(!draft.review_note&&!draft.location&&!draft.owner&&!draft.reviewer||window.confirm('关闭复核会放弃未提交的填写内容，冻结帧仍会保留，是否继续？')))setReviewOpen(false);}}>
      {selected ? <p className="live-model">所属任务：{selected.missionId}</p> : null}
      {selected?.prediction&&selected.imageData?<div className="live-review"><FrameView image={selected.imageData} prediction={selected.prediction}/><p>{selected.id} · {selected.sourceName} · {timeText(selected.mediaTime)}</p><p className="live-boundary">人工核实组件位置及异常有效性后，再创建现场复核工单。</p>{selected.workOrderId?<Button variant="primary" onClick={()=>navigate('/work-orders?order='+selected.workOrderId)}><CheckCircle2 />查看已派工单</Button>:selected.count?<form className="form-stack workflow-create" onSubmit={dispatch}><Field label="候选框"><select aria-label="候选框" value={draft.detection_index} onChange={event=>setDraft({...draft,detection_index:Number(event.target.value)})}>{selected.prediction.detections.map((item,index)=><option key={index} value={index}>{index+1} · {item.className} · {item.confidence.toFixed(2)}</option>)}</select></Field><Field label="人工核实的现场位置"><input aria-label="人工核实的现场位置" required minLength={3} maxLength={120} value={draft.location} onChange={event=>setDraft({...draft,location:event.target.value})} placeholder="场站 / 方阵 / 组件编号" /></Field><Field label="人工复核说明"><textarea aria-label="人工复核说明" required minLength={5} maxLength={2000} value={draft.review_note} onChange={event=>setDraft({...draft,review_note:event.target.value})} /></Field><div className="live-review-grid"><Field label="执行负责人"><input required minLength={2} maxLength={80} value={draft.owner} onChange={event=>setDraft({...draft,owner:event.target.value})} /></Field><Field label="验收负责人"><input required minLength={2} maxLength={80} value={draft.reviewer} onChange={event=>setDraft({...draft,reviewer:event.target.value})} /></Field><Field label="要求完成"><input required type="datetime-local" value={draft.due_at} onChange={event=>setDraft({...draft,due_at:event.target.value})} /></Field><Field label="优先级"><select value={draft.priority} onChange={event=>setDraft({...draft,priority:event.target.value})}>{['紧急','高','中','低'].map(value=><option key={value}>{value}</option>)}</select></Field></div>{reviewError?<div className="live-error" role="alert">{reviewError}</div>:null}<Button variant="primary" type="submit" disabled={saving||draft.owner.trim()===draft.reviewer.trim()} loading={saving}><CheckCircle2 />确认复核并派单</Button></form>:<p>没有可派单的模型候选。需要现场检查时可创建独立工单。</p>}</div>:null}
    </Drawer>
  </div>;
}

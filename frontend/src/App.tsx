import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, Bell, Blocks, Bot, BrainCircuit, CheckCircle2, ChevronDown, CircleAlert, CircleHelp, ClipboardCheck, Clock3, ScanSearch,
  Cpu, Database, FileChartColumn, HardDrive, ImageIcon, Inbox, LayoutDashboard, LockKeyhole, LogOut, MapPinned, Menu,
  MonitorUp, Moon, PanelLeftClose, PanelLeftOpen, Plane, RadioTower, RefreshCw, Search, Server, Settings, ShieldCheck, Sparkles, Sun, Users, X
} from 'lucide-react';
import { Button, Drawer, IconButton, Status } from './components/ui';
import { getAnomalies, getSystemReadiness, type SystemReadiness } from './lib/api';
import Copilot from './components/Copilot';
import { notify, subscribeNotices, type NoticePayload } from './lib/actions';
import { missionProfiles } from './lib/data';
import { getAvatar } from './lib/avatars';
import LoginPage from './pages/LoginPage';
import { getIdentity, getWorkspace } from './lib/workspace';
import CommandPalette from './components/CommandPalette';

const WorkbenchPage = lazy(() => import('./pages/WorkbenchPage'));
const AnalysisTasksPage = lazy(() => import('./pages/AnalysisTasksPage'));
const MissionsWorkspacePage = lazy(() => import('./pages/MissionsWorkspacePage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const CommandCenterPage = lazy(() => import('./pages/CommandCenterPage'));
const MissionPage = lazy(() => import('./pages/MissionPage'));
const EvidencePage = lazy(() => import('./pages/EvidencePage'));
const OperationsPage = lazy(() => import('./pages/OperationsPage'));
const ResearchPage = lazy(() => import('./pages/ResearchPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));

const navGroups = [
  { label: '日常工作', items: [
    { to: '/dashboard', label: '运维工作台', icon: Inbox },
    { to: '/anomalies', label: '异常复核', icon: Activity },
    { to: '/work-orders', label: '运维工单', icon: ClipboardCheck },
  ]},
  { label: '作业运行', items: [
    { to: '/command-center', label: '指挥大屏', icon: MonitorUp },
    { to: '/overview', label: '场站概览', icon: LayoutDashboard },
    { to: '/missions', label: '任务与航线', icon: MapPinned },
    { to: '/live', label: '实时飞行', icon: Plane },
  ]},
  { label: '识别处置', items: [
    { to: '/analysis', label: '证据分析队列', icon: ScanSearch },
    { to: '/evidence', label: '双模态证据', icon: ImageIcon },
  ]},
  { label: '资产成果', items: [
    { to: '/assets', label: '资产档案', icon: HardDrive },
    { to: '/reports', label: '报告中心', icon: FileChartColumn },
  ]},
  { label: '算法数据', items: [
    { to: '/models', label: '模型实验', icon: BrainCircuit },
    { to: '/data', label: '数据管理', icon: Database },
  ]},
  { label: '系统管理', items: [
    { to: '/users', label: '用户与权限', icon: Users },
    { to: '/settings', label: '集成与设置', icon: Settings },
  ]},
];

function readCollapsedNavGroups() {
  try {
    const value = window.localStorage.getItem('sentinel_collapsed_nav_groups');
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === 'object' ? parsed as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

const siteOptions = Array.from(new Set(missionProfiles.map((item) => item.site)));
const siteMetadata: Record<string, string> = {
  '盐城一期光伏场': '江苏 · 12.6 MW',
  '东台二期光伏场': '江苏 · 8.4 MW',
  '山地研究验证场': '贵州 · 5.2 MW',
};

type ColorTheme = 'light' | 'dark';

function SiteEmblem() {
  return (
    <span className="site-avatar" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <circle className="site-emblem-sun" cx="23" cy="8" r="3" />
        <path d="M21.2 3.8 20.4 2M26.8 5.2l1.6-1.1M27.2 9.9l2 .5" />
        <path className="site-emblem-panel" d="m7.2 13.2 14.5-2 4.1 11.2-17.9 2.5-1.8-4.8 1.1-6.9Z" />
        <path d="m8 17 15-2.1M9.1 20.9l15.3-2.2M12 12.5l2.4 11.6M17 11.8l2.6 11.6M16.8 23.7l.6 3.3M12.2 27h10.4" />
      </svg>
    </span>
  );
}

function AppShell({ onLogout, theme, onThemeChange }: { onLogout: () => void; theme: ColorTheme; onThemeChange: (theme: ColorTheme) => void }) {
  const identity = useQuery({ queryKey: ['identity'], queryFn: getIdentity, retry: false });
  const workspace = useQuery({ queryKey: ['workspace-notices'], queryFn: () => getWorkspace({}), refetchInterval: 60_000, retry: false });
  const anomalySummary = useQuery({ queryKey: ['workflow-anomalies'], queryFn: getAnomalies });
  const activeAnomalies = anomalySummary.data?.filter(item => item.status !== '已排除').length;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
    const update = () => { setIsMobile(media.matches); setMobileNav(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!isMobile || !mobileNav) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector<HTMLElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileNav(false); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button, input, select') ?? [])
        .filter(element => !element.closest('[hidden]') && element.getClientRects().length && !element.hasAttribute('disabled'));
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', trap); previous?.focus(); };
  }, [isMobile, mobileNav]);
  const [collapsedNavGroups, setCollapsedNavGroups] = useState<Record<string, boolean>>(readCollapsedNavGroups);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticesRead, setNoticesRead] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [systemLoading, setSystemLoading] = useState(false);
  const [systemReadiness, setSystemReadiness] = useState<SystemReadiness | null>(null);
  const [siteOpen, setSiteOpen] = useState(false);
  const [pageAIContext, setPageAIContext] = useState<Record<string, unknown>>({});
  const [profileOpen, setProfileOpen] = useState(false);
  const [site, setSite] = useState(() => {
    const storedSite = window.localStorage.getItem('sentinel_active_site');
    return storedSite && siteOptions.includes(storedSite) ? storedSite : siteOptions[0];
  });
  const [siteSwitching, setSiteSwitching] = useState(false);
  const [toasts, setToasts] = useState<NoticePayload[]>([]);
  const siteSwitchTimer = useRef<number | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  useEffect(() => { setMobileNav(false); setSiteOpen(false); setProfileOpen(false); }, [location.pathname]);
  const activeModule = navGroups.flatMap((group) => group.items).find((item) => location.pathname.startsWith(item.to))?.label ?? '平台工作台';
  const activeMission = missionProfiles.find((item) => item.site === site) ?? missionProfiles[0];

  useEffect(() => {
    window.localStorage.setItem('sentinel_collapsed_nav_groups', JSON.stringify(collapsedNavGroups));
  }, [collapsedNavGroups]);

  useEffect(() => {
    const activeGroup = navGroups.find((group) => group.items.some((item) => location.pathname.startsWith(item.to)));
    if (!activeGroup) return;
    setCollapsedNavGroups((value) => value[activeGroup.label] ? { ...value, [activeGroup.label]: false } : value);
  }, [location.pathname]);

  useLayoutEffect(() => {
    const receiveContext = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (detail && typeof detail === 'object') setPageAIContext(detail);
    };
    window.addEventListener('sentinel:copilot-context', receiveContext);
    return () => window.removeEventListener('sentinel:copilot-context', receiveContext);
  }, []);
  useLayoutEffect(() => { setPageAIContext({}); }, [location.pathname, location.search]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      if (event.key === 'Escape') {
        setCommandOpen(false);
        setNoticeOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    const closeCopilotForPeer = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== 'copilot') setCopilotOpen(false);
    };
    window.addEventListener('sentinel:drawer-open', closeCopilotForPeer);
    return () => window.removeEventListener('sentinel:drawer-open', closeCopilotForPeer);
  }, []);

  useEffect(() => subscribeNotices((notice) => {
    setToasts((items) => [...items.slice(-2), notice]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== notice.id)), 3600);
  }), []);

  useEffect(() => () => {
    if (siteSwitchTimer.current !== null) window.clearTimeout(siteSwitchTimer.current);
  }, []);

  const routeTitle = useMemo(() => navGroups.flatMap((group) => group.items).find((item) => item.to === location.pathname)?.label ?? 'Sentinel RGBT', [location.pathname]);

  const loadReadiness = async () => {
    setSystemLoading(true);
    try {
      setSystemReadiness(await getSystemReadiness());
    } catch {
      setSystemReadiness({
        overall: 'degraded',
        checkedAt: new Date().toISOString(),
        services: [
          { id: 'api', name: '平台 API', status: 'degraded', detail: '诊断接口当前不可达，请检查后端服务。' },
          { id: 'browser', name: '前端工作区', status: 'healthy', detail: '当前浏览器界面运行正常。' },
        ],
        safetyBoundary: '诊断不可达时，不应据此判断无人机或现场设备处于可飞状态。',
      });
    } finally {
      setSystemLoading(false);
    }
  };

  const openReadiness = () => {
    setSystemOpen(true);
    void loadReadiness();
  };

  const changeSite = (nextSite: string) => {
    if (!siteOptions.includes(nextSite)) return;
    setSiteOpen(false);
    setProfileOpen(false);
    if (nextSite === site) {
      notify('当前已是该场站', `${nextSite} 的任务上下文保持不变`);
      return;
    }
    if (siteSwitchTimer.current !== null) window.clearTimeout(siteSwitchTimer.current);
    setSite(nextSite);
    setSiteSwitching(true);
    window.localStorage.setItem('sentinel_active_site', nextSite);
    notify('场站已切换', `${nextSite} · 地图、航线、无人机与环境数据已同步`);
    siteSwitchTimer.current = window.setTimeout(() => {
      setSiteSwitching(false);
      siteSwitchTimer.current = null;
    }, reduceMotion ? 160 : 900);
  };

  return (
    <div className={`app-shell ${collapsed && !isMobile ? 'sidebar-collapsed' : ''} ${mobileNav ? 'mobile-nav-open' : ''}`}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      {mobileNav ? <button className="mobile-nav-scrim" aria-label="关闭导航" onClick={() => setMobileNav(false)} /> : null}
      <aside ref={sidebarRef} className="sidebar" inert={isMobile && !mobileNav} role={isMobile && mobileNav ? 'dialog' : undefined} aria-modal={isMobile && mobileNav ? true : undefined} aria-label={isMobile ? '主导航' : undefined}>
        <div className="brand-row">
          <span className="brand-symbol" aria-hidden="true"><img src="/assets/sentinel-rgbt-mark.svg" alt="" /></span>
          <div className="brand-copy"><strong>Sentinel <b>RGBT</b></strong><small>光伏双模态智能巡检</small></div>
          <IconButton label={isMobile ? '关闭主导航' : collapsed ? '展开导航' : '收起导航'} onClick={() => isMobile ? setMobileNav(false) : setCollapsed((value) => !value)}>{isMobile ? <X /> : collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</IconButton>
        </div>
        <div className="environment-badge"><Status tone={identity.data ? 'neutral' : 'warn'}>{identity.data ? '平台工作空间' : '离线浏览 · 未连接 API'}</Status></div>
        <nav aria-label="主导航">
          {navGroups.map((group) => (
            <div className={`nav-group ${!collapsed && collapsedNavGroups[group.label] ? 'collapsed' : ''}`} key={group.label}>
              <button className="nav-group-toggle" type="button" aria-expanded={!collapsedNavGroups[group.label]} onClick={() => setCollapsedNavGroups((value) => ({ ...value, [group.label]: !value[group.label] }))}>
                <span>{group.label}</span><ChevronDown aria-hidden="true" />
              </button>
              <div className="nav-group-items" hidden={!collapsed && collapsedNavGroups[group.label]}>
                {group.items.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'} title={label}>
                    <Icon aria-hidden="true" /><span>{label}</span>{to === '/anomalies' && activeAnomalies !== undefined ? <b className="nav-count">{activeAnomalies}</b> : null}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-popover-anchor"><button className={siteSwitching ? 'site-switch is-syncing' : 'site-switch'} onClick={() => { setSiteOpen((value) => !value); setProfileOpen(false); }} aria-expanded={siteOpen} aria-haspopup="listbox"><SiteEmblem /><span><strong>{site}</strong><small>{siteMetadata[site] ?? '场站资料待完善'}</small></span><ChevronDown /></button>{siteOpen ? <div className="sidebar-popover" role="listbox" aria-label="选择当前场站"><p>切换场站</p>{siteOptions.map((name) => <button key={name} role="option" aria-selected={site === name} className={site === name ? 'active' : ''} onClick={() => changeSite(name)}>{name}</button>)}</div> : null}</div>
          <div className="sidebar-popover-anchor"><button className="profile-button" onClick={() => { setProfileOpen((value) => !value); setSiteOpen(false); }} aria-expanded={profileOpen}><img className="avatar" src={getAvatar(identity.data?.name ?? '张工')} alt="账号头像" /><span><strong>{identity.data?.name ?? '离线访客'}</strong><small>{identity.data ? ({ admin: '管理员', operator: '运维人员', pilot: '飞行人员', researcher: '研究人员', viewer: '只读用户' }[identity.data.role] ?? identity.data.role) : '仅浏览演示页面'}</small></span><ChevronDown /></button>{profileOpen ? <div className="sidebar-popover profile-menu"><button onClick={() => { navigate('/users'); setProfileOpen(false); }}>账号与权限</button><button onClick={() => { navigate('/settings'); setProfileOpen(false); }}>系统设置</button><button onClick={onLogout}><LogOut />退出登录</button></div> : null}</div>
        </div>
      </aside>

      <main className="app-main" id="main-content" inert={isMobile && mobileNav}>
        <header className="topbar">
          <IconButton className="mobile-nav-trigger" label={mobileNav ? '关闭主导航' : '打开主导航'} aria-expanded={mobileNav} onClick={() => setMobileNav(value => !value)}>{mobileNav ? <X /> : <Menu />}</IconButton>
          <div className="topbar-title"><span>新能源资产</span><b>/</b><strong>{routeTitle}</strong></div>
          <button className="command-search" aria-label="搜索平台记录或功能" title="搜索平台记录或功能" onClick={() => setCommandOpen(true)}><Search /><span>搜索任务、组件、异常或命令</span><kbd>⌘ K</kbd></button>
          <div className="topbar-actions">
            <button className="system-status-trigger" onClick={openReadiness} aria-label="查看系统连接与数据同步状态"><Activity className="system-status-icon" aria-hidden="true"/><Status tone={workspace.isError || systemReadiness?.overall === 'degraded' ? 'warn' : workspace.data ? 'good' : 'neutral'}>{workspace.isError ? 'API 未连接' : workspace.data ? 'API 已连接' : '连接检查中'}</Status></button>
            <IconButton className="theme-toggle" label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'} aria-pressed={theme === 'dark'} onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun /> : <Moon />}</IconButton>
            <div className="popover-anchor"><IconButton label="待办提醒" onClick={() => setNoticeOpen((value) => !value)}><Bell />{!noticesRead && workspace.data && workspace.data.counts.review + workspace.data.counts.overdue > 0 ? <i className="notification-dot" /> : null}</IconButton>{noticeOpen ? <div className="notification-popover"><header><strong>待办提醒</strong><button onClick={() => setNoticesRead(true)}>本次不再提示</button></header>{workspace.data ? <><button className="notification-item" onClick={() => { navigate('/dashboard?queue=review'); setNoticeOpen(false); }}><ScanSearch /><p><strong>{workspace.data.counts.review} 项证据待复核</strong><small>按风险等级处理</small></p></button><button className="notification-item" onClick={() => { navigate('/dashboard?queue=overdue'); setNoticeOpen(false); }}><Clock3 /><p><strong>{workspace.data.counts.overdue} 项工单已逾期</strong><small>来自当前平台数据库</small></p></button></> : <p className="notification-empty">连接平台后读取待办，未加载固定通知。</p>}</div> : null}</div>
            <IconButton label="帮助中心" onClick={() => setHelpOpen(true)}><CircleHelp /></IconButton>
            <button className="copilot-trigger" onClick={() => { window.dispatchEvent(new CustomEvent('sentinel:drawer-open', { detail: 'copilot' })); setCopilotOpen(true); }} aria-label="打开 AI 助手"><Sparkles /><span>AI 助手</span></button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div key={location.pathname} className="route-frame" initial={false} animate={{ opacity: 1 }} exit={reduceMotion ? undefined : { opacity: 0.95 }} transition={{ duration: 0.12 }}>
            <Suspense fallback={<div className="route-loading" role="status">正在载入业务工作区…</div>}>
              <Routes>
                <Route path="/command-center" element={<CommandCenterPage activeSite={site} onSiteChange={changeSite} />} />
                <Route path="/dashboard" element={<WorkbenchPage />} />
                <Route path="/analysis" element={<AnalysisTasksPage />} />
                <Route path="/overview" element={<DashboardPage activeSite={site} onSiteChange={changeSite} />} />
                <Route path="/missions" element={<MissionsWorkspacePage />} />
                <Route path="/live" element={<MissionPage mode="live" activeSite={site} onSiteChange={changeSite} />} />
                <Route path="/evidence" element={<EvidencePage />} />
                <Route path="/anomalies" element={<OperationsPage mode="anomalies" />} />
                <Route path="/work-orders" element={<OperationsPage mode="work-orders" />} />
                <Route path="/assets" element={<OperationsPage mode="assets" />} />
                <Route path="/models" element={<ResearchPage mode="models" />} />
                <Route path="/reports" element={<ResearchPage mode="reports" />} />
                <Route path="/data" element={<ResearchPage mode="data" />} />
                <Route path="/users" element={<AdminPage mode="users" />} />
                <Route path="/settings" element={<AdminPage mode="settings" />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      <Copilot open={copilotOpen} onClose={() => setCopilotOpen(false)} context={{
        route: location.pathname,
        query: location.search,
        module: activeModule,
        site,
        mission: ['/overview', '/live'].includes(location.pathname) ? {
          id: activeMission.id,
          area: activeMission.area,
          aircraft: activeMission.aircraftModel,
          payload: activeMission.payload,
          progressPct: activeMission.progress,
          weather: activeMission.weather,
          flight: activeMission.flight,
          source: 'demo_mission_profile',
        } : null,
        ...pageAIContext,
      }} />
      <AnimatePresence>
        {siteSwitching ? <motion.div className="site-switch-feedback" role="status" aria-live="polite" initial={reduceMotion ? false : { opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}><span><MapPinned /></span><p><small>场站上下文已同步</small><strong>{site}</strong></p><CheckCircle2 /></motion.div> : null}
      </AnimatePresence>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onNavigate={(path) => { navigate(path); setCommandOpen(false); }} />
      <Drawer open={helpOpen} title="帮助与运行边界" onClose={() => setHelpOpen(false)}><div className="help-center"><div><ShieldCheck /><span><strong>平台负责什么</strong><small>接收任务证据、质量检查、双模态复核、工单与审计。</small></span></div><div><Plane /><span><strong>无人机如何接入</strong><small>通过任务包或 REST 适配器导入，平台默认不发送飞控指令。</small></span></div><div><Bot /><span><strong>AI 如何工作</strong><small>AI 只提供解释与清单，确认异常和派发工单必须由人员操作。</small></span></div><Button variant="primary" onClick={() => { navigate('/settings'); setHelpOpen(false); }}>打开集成设置</Button><Button onClick={() => { navigate('/data'); setHelpOpen(false); }}>查看数据导入</Button></div></Drawer>
      <Drawer open={systemOpen} title="系统连接与运行诊断" onClose={() => setSystemOpen(false)}><SystemReadinessPanel readiness={systemReadiness} loading={systemLoading} onRefresh={() => void loadReadiness()} onNavigate={(path) => { navigate(path); setSystemOpen(false); }} /></Drawer>
      <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <motion.div key={toast.id} className={`toast toast-${toast.tone}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><span>{toast.tone === 'success' ? <CheckCircle2 /> : <CircleAlert />}</span><p><strong>{toast.message}</strong>{toast.detail ? <small>{toast.detail}</small> : null}</p><button aria-label="关闭提示" onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}><X /></button></motion.div>)}</div>
    </div>
  );
}


function SystemReadinessPanel({ readiness, loading, onRefresh, onNavigate }: { readiness: SystemReadiness | null; loading: boolean; onRefresh: () => void; onNavigate: (path: string) => void }) {
  const icons = { database: Database, auth: LockKeyhole, drone: RadioTower, ai: Cpu, storage: Server, api: Server, browser: LayoutDashboard };
  return <div className="system-readiness-panel">
    <div className="diagnostic-summary"><span className={readiness?.overall === 'degraded' ? 'warn' : 'good'}><Activity /></span><div><strong>{readiness?.overall === 'degraded' ? '部分能力需要检查' : '核心服务运行正常'}</strong><small>{readiness ? `诊断时间 ${new Date(readiness.checkedAt).toLocaleString('zh-CN')}` : '正在读取系统状态'}</small></div><Button loading={loading} onClick={onRefresh}><RefreshCw />刷新诊断</Button></div>
    <div className="diagnostic-list" aria-live="polite">{readiness?.services.map((service) => { const Icon = icons[service.id as keyof typeof icons] ?? Blocks; const tone = service.status === 'healthy' ? 'good' : service.status === 'degraded' ? 'warn' : 'info'; return <div key={service.id}><span><Icon /></span><p><strong>{service.name}</strong><small>{service.detail}</small></p><Status tone={tone}>{service.status === 'healthy' ? '正常' : service.status === 'degraded' ? '需检查' : service.status === 'demo' ? '演示模式' : '未启用'}</Status>{service.latencyMs != null ? <b>{service.latencyMs} ms</b> : null}</div>; })}</div>
    <div className="safety-boundary"><ShieldCheck /><p><strong>运行边界</strong><small>{readiness?.safetyBoundary ?? '平台状态与飞行器适航状态必须分别确认。'}</small></p></div>
    <div className="diagnostic-actions"><Button variant="primary" onClick={() => onNavigate('/settings')}>检查集成设置</Button><Button onClick={() => onNavigate('/data')}>检查数据入口</Button></div>
  </div>;
}



export default function App() {
  const cache = useQueryClient();
  const [authenticated, setAuthenticated] = useState(() => window.sessionStorage.getItem('sentinel_demo_session') === 'true');
  const [theme, setTheme] = useState<ColorTheme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    window.localStorage.removeItem('sentinel_demo_session');
    window.localStorage.removeItem('sentinel_access_token');
    window.localStorage.removeItem('sentinel_refresh_token');
  }, []);
  useEffect(() => {
    const expire = () => { cache.clear(); setAuthenticated(false); };
    window.addEventListener('sentinel:auth-expired', expire);
    return () => window.removeEventListener('sentinel:auth-expired', expire);
  }, [cache]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('sentinel_color_theme', theme);
  }, [theme]);
  if (!authenticated) return <LoginPage onSuccess={() => { window.sessionStorage.setItem('sentinel_demo_session', 'true'); setAuthenticated(true); }} />;
  return <AppShell theme={theme} onThemeChange={setTheme} onLogout={() => { cache.clear(); window.sessionStorage.removeItem('sentinel_demo_session'); window.sessionStorage.removeItem('sentinel_access_token'); window.sessionStorage.removeItem('sentinel_refresh_token'); setAuthenticated(false); }} />;
}

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type PropsWithChildren, type ReactNode } from 'react';
import { ArrowRight, LoaderCircle, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { createPortal } from 'react-dom';

export function Button({ className, children, loading, disabled, type = 'button', variant = 'secondary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button {...props} type={type} className={clsx('button', `button-${variant}`, className)} disabled={Boolean(loading || disabled)} aria-busy={loading || undefined}>
      {loading ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button type="button" className={clsx('icon-button', className)} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export function Panel({ children, className, title, description, action }: PropsWithChildren<{ className?: string; title?: string; description?: string; action?: ReactNode }>) {
  return (
    <section className={clsx('panel', className)}>
      {title ? (
        <header className="panel-header">
          <div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Status({ tone = 'neutral', children }: PropsWithChildren<{ tone?: 'good' | 'warn' | 'danger' | 'info' | 'neutral' }>) {
  return <span className={clsx('status-chip', `status-${tone}`)}><i aria-hidden="true" />{children}</span>;
}

export function Drawer({ open, title, onClose, children, width = 'normal' }: PropsWithChildren<{ open: boolean; title: string; onClose: () => void; width?: 'normal' | 'wide' }>) {
  const drawerRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const drawerId = useId();

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const closeForPeer = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== drawerId) onCloseRef.current();
    };
    window.addEventListener('sentinel:drawer-open', closeForPeer);
    window.dispatchEvent(new CustomEvent('sentinel:drawer-open', { detail: drawerId }));
    return () => window.removeEventListener('sentinel:drawer-open', closeForPeer);
  }, [drawerId, open]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFirst = window.requestAnimationFrame(() => {
      const first = drawerRef.current?.querySelector<HTMLElement>(focusableSelector);
      (first ?? drawerRef.current)?.focus();
    });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        event.preventDefault();
        drawerRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.cancelAnimationFrame(focusFirst);
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside ref={drawerRef} tabIndex={-1} className={clsx('drawer', width === 'wide' && 'drawer-wide')} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header><h2 id={titleId}>{title}</h2><IconButton label="关闭" onClick={onClose}><X /></IconButton></header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>, document.body
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  const context = pageHeaderContext[title] ?? { primaryLabel: '当前场站', primaryValue: '盐城一期光伏场', secondaryLabel: '数据状态', secondaryValue: '已同步', state: '系统正常', tone: 'good' as const };
  return (
    <header className="page-header" aria-label={`${title}工作栏`}>
      <div className="page-header-context">
        <span className="page-header-insight"><small>{context.primaryLabel}</small><strong>{context.primaryValue}</strong></span>
        <span className="page-header-insight"><small>{context.secondaryLabel}</small><strong>{context.secondaryValue}</strong></span>
        <Status tone={context.tone}>{context.state}</Status>
        {context.next ? <Link className="page-header-next" to={context.next.path}>{context.next.label}<ArrowRight /></Link> : null}
        <span className="visually-hidden">{eyebrow}。{description}</span>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

type PageHeaderContext = { primaryLabel: string; primaryValue: string; secondaryLabel: string; secondaryValue: string; state: string; tone: 'good' | 'warn' | 'info' | 'neutral'; next?: { label: string; path: string } };

const pageHeaderContext: Record<string, PageHeaderContext> = {
  '任务与航线': { primaryLabel: '近 30 天任务', primaryValue: '12 项', secondaryLabel: '需要复飞', secondaryValue: '1 项', state: '任务库已同步', tone: 'good', next: { label: '进入实时飞行', path: '/live' } },
  '实时任务控制台': { primaryLabel: '当前飞行器', primaryValue: 'UAV-07', secondaryLabel: '定位状态', secondaryValue: 'RTK 固定解', state: '链路在线', tone: 'good', next: { label: '复核上传证据', path: '/evidence' } },
  '双模态证据复核': { primaryLabel: 'RGB / Thermal', primaryValue: '4,286 对', secondaryLabel: '配准质量', secondaryValue: '98.2%', state: '待人工复核', tone: 'warn', next: { label: '进入异常队列', path: '/anomalies' } },
  '异常中心': { primaryLabel: '待人工复核', primaryValue: '12 项', secondaryLabel: '高风险异常', secondaryValue: '7 项', state: '证据已同步', tone: 'good', next: { label: '查看运维工单', path: '/work-orders' } },
  '运维工单': { primaryLabel: '处理中', primaryValue: '2 项', secondaryLabel: '待排程', secondaryValue: '1 项', state: '闭环率 86%', tone: 'info', next: { label: '查询资产档案', path: '/assets' } },
  '资产档案': { primaryLabel: '登记组件', primaryValue: '12,523 个', secondaryLabel: '关联异常', secondaryValue: '37 项', state: '台账正常', tone: 'good', next: { label: '生成巡检报告', path: '/reports' } },
  '模型实验': { primaryLabel: '当前基线', primaryValue: 'Thermal YOLO11n v1', secondaryLabel: '独立测试集', secondaryValue: '140 张 / 426 框', state: '权重可用', tone: 'good', next: { label: '检查训练数据', path: '/data' } },
  '报告中心': { primaryLabel: '最近报告', primaryValue: '3 份', secondaryLabel: '等待发布', secondaryValue: '1 份', state: '审计可追溯', tone: 'good', next: { label: '返回资产档案', path: '/assets' } },
  '数据管理': { primaryLabel: '已用存储', primaryValue: '1.24 TB / 4 TB', secondaryLabel: '双模态配对', secondaryValue: '98.2%', state: '校验正常', tone: 'good', next: { label: '验证模型版本', path: '/models' } },
  '用户与权限': { primaryLabel: '有效账号', primaryValue: '6 个', secondaryLabel: '角色策略', secondaryValue: '5 项', state: '无高风险登录', tone: 'good', next: { label: '检查集成设置', path: '/settings' } },
  '集成与设置': { primaryLabel: '数据适配器', primaryValue: '3 个', secondaryLabel: '通知通道', secondaryValue: '2 个', state: '演示适配器', tone: 'neutral' },
};

export function Field({ label, hint, children }: PropsWithChildren<{ label: string; hint?: string }>) {
  return <label className="field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

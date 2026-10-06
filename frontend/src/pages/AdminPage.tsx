import { useEffect, useState } from 'react';
import { BellRing, Bot, CheckCircle2, Cloud, Code2, Cpu, Database, History, KeyRound, LockKeyhole, PlugZap, Plus, Save, ShieldCheck, Smartphone, UserCog, Users } from 'lucide-react';
import { Button, Drawer, Field, PageHeader, Panel, Status } from '../components/ui';
import { notify } from '../lib/actions';
import { getAvatar } from '../lib/avatars';
import { getAIProviders, getApiErrorMessage, testAIProvider, type AIProvider } from '../lib/api';

const initialUsers = [
  ['张工','admin@sentinel-rgbt.com','系统管理员','全部场站','正常','今天 10:20'],
  ['李工','li@sentinel-rgbt.com','运维工程师','盐城一期','正常','今天 09:58'],
  ['王强','wang@sentinel-rgbt.com','数据质量专员','盐城一期 / 东台二期','正常','昨天 16:42'],
  ['研究者','research@sentinel-rgbt.com','算法研究员','研究空间','正常','今天 11:08'],
  ['审计员','audit@sentinel-rgbt.com','只读审计','全部场站','暂停','08/30 12:18']
];
type UserRow = (typeof initialUsers)[number];

export default function AdminPage({ mode }: { mode: 'users' | 'settings' }) {
  return mode === 'users' ? <UsersPage /> : <SettingsPage />;
}

function UsersPage() {
  const [users, setUsers] = useState(initialUsers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const toggleUser = (email: string) => {
    setUsers((items) => items.map((user) => user[1] === email ? [user[0], user[1], user[2], user[3], user[4] === '正常' ? '暂停' : '正常', user[5]] : user));
    setSelected((user) => user && user[1] === email ? [user[0], user[1], user[2], user[3], user[4] === '正常' ? '暂停' : '正常', user[5]] : user);
    notify('账号状态已更新', email);
  };

  return <div className="page"><PageHeader eyebrow="IDENTITY & ACCESS" title="用户与权限" description="按角色、场站和操作范围控制访问，并记录高风险操作。" actions={<Button variant="primary" onClick={() => setInviteOpen(true)}><Plus />邀请用户</Button>} /><div className="security-overview"><Panel><span className="security-icon"><Users /></span><strong>{users.filter((user) => user[4] === '正常').length}</strong><p>活跃用户</p></Panel><Panel><span className="security-icon"><UserCog /></span><strong>5</strong><p>角色策略</p></Panel><Panel><span className="security-icon"><KeyRound /></span><strong>100%</strong><p>强密码策略</p></Panel><Panel><span className="security-icon"><ShieldCheck /></span><strong>0</strong><p>高风险登录</p></Panel></div><Panel className="table-panel" title="用户账号" description="支持最小权限、会话撤销与场站隔离"><div className="data-table user-table"><div className="data-row data-head"><span>用户</span><span>角色</span><span>访问范围</span><span>状态</span><span>最近活动</span></div>{users.map((user) => <button className="data-row" key={user[1]} onClick={() => setSelected(user)}><span className="user-cell"><img className="avatar" src={getAvatar(user[0])} alt={`${user[0]}头像`} /><span><strong>{user[0]}</strong><small>{user[1]}</small></span></span><span>{user[2]}</span><span>{user[3]}</span><span><Status tone={user[4] === '正常' ? 'good' : 'neutral'}>{user[4]}</Status></span><span>{user[5]}</span></button>)}</div></Panel><div className="admin-lower"><Panel title="角色权限矩阵" description="后端在每个接口执行权限检查"><div className="permission-matrix"><div><span>能力</span><b>管理员</b><b>运维</b><b>飞手</b><b>研究</b></div>{[['任务管理',1,1,1,0],['异常复核',1,1,0,1],['工单处置',1,1,0,0],['模型实验',1,0,0,1],['用户管理',1,0,0,0],['审计导出',1,0,0,0]].map((row) => <div key={row[0] as string}><span>{row[0]}</span>{row.slice(1).map((allowed,index) => <b key={index} className={allowed ? 'allowed' : ''}>{allowed ? <CheckCircle2 /> : '—'}</b>)}</div>)}</div></Panel><Panel title="认证安全" description="生产部署建议"><div className="security-list"><div><LockKeyhole /><span><strong>密码哈希</strong><small>Argon2id / bcrypt，禁止明文保存</small></span><Status tone="good">已配置</Status></div><div><Smartphone /><span><strong>多因素认证</strong><small>TOTP 或企业 SSO</small></span><Status tone="warn">待接入</Status></div><div><ShieldCheck /><span><strong>访问令牌</strong><small>短期 JWT + 可撤销刷新令牌</small></span><Status tone="good">参考实现</Status></div></div></Panel></div>
    <Drawer open={inviteOpen} title="邀请平台用户" onClose={() => setInviteOpen(false)}><div className="form-stack"><Field label="姓名"><input id="invite-name" placeholder="例如 赵工" /></Field><Field label="工作邮箱"><input id="invite-email" type="email" placeholder="name@company.com" /></Field><Field label="角色"><select><option>运维工程师</option><option>现场飞手</option><option>算法研究员</option><option>只读审计</option></select></Field><Field label="访问范围"><select><option>盐城一期</option><option>东台二期</option><option>研究空间</option></select></Field><Button variant="primary" onClick={() => { const user: UserRow = ['受邀用户', `invite${users.length + 1}@sentinel-rgbt.com`, '运维工程师', '盐城一期', '待激活', '尚未登录']; setUsers((items) => [...items, user]); setInviteOpen(false); notify('邀请已创建', `${user[1]} · 等待激活`); }}>发送邀请</Button></div></Drawer>
    <Drawer open={Boolean(selected)} title="用户账号详情" onClose={() => setSelected(null)}>{selected ? <div className="detail-drawer"><Status tone={selected[4] === '正常' ? 'good' : 'neutral'}>{selected[4]}</Status><h3>{selected[0]}</h3><p>{selected[1]}</p><dl className="evidence-facts"><div><dt>角色</dt><dd>{selected[2]}</dd></div><div><dt>访问范围</dt><dd>{selected[3]}</dd></div><div><dt>最近活动</dt><dd>{selected[5]}</dd></div><div><dt>多因素认证</dt><dd>待接入</dd></div></dl><Button variant={selected[4] === '正常' ? 'danger' : 'primary'} onClick={() => toggleUser(selected[1])}>{selected[4] === '正常' ? '暂停账号' : '恢复账号'}</Button><Button onClick={() => notify('当前会话已撤销', selected[1])}>撤销全部会话</Button></div> : null}</Drawer>
  </div>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) { return <button className={checked ? 'toggle active' : 'toggle'} onClick={onChange} role="switch" aria-checked={checked} aria-label={label}><span /></button>; }

const sections = [
  ['integrations', '集成连接', PlugZap], ['ai', 'AI 模型', Bot], ['storage', '数据与存储', Database],
  ['notifications', '通知策略', BellRing], ['security', '安全策略', ShieldCheck], ['audit', '审计与保留', History]
] as const;

function SettingsPage() {
  const saved = (() => { try { return JSON.parse(window.localStorage.getItem('sentinel_settings') ?? '{}'); } catch { return {}; } })();
  const [section, setSection] = useState('integrations');
  const [drone, setDrone] = useState(saved.drone ?? true);
  const [ai, setAi] = useState(saved.ai ?? true);
  const [webhook, setWebhook] = useState(saved.webhook ?? false);
  const [provider, setProvider] = useState(window.localStorage.getItem('sentinel_ai_provider') ?? saved.provider ?? 'auto');
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    getAIProviders().then((result) => setProviders(result.providers)).catch(() => setProviders([]));
  }, []);
  const save = () => {
    window.localStorage.setItem('sentinel_settings', JSON.stringify({ drone, ai, webhook, provider }));
    window.localStorage.setItem('sentinel_ai_provider', provider);
    notify('设置已保存', '配置已写入当前浏览器演示环境');
  };
  const test = async () => {
    setTesting(true);
    try {
      const target = provider === 'auto' ? providers.find((item) => item.default)?.id ?? 'demo' : provider;
      const result = await testAIProvider(target);
      notify('模型连接测试通过', `${result.provider} / ${result.model} · ${Math.round(result.latencyMs)} ms`);
    } catch (caught) {
      notify('模型连接测试失败', getApiErrorMessage(caught, '请检查后端密钥、模型标识与服务地址'), 'error');
    } finally { setTesting(false); }
  };
  const activeProvider = provider === 'auto' ? providers.find((item) => item.default) : providers.find((item) => item.id === provider);

  return <div className="page"><PageHeader eyebrow="INTEGRATIONS & PLATFORM" title="集成与设置" description="配置无人机数据适配器、AI 模型、存储、通知和安全策略。" actions={<Button variant="primary" onClick={save}><Save />保存更改</Button>} /><div className="settings-layout"><nav className="settings-nav">{sections.map(([value, label]) => <button key={value} className={section === value ? 'active' : ''} onClick={() => setSection(value)}>{label}</button>)}</nav><div className="settings-content">
    {section === 'integrations' ? <Panel title="连接器" description="所有生产凭据仅从服务端环境变量读取"><div className="integration-list"><div><span className="integration-icon"><PlugZap /></span><div><strong>无人机任务适配器</strong><p>导入厂商任务、影像、SRT 和遥测元数据；演示模式不发送飞控指令。</p><small>模式：DJI 文件导入 / 自定义 REST</small></div><Status tone={drone ? 'good' : 'neutral'}>{drone ? '已启用' : '已停用'}</Status><Toggle checked={drone} onChange={() => setDrone(!drone)} label="无人机任务适配器" /></div><div><span className="integration-icon"><Bot /></span><div><strong>AI 助手与解释服务</strong><p>支持 OpenAI 兼容接口，可配置 GPT、DeepSeek、豆包或本地网关。</p><small>当前：安全演示提供商</small></div><Status tone={ai ? 'good' : 'neutral'}>{ai ? '已启用' : '已停用'}</Status><Toggle checked={ai} onChange={() => setAi(!ai)} label="AI 助手" /></div><div><span className="integration-icon"><Cloud /></span><div><strong>事件 Webhook</strong><p>高风险异常确认、工单状态变化和报告发布时推送。</p><small>签名：HMAC-SHA256 · 重试 3 次</small></div><Status tone={webhook ? 'good' : 'neutral'}>{webhook ? '已启用' : '已停用'}</Status><Toggle checked={webhook} onChange={() => setWebhook(!webhook)} label="事件 Webhook" /></div></div></Panel> : null}
    {section === 'ai' ? <Panel title="AI 提供商" description="模型路由、密钥和超时全部由后端控制，浏览器只保存模型偏好"><div className="provider-tabs"><button className={provider === 'auto' ? 'active' : ''} onClick={() => setProvider('auto')}>自动路由</button>{providers.map((item) => <button key={item.id} disabled={!item.configured} title={item.configured ? item.model : '需要在 backend/.env 中配置密钥'} className={provider === item.id ? 'active' : ''} onClick={() => setProvider(item.id)}>{item.label}{item.configured ? '' : ' · 未配置'}</button>)}</div><div className="form-grid provider-form"><Field label="当前路由"><input value={provider === 'auto' ? `自动 → ${activeProvider?.label ?? '安全演示'}` : activeProvider?.label ?? '尚未读取'} readOnly /></Field><Field label="模型标识"><input value={activeProvider?.model ?? '由服务端配置'} readOnly /></Field><Field label="凭据状态"><input value={activeProvider?.configured ? '服务端已就绪' : '尚未配置'} readOnly /></Field><Field label="协议"><input value={activeProvider?.mode === 'local' ? '平台本地解释器' : 'OpenAI-compatible HTTPS'} readOnly /></Field></div><div className="form-callout"><Code2 /><p>已支持 OpenAI、DeepSeek、豆包火山方舟、通义千问百炼和自定义兼容网关。页面上下文会裁剪后发送，密钥不会进入前端代码或浏览器存储。</p></div><Button loading={testing} disabled={!activeProvider?.configured} onClick={test}><Cpu />实际调用一次并测试连接</Button></Panel> : null}
    {section === 'storage' ? <Panel title="数据与存储" description="原始证据、派生结果和报告分层管理"><div className="settings-grid"><Field label="对象存储"><select><option>本地文件系统（演示）</option><option>S3 兼容存储</option></select></Field><Field label="原始数据校验"><select><option>SHA-256</option><option>SHA-512</option></select></Field><Field label="临时缓存上限"><select><option>200 GB</option><option>500 GB</option></select></Field><Field label="自动清理"><select><option>仅清理派生缓存</option><option>关闭</option></select></Field></div></Panel> : null}
    {section === 'notifications' ? <Panel title="通知策略" description="高风险事件按角色和时段送达"><div className="settings-list"><label><span><strong>高风险异常</strong><small>确认后立即通知运维主管</small></span><Toggle checked={true} onChange={() => notify('核心安全通知不可关闭', '可在生产策略中调整接收人', 'warning')} label="高风险异常通知" /></label><label><span><strong>任务质量不足</strong><small>生成复飞建议时通知飞手</small></span><Toggle checked={webhook} onChange={() => setWebhook(!webhook)} label="质量通知" /></label></div></Panel> : null}
    {section === 'security' ? <Panel title="安全策略" description="认证与高风险操作保护"><div className="settings-grid"><Field label="访问令牌有效期"><select><option>15 分钟</option><option>30 分钟</option></select></Field><Field label="刷新令牌有效期"><select><option>7 天</option><option>30 天</option></select></Field><Field label="登录失败锁定"><select><option>5 次 / 15 分钟</option><option>10 次 / 30 分钟</option></select></Field><Field label="高风险操作"><select><option>要求二次确认</option><option>要求 MFA</option></select></Field></div></Panel> : null}
    {section === 'audit' ? <Panel title="审计与保留" description="操作记录与证据生命周期"><div className="settings-grid"><Field label="审计日志保留"><select><option>365 天</option><option>730 天</option></select></Field><Field label="原始影像保留"><select><option>长期保留</option><option>365 天</option></select></Field><Field label="报告版本保留"><select><option>全部版本</option><option>仅发布版本</option></select></Field><Field label="导出水印"><select><option>包含操作者与时间</option><option>仅包含时间</option></select></Field></div></Panel> : null}
  </div></div></div>;
}

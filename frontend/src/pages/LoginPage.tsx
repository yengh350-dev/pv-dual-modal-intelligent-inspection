import { useState } from 'react';
import { CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, ImageIcon, ClipboardCheck, MapPinned } from 'lucide-react';
import { Button, Drawer, Field } from '../components/ui';
import { getApiErrorMessage, isApiUnavailable, login } from '../lib/api';

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('admin@sentinel-rgbt.com');
  const [password, setPassword] = useState('Sentinel123!');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading || demoLoading) return;
    if (!email.trim() || !password) { setError('请填写工作邮箱和密码。'); return; }
    setLoading(true);
    setError('');
    try {
      const result = await login(email.trim(), password);
      window.sessionStorage.setItem('sentinel_access_token', result.accessToken);
      window.sessionStorage.setItem('sentinel_refresh_token', result.refreshToken);
      onSuccess();
    } catch (caught) {
      setError(isApiUnavailable(caught) ? '后端服务当前不可达。可以使用下方“进入演示环境”浏览完整平台。' : getApiErrorMessage(caught, '登录失败，请检查账号信息。'));
    } finally { setLoading(false); }
  };

  const enterDemo = async () => {
    setDemoLoading(true);
    setError('');
    try {
      const result = await login('admin@sentinel-rgbt.com', 'Sentinel123!');
      window.sessionStorage.setItem('sentinel_access_token', result.accessToken);
      window.sessionStorage.setItem('sentinel_refresh_token', result.refreshToken);
      onSuccess();
    } catch (caught) {
      if (isApiUnavailable(caught)) {
        window.sessionStorage.removeItem('sentinel_access_token');
        window.sessionStorage.removeItem('sentinel_refresh_token');
        onSuccess();
      } else {
        setError(getApiErrorMessage(caught, '演示账号不可用，请使用已授权账号登录。'));
      }
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-visual">
        <img src="/assets/field-map.png" alt="概念演示：俯视光伏场航拍影像" />
        <div className="login-shade" />
        <div className="login-brand"><span className="brand-symbol large" aria-hidden="true"><img src="/assets/sentinel-rgbt-mark.svg" alt="" /></span><div><strong>Sentinel <b>RGBT</b></strong><small>光伏双模态智能巡检平台</small></div></div>
        <div className="login-story">
          <h1>光伏巡检工作台</h1>
          <p>任务执行、证据复核与运维处置。</p>
          <div className="login-proof"><span><MapPinned />任务与航线</span><span><ImageIcon />证据复核</span><span><ClipboardCheck />运维闭环</span></div>
        </div>
        <small className="concept-label">概念演示影像 · 非真实场站数据</small>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="login-card-heading"><span className="secure-mark"><LockKeyhole /></span><div><h2>登录控制台</h2><p>进入所属组织的巡检工作空间。</p></div></div>
          <form onSubmit={submit}>
            <Field label="工作邮箱"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" disabled={loading || demoLoading} required /></Field>
            <Field label="密码"><div className="password-input"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /><button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></div></Field>
            <div className="form-options"><span>仅本次会话</span><button type="button" onClick={() => setResetOpen(true)}>忘记密码</button></div>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <Button type="submit" variant="primary" loading={loading} disabled={demoLoading}>登录工作空间</Button>
            <Button type="button" variant="secondary" loading={demoLoading} disabled={loading} onClick={enterDemo}>进入演示环境</Button>
          </form>
          <div className="demo-credentials"><strong>演示账号</strong><span>admin@sentinel-rgbt.com</span><span>Sentinel123!</span></div>
          <p className="security-note"><ShieldCheck />演示环境使用样例任务，不连接真实无人机。</p>
        </div>
      </section>
      <Drawer open={resetOpen} title="找回账号访问" onClose={() => setResetOpen(false)}>
        <div className="form-stack"><div className="form-callout"><Mail /><p>当前未配置邮件恢复服务。请联系组织管理员核实账号后重置密码；平台不会生成虚假的发送成功提示。</p></div><Button onClick={() => setResetOpen(false)}>返回登录</Button></div>
      </Drawer>
    </main>
  );
}

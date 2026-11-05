import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { ErrorBanner, Field, Notice } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

const DEMO_ACCOUNTS = [
  { loginId: 'sysadmin', role: 'System Admin', person: 'Admin', blurb: 'Everything, users & audit logs' },
  { loginId: 'salesuser', role: 'Sales Manager', person: 'Amit Sharma', blurb: 'Sales orders, deliveries' },
  { loginId: 'purchaser', role: 'Purchase Manager', person: 'Neha Verma', blurb: 'Purchase orders, receipts' },
  { loginId: 'mfguser', role: 'Production Head', person: 'Meera Singh', blurb: 'BoMs, manufacturing, work orders' },
  { loginId: 'invmanager', role: 'Inventory Manager', person: 'Ravi Patel', blurb: 'Stock, confirms operations' },
  { loginId: 'bizowner', role: 'Business Owner', person: 'Shiv Kumar', blurb: 'Sees everything, read-only' },
];

export default function LoginPage() {
  const { user, login, demoLogin } = useAuth();
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (user) return <Navigate to="/" replace />;

  const go = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void go('form', () => login(loginId.trim(), password));
  };

  const reset = async () => {
    setBusy('reset');
    setError(null);
    try {
      await api.post('/demo/reset');
      setNotice('Demo data restored.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="grid w-full max-w-4xl gap-6 md:grid-cols-2">
        <form onSubmit={submit} className="card p-6">
          <div className="mb-6 flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="h-10 w-10" />
            <div>
              <h1 className="text-lg font-semibold">Shiv Furniture ERP</h1>
              <p className="text-sm text-slate-500">From demand to delivery</p>
            </div>
          </div>
          <ErrorBanner message={error} onClose={() => setError(null)} />
          <Field label="Login Id" className="mb-3">
            <input className="input" value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" required />
          </Field>
          <Field label="Password" className="mb-4">
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <button type="submit" className="btn-primary w-full justify-center" disabled={busy !== null}>
            {busy === 'form' ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="mt-4 flex justify-between text-sm">
            <span className="cursor-not-allowed text-slate-400" title="Not available in the demo">
              Forgot password?
            </span>
            <Link to="/signup" className="text-indigo-600 hover:underline">
              Sign up
            </Link>
          </div>
        </form>

        <div className="card p-6">
          <h2 className="font-semibold">Try a demo account</h2>
          <p className="mb-4 text-sm text-slate-500">One click, no password. Each role sees different modules.</p>
          {notice && <Notice tone="success">{notice}</Notice>}
          <div className="grid gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.loginId}
                type="button"
                disabled={busy !== null}
                onClick={() => void go(a.loginId, () => demoLogin(a.loginId))}
                className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
              >
                <span>
                  <span className="block text-sm font-medium">{a.role}</span>
                  <span className="block text-xs text-slate-500">
                    {a.person} · {a.blurb}
                  </span>
                </span>
                <span className="text-sm text-indigo-600">{busy === a.loginId ? '…' : 'Enter →'}</span>
              </button>
            ))}
          </div>
          <button type="button" className="mt-4 text-sm text-slate-500 underline hover:text-slate-700" disabled={busy !== null} onClick={reset}>
            {busy === 'reset' ? 'Resetting demo data…' : 'Reset demo data'}
          </button>
        </div>
      </div>
    </div>
  );
}

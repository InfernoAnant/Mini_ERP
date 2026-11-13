import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { ErrorBanner, Field } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

function validate(f: { loginId: string; email: string; password: string; confirm: string }): string | null {
  if (!/^[A-Za-z0-9_]{6,12}$/.test(f.loginId)) return 'Login Id must be 6–12 letters, numbers or _';
  if (!/^\S+@\S+\.\S+$/.test(f.email)) return 'Enter a valid email';
  if (f.password.length < 8 || !/[a-z]/.test(f.password) || !/[A-Z]/.test(f.password) || !/[^A-Za-z0-9]/.test(f.password)) {
    return 'Password needs 8+ characters with an uppercase letter, a lowercase letter and a special character';
  }
  if (f.password !== f.confirm) return 'Passwords do not match';
  return null;
}

export default function SignupPage() {
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', loginId: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = validate(form);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await signup({ name: form.name, loginId: form.loginId, email: form.email, password: form.password });
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-md p-6">
        <h1 className="mb-1 text-lg font-semibold">Create an account</h1>
        <p className="mb-4 text-sm text-slate-500">New accounts start with no module access until an administrator grants it.</p>
        <ErrorBanner message={error} onClose={() => setError(null)} />
        <div className="grid gap-3">
          <Field label="Name">
            <input className="input" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Login Id (6–12 characters)">
            <input className="input" value={form.loginId} onChange={set('loginId')} autoComplete="username" required />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.email} onChange={set('email')} required />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Re-enter password">
            <input
              className="input"
              type="password"
              value={form.confirm}
              onChange={set('confirm')}
              autoComplete="new-password"
              required
            />
          </Field>
        </div>
        <button type="submit" className="btn-primary mt-4 w-full justify-center" disabled={busy}>
          {busy ? 'Creating…' : 'Sign up'}
        </button>
        <p className="mt-4 text-center text-sm">
          Already have an account?{' '}
          <Link to="/login" className="text-indigo-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}

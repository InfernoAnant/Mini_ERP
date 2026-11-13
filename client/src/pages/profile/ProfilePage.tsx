import { type FormEvent, useState } from 'react';
import { api } from '../../api/client';
import { useAction, useLoad, useOnChange } from '../../api/hooks';
import type { UserDTO } from '../../api/types';
import { ErrorBanner, Field, Notice, PageHeader, Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

export default function ProfilePage() {
  const { refresh } = useAuth();
  const { data, error } = useLoad(() => api.get<UserDTO>('/users/me'), []);
  const [form, setForm] = useState({ name: '', address: '', mobile: '', photoUrl: '' });
  const [saved, setSaved] = useState(false);
  const action = useAction();

  useOnChange(data, (d) => {
    if (d) setForm({ name: d.name, address: d.address ?? '', mobile: d.mobile ?? '', photoUrl: d.photoUrl ?? '' });
  });

  if (!data) return error ? <ErrorBanner message={error} /> : <Spinner />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const ok = await action.run(() =>
      api.patch<UserDTO>('/users/me', {
        name: form.name,
        address: form.address || null,
        mobile: form.mobile || null,
        photoUrl: form.photoUrl || null,
      }),
    );
    if (ok) {
      setSaved(true);
      await refresh();
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="My profile" />
      <ErrorBanner message={action.error} onClose={() => action.setError(null)} />
      {saved && <Notice tone="success">Profile saved.</Notice>}
      <form onSubmit={submit} className="card grid gap-4 p-5 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-3">
          <Field label="Name">
            <input className="input" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Address">
            <input className="input" value={form.address} onChange={set('address')} />
          </Field>
          <Field label="Mobile number">
            <input className="input" value={form.mobile} onChange={set('mobile')} />
          </Field>
          <Field label="Email (used to sign up — can't be changed)">
            <input className="input" value={data.email} disabled />
          </Field>
          <Field label="Position (set by the system administrator)">
            <input className="input" value={data.position ?? '—'} disabled />
          </Field>
          <Field label="Photo URL">
            <input className="input" value={form.photoUrl} onChange={set('photoUrl')} placeholder="https://…" />
          </Field>
          <div>
            <button type="submit" className="btn-primary" disabled={action.busy}>
              {action.busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-3xl font-semibold text-slate-400">
          {form.photoUrl ? (
            <img src={form.photoUrl} alt="Profile" className="h-full w-full object-cover" />
          ) : (
            data.name.slice(0, 1)
          )}
        </div>
      </form>
    </div>
  );
}

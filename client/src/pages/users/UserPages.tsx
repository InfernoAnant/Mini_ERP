import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAction, useLoad } from '../../api/hooks';
import type { AccessLevel, Module, Paged, UserDTO } from '../../api/types';
import { ErrorBanner, Field, label, Notice, PageHeader, Spinner } from '../../components/ui';

const MODULES: Module[] = ['SALES', 'PURCHASE', 'MANUFACTURING', 'BOM', 'PRODUCTS'];
const LEVELS: AccessLevel[] = ['ADMIN', 'USER', 'NONE'];
const LEVEL_HELP: Record<AccessLevel, string> = {
  ADMIN: 'Full access: confirm, cancel, delete, edit anything, confirm stock operations',
  USER: 'View, create, edit own drafts, place stock operations',
  NONE: 'Module hidden',
};

export function UserListPage() {
  const navigate = useNavigate();
  const { data, error } = useLoad(() => api.get<Paged<UserDTO>>('/users'), []);
  if (!data) return error ? <ErrorBanner message={error} /> : <Spinner />;
  return (
    <div>
      <PageHeader title="Users" />
      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Login Id</th>
              <th className="th">Position</th>
              {MODULES.map((m) => (
                <th key={m} className="th">
                  {label(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.items.map((u) => (
              <tr key={u.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/users/${u.id}`)}>
                <td className="td font-medium">
                  {u.name}
                  {u.isDemoLocked && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">demo</span>}
                  {u.readOnly && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">read-only</span>}
                </td>
                <td className="td">{u.loginId}</td>
                <td className="td">{u.position ?? '—'}</td>
                {MODULES.map((m) => (
                  <td key={m} className="td">
                    <span className={u.access[m] === 'ADMIN' ? 'font-medium text-indigo-700' : u.access[m] === 'NONE' ? 'text-slate-400' : ''}>{label(u.access[m])}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function UserFormPage() {
  const { id } = useParams();
  const user = useLoad(() => api.get<UserDTO>(`/users/${id}`), [id]);
  const [profile, setProfile] = useState({ name: '', address: '', mobile: '', position: '', readOnly: false });
  const [access, setAccess] = useState<Record<Module, AccessLevel> | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const action = useAction();
  const u = user.data;

  useEffect(() => {
    if (!u) return;
    setProfile({ name: u.name, address: u.address ?? '', mobile: u.mobile ?? '', position: u.position ?? '', readOnly: u.readOnly });
    setAccess(u.access);
  }, [u]);

  if (!u || !access) return user.error ? <ErrorBanner message={user.error} /> : <Spinner />;
  const locked = u.isDemoLocked;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(null);
    const res = await action.run(() =>
      api.patch<UserDTO>(`/users/${id}`, { name: profile.name, address: profile.address || null, mobile: profile.mobile || null, position: profile.position || null, readOnly: profile.readOnly }),
    );
    if (res) {
      user.setData(res);
      setSaved('Profile saved.');
    }
  };
  const saveAccess = async () => {
    setSaved(null);
    const res = await action.run(() => api.put<UserDTO>(`/users/${id}/access`, access));
    if (res) {
      user.setData(res);
      setSaved('Access saved. It applies on the user’s next request.');
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={u.name}
        back={
          <Link to="/users" className="text-sm text-slate-500 hover:text-slate-800">
            ← Users
          </Link>
        }
      >
        <Link to={`/audit?module=USERS&recordId=${u.id}`} className="btn-secondary">
          Logs
        </Link>
      </PageHeader>
      <ErrorBanner message={action.error} onClose={() => action.setError(null)} />
      {saved && <Notice tone="success">{saved}</Notice>}
      {locked && <Notice tone="warn">This is a shared demo account — its position, read-only flag and access can't be changed. Sign up a new user to try access control.</Notice>}

      <form onSubmit={saveProfile} className="card mb-4 grid gap-3 p-5 sm:grid-cols-2">
        <Field label="Name">
          <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required />
        </Field>
        <Field label="Login Id">
          <input className="input" value={u.loginId} disabled />
        </Field>
        <Field label="Email">
          <input className="input" value={u.email} disabled />
        </Field>
        <Field label="Position (only the administrator can change this)">
          <input className="input" value={profile.position} disabled={locked} onChange={(e) => setProfile({ ...profile, position: e.target.value })} />
        </Field>
        <Field label="Address">
          <input className="input" value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
        </Field>
        <Field label="Mobile">
          <input className="input" value={profile.mobile} onChange={(e) => setProfile({ ...profile, mobile: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={profile.readOnly} disabled={locked || u.isSystemAdmin} onChange={(e) => setProfile({ ...profile, readOnly: e.target.checked })} />
          Read-only (can view the modules below but not change anything — e.g. business owner)
        </label>
        <div>
          <button type="submit" className="btn-primary" disabled={action.busy}>
            Save profile
          </button>
        </div>
      </form>

      <div className="card p-5">
        <h2 className="mb-1 font-semibold">Module access</h2>
        {u.isSystemAdmin ? (
          <p className="text-sm text-slate-600">System administrators have full access to every module.</p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="th">Module</th>
                    {LEVELS.map((l) => (
                      <th key={l} className="th text-center" title={LEVEL_HELP[l]}>
                        {label(l)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((m) => (
                    <tr key={m} className="border-t border-slate-100">
                      <td className="td font-medium">{label(m)}</td>
                      {LEVELS.map((l) => (
                        <td key={l} className="td text-center">
                          <input type="radio" name={m} aria-label={`${m} ${l}`} checked={access[m] === l} disabled={locked} onChange={() => setAccess({ ...access, [m]: l })} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-3 text-xs text-slate-500">
              {LEVELS.map((l) => (
                <li key={l}>
                  <span className="font-medium">{label(l)}:</span> {LEVEL_HELP[l]}
                </li>
              ))}
            </ul>
            {!locked && (
              <button type="button" className="btn-primary mt-3" disabled={action.busy} onClick={saveAccess}>
                Save access
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import type { Module } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { Modal } from './ui';

type MenuItem = { to: string; label: string; visible: boolean };

export default function Layout() {
  const { user, can, logout, canPlaceOperation, canConfirmOperation } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  if (!user) return null;

  const view = (m: Module) => can(m, 'view');
  const stockOps =
    (['DELIVERY', 'RECEIPT', 'PRODUCTION', 'ADJUSTMENT'] as const).some((t) => canPlaceOperation(t) || canConfirmOperation(t)) ||
    view('SALES') ||
    view('PURCHASE') ||
    view('MANUFACTURING');
  const items: MenuItem[] = [
    { to: '/', label: 'Dashboard', visible: true },
    { to: '/sales', label: 'Sale Orders', visible: view('SALES') },
    { to: '/purchase', label: 'Purchase Orders', visible: view('PURCHASE') },
    { to: '/manufacturing', label: 'Manufacturing Orders', visible: view('MANUFACTURING') },
    { to: '/boms', label: 'Bills of Materials', visible: view('BOM') },
    { to: '/products', label: 'Products', visible: view('PRODUCTS') },
    { to: '/operations', label: 'Stock Operations', visible: stockOps },
    { to: '/audit', label: 'Audit Logs', visible: user.isSystemAdmin },
    { to: '/users', label: 'Users', visible: user.isSystemAdmin },
  ];
  const noAccess = !user.isSystemAdmin && Object.values(user.access).every((l) => l === 'NONE');

  const doReset = async () => {
    setResetting(true);
    setResetMsg(null);
    try {
      await api.post('/demo/reset');
      setResetOpen(false);
      navigate('/');
      window.location.reload();
    } catch (err) {
      setResetMsg(errorMessage(err));
    } finally {
      setResetting(false);
    }
  };

  const nav = (
    <nav className="flex flex-col gap-0.5 p-2">
      {items
        .filter((i) => i.visible)
        .map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === '/'}
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) =>
              `rounded-md px-3 py-2 text-sm ${isActive ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-700 hover:bg-slate-100'}`
            }
          >
            {i.label}
          </NavLink>
        ))}
    </nav>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span>Shiv Furniture ERP</span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary hidden sm:inline-flex" onClick={() => setResetOpen(true)}>
            Reset demo
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setAvatarOpen((o) => !o)}
              className="flex items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-3 text-sm hover:bg-slate-50"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden sm:inline">{user.name}</span>
            </button>
            {avatarOpen && (
              <div className="card absolute right-0 mt-1 w-56 py-1" onMouseLeave={() => setAvatarOpen(false)}>
                <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
                  {user.position ?? 'User'}
                  {user.readOnly && ' · read-only'}
                </div>
                <Link to="/profile" className="block px-3 py-2 text-sm hover:bg-slate-50" onClick={() => setAvatarOpen(false)}>
                  My profile
                </Link>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 sm:hidden"
                  onClick={() => setResetOpen(true)}
                >
                  Reset demo data
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
                  onClick={async () => {
                    await logout();
                    navigate('/login');
                  }}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 border-r border-slate-200 bg-white lg:block">
          {nav}
        </aside>
        {menuOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setMenuOpen(false)}>
            <aside className="h-full w-64 bg-white" onClick={(e) => e.stopPropagation()}>
              <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 font-semibold">
                Master Menu
                <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu">
                  ✕
                </button>
              </div>
              {nav}
            </aside>
          </div>
        )}
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          {noAccess && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              No access yet — ask an administrator to grant you access to a module.
            </div>
          )}
          <Outlet />
        </main>
      </div>

      {resetOpen && (
        <Modal
          title="Reset demo data?"
          onClose={() => setResetOpen(false)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setResetOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={resetting} onClick={doReset}>
                {resetting ? 'Resetting…' : 'Reset'}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Everyone shares this demo. Resetting restores the original Shiv Furniture data (products, orders and stock) so the
            demo script works from the start.
          </p>
          {resetMsg && <p className="mt-2 text-sm text-rose-700">{resetMsg}</p>}
        </Modal>
      )}
    </div>
  );
}

import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/auth/LoginPage';
import SignupPage from './pages/auth/SignupPage';
import { BomFormPage, BomListPage } from './pages/boms/BomPages';
import { MoFormPage, MoListPage } from './pages/manufacturing/MoPages';
import ProductFormPage from './pages/products/ProductFormPage';
import ProductListPage from './pages/products/ProductListPage';
import ProfilePage from './pages/profile/ProfilePage';
import { PurchaseFormPage, PurchaseListPage } from './pages/purchase/PurchasePages';
import { SalesFormPage, SalesListPage } from './pages/sales/SalesPages';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Home() {
  const { user } = useAuth();
  return <h1 className="text-xl font-semibold">Welcome, {user?.name}</h1>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="products" element={<ProductListPage />} />
        <Route path="products/:id" element={<ProductFormPage />} />
        <Route path="sales" element={<SalesListPage />} />
        <Route path="sales/:id" element={<SalesFormPage />} />
        <Route path="purchase" element={<PurchaseListPage />} />
        <Route path="purchase/:id" element={<PurchaseFormPage />} />
        <Route path="manufacturing" element={<MoListPage />} />
        <Route path="manufacturing/:id" element={<MoFormPage />} />
        <Route path="boms" element={<BomListPage />} />
        <Route path="boms/:id" element={<BomFormPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

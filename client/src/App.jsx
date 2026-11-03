import React, { useState, useEffect, createContext } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import Dashboard from './pages/Dashboard';
import Data from './pages/Data';
import DCRReview from './pages/DCRReview';
import RefreshButton from './components/RefreshButton';


export const AuthContext = createContext(null);


// ---------------------------------------------------------------------------
// Login Gateway
// ---------------------------------------------------------------------------
function LoginView({ onLoginSuccess, sessionExpired }) {
  const [loginError, setLoginError] = useState('');


  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    prompt: 'select_account',
    onSuccess: (tokenResponse) => {
      setLoginError('');
      const expiresInMs = (tokenResponse.expires_in || 3600) * 1000 - 300000;
      const expiryTimestamp = Date.now() + expiresInMs;


      sessionStorage.setItem('dcr_access_token', tokenResponse.access_token);
      sessionStorage.setItem('dcr_token_expiry', String(expiryTimestamp));
      onLoginSuccess(tokenResponse.access_token);
    },
    onError: (err) => {
      console.error('Google Sign-in failed:', err);
      setLoginError(err.error_description || err.error || 'Failed to open Google Sign-in popup.');
    },
  });


  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ padding: '36px 40px', background: '#ffffff', color: '#202124', border: '1px solid #ddd', borderRadius: '8px', textAlign: 'center', maxWidth: '420px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
        <h2 style={{ margin: '0 0 12px 0', color: '#1a73e8' }}>DCR Tool Portal</h2>
        <p style={{ color: '#5f6368', fontSize: '14px', marginBottom: '24px', lineHeight: 1.5 }}>
          Sign in with your authorized Google account to review and manage operations.
        </p>


        {sessionExpired && !loginError && (
          <div style={{ padding: '10px 14px', background: '#fdf3f2', border: '1px solid #f5c6cb', color: '#721c24', borderRadius: '4px', marginBottom: '20px', fontSize: '13px' }}>
            Your session has expired. Please sign in again to continue.
          </div>
        )}


        {loginError && (
          <div style={{ padding: '10px 14px', background: '#fdf3f2', border: '1px solid #f5c6cb', color: '#721c24', borderRadius: '4px', marginBottom: '20px', fontSize: '13px' }}>
            {loginError}
          </div>
        )}


        <button
          onClick={() => {
            setLoginError('');
            login();
          }}
          style={{
            padding: '12px 24px',
            background: '#1a73e8',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '15px',
            fontWeight: 500,
            width: '100%',
          }}
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Top Navigation Header
// ---------------------------------------------------------------------------
function NavigationBar({ onRefresh, loading, remainingQuota, onLogout }) {
  const location = useLocation();


  const navItems = [
    { label: 'Dashboard', path: '/' },
    { label: 'Sheet Data', path: '/data' },
    { label: 'QC Inspections', path: '/qc' },
    { label: 'Pole Transfers', path: '/pole-transfers' },
  ];


  return (
    <header style={{ background: '#ffffff', borderBottom: '1px solid #dadce0', padding: '0 24px', marginBottom: '24px' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <div style={{ fontWeight: 700, fontSize: '18px', color: '#1a73e8' }}>
            OHIO | Project Tracker
          </div>


          <nav style={{ display: 'flex', gap: '8px' }}>
            {navItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '4px',
                    textDecoration: 'none',
                    fontSize: '14px',
                    fontWeight: active ? 600 : 500,
                    color: active ? '#1a73e8' : '#5f6368',
                    background: active ? '#e8f0fe' : 'transparent',
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>


        {/* Top Right Actions: Force Refresh + Sign Out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <RefreshButton onRefresh={onRefresh} loading={loading} remainingQuota={remainingQuota} />
          <button
            onClick={onLogout}
            style={{
              padding: '7px 12px',
              background: '#f1f3f4',
              border: '1px solid #dadce0',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              color: '#3c4043',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}


// ---------------------------------------------------------------------------
// App Root
// ---------------------------------------------------------------------------
export default function App() {
  const [accessToken, setAccessToken] = useState(() => {
    const token = sessionStorage.getItem('dcr_access_token');
    const expiry = Number(sessionStorage.getItem('dcr_token_expiry') || 0);
    if (token && expiry && Date.now() < expiry) {
      return token;
    }
    sessionStorage.removeItem('dcr_access_token');
    sessionStorage.removeItem('dcr_token_expiry');
    return null;
  });


  const [sessionExpired, setSessionExpired] = useState(false);
  const [tabName, setTabName] = useState('Cable Replacement');
  const [sheetData, setSheetData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [remainingQuota, setRemainingQuota] = useState(60);


  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);


  const logout = (dueToExpiry = false) => {
    sessionStorage.removeItem('dcr_access_token');
    sessionStorage.removeItem('dcr_token_expiry');
    setAccessToken(null);
    setSessionExpired(dueToExpiry);
  };


  const handleLoginSuccess = (token) => {
    setAccessToken(token);
    setSessionExpired(false);
  };

  const [refreshSignal, setRefreshSignal] = useState(0);

const fetchSheet = async (forceRefresh = false) => {
  if (!accessToken) return;
  setLoading(true);
  try {
    const isForce = forceRefresh === true;
    const url = `/api/sheet?tab=${encodeURIComponent(tabName)}${isForce ? '&refresh=true' : ''}`;
    
    console.log(`Requesting sheet data: ${url}`);
    
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });


    if (res.status === 401) {
      logout(true);
      return;
    }


    const data = await res.json();
    if (!res.ok) throw new Error(data.error);


    setSheetData(data.values || []);
  } catch (err) {
    console.error('Failed to fetch sheet:', err);
  } finally {
    setLoading(false);
  }
};

  // Unified refresh handler
const handleGlobalRefresh = (forceRefresh = true) => {
  if (location.pathname.startsWith('/dcr/')) {
    // Increment the signal to inform the active DCRReview component
    setRefreshSignal((prev) => prev + 1);
  }
  // Also refresh the background sheetData
  fetchSheet(forceRefresh);
};


  useEffect(() => {
    if (accessToken && sheetData.length === 0) {
      fetchSheet(false);
    }
  }, [accessToken, tabName]);


  const handleRecordUpdated = (sheetRowNumber, colIndex, newValue) => {
    setSheetData((prev) => {
      if (!prev || prev.length < sheetRowNumber) return prev;
      const next = prev.map((r) => [...r]);
      if (next[sheetRowNumber - 1]) {
        next[sheetRowNumber - 1][colIndex] = newValue;
      }
      return next;
    });
  };


  return (
    <AuthContext.Provider value={{ accessToken, logout, refreshSignal }}>
      <BrowserRouter>
        {!accessToken ? (
          <LoginView onLoginSuccess={handleLoginSuccess} sessionExpired={sessionExpired} />
        ) : (
          <div style={{ minHeight: '100vh', background: '#f8f9fa', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            <NavigationBar
              onRefresh={handleGlobalRefresh}
              loading={loading}
              onLogout={() => logout(false)}
            />


            <main style={{ padding: '0 24px 40px 24px' }}>
              <Routes>
                <Route
                  path="/"
                  element={
                    <Dashboard
                      sheetData={sheetData}
                      onRefresh={fetchSheet}
                      loading={loading}
                      accessToken={accessToken}
                      onStatusUpdated={handleRecordUpdated}
                    />
                  }
                />
                <Route
                  path="/data"
                  element={
                    <Data
                      tabName={tabName}
                      setTabName={setTabName}
                      sheetData={sheetData}
                      setSheetData={setSheetData}
                      searchQuery={searchQuery}
                      setSearchQuery={setSearchQuery}
                      page={page}
                      setPage={setPage}
                      pageSize={pageSize}
                      setPageSize={setPageSize}
                      fetchSheet={fetchSheet}
                      loading={loading}
                    />
                  }
                />
                <Route
                  path="/dcr/:dcrId"
                  element={<DCRReview onRecordUpdated={handleRecordUpdated} />}
                />
                <Route
                  path="/qc"
                  element={
                    <div style={{ maxWidth: '1280px', margin: '0 auto', background: '#fff', padding: '32px', borderRadius: '8px', border: '1px solid #ddd' }}>
                      <h3>QC Inspections</h3>
                      <p style={{ color: '#666' }}>Module coming soon. Use the "Sheet Data" tab and switch to "QC Responses" to review raw inspection submissions.</p>
                    </div>
                  }
                />
                <Route
                  path="/pole-transfers"
                  element={
                    <div style={{ maxWidth: '1280px', margin: '0 auto', background: '#fff', padding: '32px', borderRadius: '8px', border: '1px solid #ddd' }}>
                      <h3>Pole Transfers</h3>
                      <p style={{ color: '#666' }}>Module coming soon. Use the "Sheet Data" tab and switch to "Pole Transfers Form" to review records.</p>
                    </div>
                  }
                />
              </Routes>
            </main>
          </div>
        )}
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
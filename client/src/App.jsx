import React, { useState, useEffect, createContext } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import Dashboard from './pages/Dashboard';
import Data from './pages/Data';
import DCRReview from './pages/DCRReview';
import RefreshButton from './components/RefreshButton';
import { ToastProvider, useToast } from './context/ToastContext';


export const AuthContext = createContext(null);

const DEFAULT_DROPDOWN_OPTIONS = {
  Z: ['Approved', 'Denied'],
  AE: [
    'Dante Hawkins',
    'David Firewick',
    'Jason Jones',
    'James Naumann',
    'Larry Burruel',
    'Jose Diaz',
    'Roy Ray',
    'Steve McGraw',
    'Jeremy Borreson',
  ],
  AG: [
    'Pre Construction',
    'Permitting in Process',
    'Under Construction',
    'Maintenance Tie',
    'Completed',
    'Canceled',
  ],
  AL: ['Yes', 'No'],
};


// Login View
function LoginView({ onLoginSuccess, sessionExpired }) {
  const [loginError, setLoginError] = useState('');


  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',
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


// Navigation Bar
function NavigationBar({ onRefresh, loading, onLogout, theme, onToggleTheme }) {
  const location = useLocation();


  const navItems = [
    { label: 'Dashboard', path: '/' },
    { label: 'Sheet Data', path: '/data' },
    { label: 'QC Inspections', path: '/qc' },
    { label: 'Pole Transfers', path: '/pole-transfers' },
  ];


  return (
    <header style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', padding: '0 24px', marginBottom: '24px' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <div style={{ fontWeight: 700, fontSize: '18px', color: 'var(--btn-primary-bg)' }}>
            OHIO | F27 Tracking
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
    borderRadius: '6px',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--btn-primary-bg)' : 'var(--text-muted)',
    background: active ? 'var(--bg-card-subtle)' : 'transparent',
  }}
>
  {item.label}
</Link>
              );
            })}
          </nav>
        </div>


        {/* Top Right Action Cluster */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Theme Toggle Button */}
          <button
            onClick={onToggleTheme}
            className="btn-secondary"
            style={{ padding: '7px 12px', fontSize: '15px' }}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          >
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>


          <RefreshButton onRefresh={onRefresh} loading={loading} />


          <button
            onClick={onLogout}
            className="btn-secondary"
            style={{ padding: '7px 14px' }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}


// Inner App with Global Routing
function AppContent() {
  const { showToast } = useToast();
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
  const [refreshSignal, setRefreshSignal] = useState(0);


  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // dropdowns in data val (cable replacment sheet)
const [dropdownOptions, setDropdownOptions] = useState(DEFAULT_DROPDOWN_OPTIONS);

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


const fetchSheet = async (forceRefresh = false) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const url = `/api/sheet?tab=${encodeURIComponent(tabName)}${forceRefresh ? '&refresh=true' : ''}`;
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
      // Overwrite with live dynamic options from Data Val (Cable Replacement)
      if (data.dropdownOptions) {
        setDropdownOptions(data.dropdownOptions);
      }
    } catch (err) {
      showToast(`Failed to load sheet: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    if (accessToken && sheetData.length === 0) {
      fetchSheet(false);
    }
  }, [accessToken, tabName]);


const handleGlobalRefresh = (forceRefresh = true) => {
    if (window.location.pathname.startsWith('/dcr/')) {
      // On DCR page: only signal DCRReview to refresh (which will update the server cache)
      setRefreshSignal((prev) => prev + 1);
    } else {
      // On Dashboard or Sheet Data: refresh the main table data
      fetchSheet(forceRefresh);
    }
  };

  const handleStatusUpdated = (sheetRowNumber, colIndex, newValue) => {
  setSheetData((prevData) => {
    if (!prevData || prevData.length <= sheetRowNumber - 1) return prevData;
    const updated = prevData.map((row) => [...row]);
    if (updated[sheetRowNumber - 1]) {
      updated[sheetRowNumber - 1][colIndex] = newValue;
    }
    return updated;
  });
};

const handleRecordUpdated = (sheetRowNumber, colIndex, newValue) => {
  handleStatusUpdated(sheetRowNumber, colIndex, newValue);
};

  // Manage Theme State
const [theme, setTheme] = useState(() => {
  return localStorage.getItem('dcr_theme') || 'light';
});


useEffect(() => {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('dcr_theme', theme);
}, [theme]);


const toggleTheme = () => {
  setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
};


  return (
    <AuthContext.Provider value={{ accessToken, logout, refreshSignal }}>
      <BrowserRouter>
        {!accessToken ? (
          <LoginView onLoginSuccess={handleLoginSuccess} sessionExpired={sessionExpired} />
        ) : (
          <div style={{ minHeight: '100vh', background: 'var(--bg-page)', color: 'var(--text-main)' }}>
            <NavigationBar
              onRefresh={handleGlobalRefresh}
              loading={loading}
              onLogout={() => logout(false)}
              theme={theme}
              onToggleTheme={toggleTheme}
            />


            <main style={{ padding: '0 24px 40px 24px' }}>
              <Routes>
                <Route
                  path="/"
                  element={
                    <Dashboard
                      sheetData={sheetData}
                      onRefresh={handleGlobalRefresh}
        loading={loading}
        accessToken={accessToken}
        onStatusUpdated={handleStatusUpdated}
        dropdownOptions={dropdownOptions}
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
                  element={<DCRReview onRecordUpdated={handleRecordUpdated}
        dropdownOptions={dropdownOptions} />}
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


export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
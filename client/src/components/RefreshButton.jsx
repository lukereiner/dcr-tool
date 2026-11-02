export default function RefreshButton({ onRefresh, loading }) {
  return (
    <button
      onClick={() => onRefresh(true)} // Explicitly pass boolean true
      disabled={loading}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '7px 14px',
        background: loading ? '#f1f3f4' : '#ffffff',
        color: loading ? '#9aa0a6' : '#1a73e8',
        border: '1px solid #dadce0',
        borderRadius: '6px',
        cursor: loading ? 'not-allowed' : 'pointer',
        fontSize: '13px',
        fontWeight: 500,
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
      }}
      title="Bypass server cache and fetch latest updates directly from Google Sheets"
    >
      <span style={{ fontSize: '14px', display: 'inline-block', transform: loading ? 'rotate(180deg)' : 'none', transition: 'transform 0.5s ease' }}>
        🔄
      </span>
      <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
    </button>
  );
}
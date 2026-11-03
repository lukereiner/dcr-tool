export default function RefreshButton({ onRefresh, loading }) {
  return (
    <button
      onClick={() => onRefresh(true)}
      disabled={loading}
      className="btn-secondary"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '7px 14px',
      }}
      title="Bypass server cache and fetch latest updates directly from Google Sheets"
    >
      <span style={{ fontSize: '13px', display: 'inline-block', transform: loading ? 'rotate(180deg)' : 'none', transition: 'transform 0.5s ease' }}>
        🔄
      </span>
      <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
    </button>
  );
}
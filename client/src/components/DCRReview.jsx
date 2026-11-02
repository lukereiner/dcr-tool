import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function DCRReview({ accessToken }) {
  const { dcrId } = useParams();
  const navigate = useNavigate();

  const [dcrData, setDcrData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [formValues, setFormValues] = useState({});
  const [savingField, setSavingField] = useState(null);

  useEffect(() => {
    if (!accessToken) {
      setStatusMessage('Please authenticate on the main page first.');
      setLoading(false);
      return;
    }

    const loadDcr = async () => {
      setLoading(true);
      setStatusMessage(`Loading DCR #${dcrId}...`);
      try {
        const res = await fetch(`/api/dcr/${encodeURIComponent(dcrId)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setDcrData(data);
        // Pre-fill editable input states
        const initialInputs = {};
        data.fields.forEach((f) => {
          initialInputs[f.colLetter] = f.value;
        });
        setFormValues(initialInputs);
        setStatusMessage('');
      } catch (err) {
        setStatusMessage(`Error: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    loadDcr();
  }, [dcrId, accessToken]);

  const handleSaveField = async (colLetter, colHeader) => {
    if (!dcrData) return;
    const cellA1 = `${colLetter}${dcrData.sheetRowNumber}`;
    const value = formValues[colLetter] ?? '';
    setSavingField(colLetter);
    setStatusMessage(`Saving ${colHeader} (${cellA1})...`);

    try {
      const res = await fetch('/api/sheet/cell', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          tabName: 'Cable Replacement',
          cell: cellA1,
          value,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      setStatusMessage(`Saved ${colHeader} successfully!`);
    } catch (err) {
      setStatusMessage(`Save failed: ${err.message}`);
    } finally {
      setSavingField(null);
    }
  };

  if (!accessToken) {
    return (
      <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
        <button onClick={() => navigate('/')} style={{ padding: '8px 16px', cursor: 'pointer' }}>
          ← Back to Main Table
        </button>
        <p style={{ marginTop: '20px', color: '#c00' }}>
          You must be logged into Google on the main dashboard to view this review page.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>Loading DCR details...</div>;
  }

  if (!dcrData) {
    return (
      <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
        <button onClick={() => navigate('/')} style={{ padding: '8px 16px', cursor: 'pointer' }}>
          ← Back to Table
        </button>
        <p style={{ marginTop: '20px', color: '#c00' }}>{statusMessage || 'DCR not found.'}</p>
      </div>
    );
  }

  // Split fields into Manager Sign-Offs (A-B), Specs (C-Y), and Additional Actions (Z+)
  const managerSignOffs = dcrData.fields.filter((f) => f.colIndex < 2);
  const readOnlySpecs = dcrData.fields.filter((f) => f.isReadOnly);
  const postSpecsFields = dcrData.fields.filter((f) => f.colIndex > 24);

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Top Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <button
          onClick={() => navigate('/')}
          style={{ padding: '8px 16px', background: '#f1f3f4', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
        >
          ← Back to All Records
        </button>
        <span style={{ fontSize: '12px', color: '#666' }}>Sheet Row #{dcrData.sheetRowNumber}</span>
      </div>

      {/* Header Banner */}
      <div style={{ background: '#1a73e8', color: '#fff', padding: '16px 20px', borderRadius: '8px', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>DCR Review: {dcrId}</h1>
        <p style={{ margin: '4px 0 0 0', opacity: 0.9, fontSize: '14px' }}>
          Cable Replacement Source of Truth Review & Manager Action Portal
        </p>
      </div>

      {statusMessage && (
        <div style={{ padding: '10px 16px', background: '#f8f9fa', borderLeft: '4px solid #1a73e8', marginBottom: '20px', fontSize: '14px' }}>
          {statusMessage}
        </div>
      )}

      {/* Zone 1: Manager Sign-offs (Columns A & B) */}
      <div style={{ background: '#fff', border: '1px solid #d2e3fc', borderRadius: '8px', padding: '16px 20px', marginBottom: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <h3 style={{ margin: '0 0 12px 0', color: '#1967d2', fontSize: '16px' }}>Manager Approval & Sign-Off (Cols A & B)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {managerSignOffs.map((f) => (
            <div key={f.colLetter} style={{ background: '#f8fafd', padding: '12px', borderRadius: '6px', border: '1px solid #e8f0fe' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>
                {f.header} ({f.colLetter})
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={formValues[f.colLetter] ?? ''}
                  onChange={(e) => setFormValues({ ...formValues, [f.colLetter]: e.target.value })}
                  style={{ flex: 1, padding: '6px 10px', borderRadius: '4px', border: '1px solid #ccc' }}
                />
                <button
                  onClick={() => handleSaveField(f.colLetter, f.header)}
                  disabled={savingField === f.colLetter}
                  style={{ padding: '6px 14px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                  {savingField === f.colLetter ? '...' : 'Save'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Zone 2: Read-Only DCR Form Specs (Columns C through Y) */}
      <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px 20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '16px' }}>Locked DCR Form Data (Cols C through Y)</h3>
          <span style={{ fontSize: '11px', background: '#eee', padding: '3px 8px', borderRadius: '12px', color: '#555' }}>
            🔒 Protected Source of Truth
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
          {readOnlySpecs.map((f) => (
            <div key={f.colLetter} style={{ background: '#fafafa', border: '1px solid #eee', padding: '10px', borderRadius: '6px' }}>
              <div style={{ fontSize: '11px', color: '#777', textTransform: 'uppercase', marginBottom: '4px' }}>
                {f.header} ({f.colLetter})
              </div>
              <div style={{ fontSize: '14px', fontWeight: 500, wordBreak: 'break-word', color: f.value ? '#222' : '#999' }}>
                {f.value || '—'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Zone 3: Post-Spec Processing Fields (Column Z onward) */}
      {postSpecsFields.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px 20px' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Downstream Processing & Workday Tracking (Col Z+)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {postSpecsFields.map((f) => (
              <div key={f.colLetter} style={{ background: '#fafafa', padding: '12px', borderRadius: '6px', border: '1px solid #eee' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>
                  {f.header} ({f.colLetter})
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={formValues[f.colLetter] ?? ''}
                    onChange={(e) => setFormValues({ ...formValues, [f.colLetter]: e.target.value })}
                    style={{ flex: 1, padding: '6px 10px', borderRadius: '4px', border: '1px solid #ccc' }}
                  />
                  <button
                    onClick={() => handleSaveField(f.colLetter, f.header)}
                    disabled={savingField === f.colLetter}
                    style={{ padding: '6px 14px', background: '#34a853', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    {savingField === f.colLetter ? '...' : 'Save'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
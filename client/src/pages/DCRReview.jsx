import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { useToast } from '../context/ToastContext';


function extractDriveFolderId(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/folders\/([a-zA-Z0-9_-]{25,})/);
  return match ? match[1] : null;
}


// Inline Spinner icon component
function ButtonSpinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '14px',
        height: '14px',
        border: '2px solid rgba(255, 255, 255, 0.4)',
        borderTop: '2px solid #ffffff',
        borderRadius: '50%',
        animation: 'btnSpin 0.7s linear infinite',
      }}
    />
  );
}


export default function DCRReview({ onRecordUpdated }) {
  const { dcrId } = useParams();
  const navigate = useNavigate();
  const { accessToken, logout, refreshSignal } = useContext(AuthContext);
  const { showToast } = useToast();


  const [dcrData, setDcrData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formValues, setFormValues] = useState({});
  const [savingField, setSavingField] = useState(null);


  // Gallery & Carousel states
  const [photos, setPhotos] = useState([]);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [folderUrl, setFolderUrl] = useState('');


  const loadDcr = async (force = false) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const url = `/api/dcr/${encodeURIComponent(dcrId)}${force ? '?refresh=true' : ''}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });


      if (res.status === 401) {
        logout(true);
        return;
      }


      const data = await res.json();
      if (!res.ok) throw new Error(data.error);


      setDcrData(data);
      const initialInputs = {};
      data.fields.forEach((f) => {
        initialInputs[f.colLetter] = f.value;
      });
      setFormValues(initialInputs);


      if (force) {
        showToast(`DCR #${dcrId} refreshed directly from Google Sheets`, 'success');
      }


      const folderField = data.fields.find(
        (f) => [20, 21, 22].includes(f.colIndex) && f.value && f.value.includes('drive.google.com')
      );


      if (folderField) {
        setFolderUrl(folderField.value);
        const folderId = extractDriveFolderId(folderField.value);
        if (folderId) {
          fetchFolderPhotos(folderId);
        }
      } else {
        setPhotos([]);
        setFolderUrl('');
      }
    } catch (err) {
      showToast(`Failed to load DCR: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };


  const fetchFolderPhotos = async (folderId) => {
    setPhotosLoading(true);
    try {
      const res = await fetch(`/api/drive/folder/${folderId}/images`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (res.ok && data.files) {
        setPhotos(data.files);
        setActivePhotoIndex(0);
      }
    } catch (err) {
      console.error('Failed to load folder images:', err);
    } finally {
      setPhotosLoading(false);
    }
  };


// Track the refresh signal so it only triggers on manual clicks, never on page mount
  const lastSignalRef = React.useRef(refreshSignal);


  // Normal navigation load (reads from cache, 0 Google API calls if cached)
  useEffect(() => {
    loadDcr(false);
  }, [dcrId, accessToken]);


  // Only force-refresh if the user clicks the Refresh button while this page is active
  useEffect(() => {
    if (refreshSignal > lastSignalRef.current) {
      lastSignalRef.current = refreshSignal;
      loadDcr(true);
    }
  }, [refreshSignal]);


  const handleSaveField = async (colLetter, colHeader, colIndex) => {
    if (!dcrData) return;
    const value = formValues[colLetter] ?? '';
    setSavingField(colLetter);


    try {
      const res = await fetch(`/api/dcr/${encodeURIComponent(dcrId)}/cell`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ colLetter, value }),
      });


      if (res.status === 401) {
        logout(true);
        return;
      }


      const result = await res.json();
      if (!res.ok) throw new Error(result.error);


      showToast(`Saved ${colHeader} (${result.cell}) successfully!`, 'success');
      if (onRecordUpdated) {
        onRecordUpdated(dcrData.sheetRowNumber, colIndex, value);
      }
    } catch (err) {
      showToast(`Failed to save ${colHeader}: ${err.message}`, 'error');
    } finally {
      setSavingField(null);
    }
  };


  if (loading) {
    return (
      <div style={{ padding: '30px', fontFamily: 'system-ui, sans-serif' }}>
        <h2>Loading DCR #{dcrId}...</h2>
      </div>
    );
  }


  if (!dcrData) {
    return (
      <div style={{ padding: '30px', fontFamily: 'system-ui, sans-serif' }}>
        <button onClick={() => navigate('/')} style={{ padding: '8px 16px', cursor: 'pointer', marginBottom: '16px' }}>
          ← Back to All Records
        </button>
        <p style={{ color: '#c00' }}>DCR record "{dcrId}" could not be found.</p>
      </div>
    );
  }


  const managerSignOffs = dcrData.fields.filter((f) => f.colIndex < 2);
  const readOnlySpecs = dcrData.fields.filter(
    (f) => f.isReadOnly && ![20, 21, 22].includes(f.colIndex)
  );
  const postSpecsFields = dcrData.fields.filter((f) => f.colIndex > 24);
  const activePhoto = photos[activePhotoIndex];


  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <style>{`
        @keyframes btnSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>


      {/* Top Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <button
          onClick={() => navigate('/')}
          style={{ padding: '8px 16px', background: '#f1f3f4', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}
        >
          ← Back to All Records
        </button>
        <span style={{ fontSize: '13px', color: '#666' }}>Sheet Row #{dcrData.sheetRowNumber}</span>
      </div>


      {/* Header Banner */}
      <div style={{ background: '#1a73e8', color: '#fff', padding: '16px 20px', borderRadius: '8px', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>{dcrId}</h1>
        <p style={{ margin: '4px 0 0 0', opacity: 0.9, fontSize: '14px' }}>
          * can put other info that is useful here *
        </p>
      </div>


      {/* Section 1: Manager Sign-offs (Columns A & B) */}
      <div style={{ background: '#fff', border: '1px solid #d2e3fc', borderRadius: '8px', padding: '16px 20px', marginBottom: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <h3 style={{ margin: '0 0 12px 0', color: '#1967d2', fontSize: '16px' }}>Manager Approval & Sign-Off (Cols A & B)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {managerSignOffs.map((f) => {
            const isSaving = savingField === f.colLetter;
            return (
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
                    onClick={() => handleSaveField(f.colLetter, f.header, f.colIndex)}
                    disabled={isSaving}
                    style={{
                      minWidth: '72px',
                      padding: '6px 14px',
                      background: '#1a73e8',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: isSaving ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isSaving ? <ButtonSpinner /> : 'Save'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>


      {/* Section 2: Locked Form Specs */}
      <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px 20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '16px' }}>Locked DCR Form Data (Cols C through Y)</h3>
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


      {/* Section 3: Dedicated Inspection Photo Carousel */}
      <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '20px', marginBottom: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', color: '#202124' }}>Inspection Photos (Cols U, V, W)</h3>
            <span style={{ fontSize: '12px', color: '#666' }}>
              {photos.length > 0 ? `${photos.length} photos loaded from submitted folder` : 'Drive Folder Inspection Gallery'}
            </span>
          </div>


          {folderUrl && (
            <a
              href={folderUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                background: '#e8f0fe',
                color: '#1a73e8',
                borderRadius: '16px',
                border: '1px solid #1a73e8',
                textDecoration: 'none',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              📁 Open Folder in Google Drive ↗
            </a>
          )}
        </div>


        {photosLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#666', background: '#fafafa', borderRadius: '6px' }}>
            Scanning Drive folder for inspection photos...
          </div>
        ) : photos.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: '#888', background: '#fafafa', borderRadius: '6px' }}>
            {folderUrl ? 'No image files detected in this folder link.' : 'No photo folder attached to this DCR.'}
          </div>
        ) : (
          <div>
            <div
              style={{
                position: 'relative',
                background: '#111',
                borderRadius: '8px',
                height: '460px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              <button
                onClick={() => setActivePhotoIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1))}
                style={{
                  position: 'absolute',
                  left: '16px',
                  zIndex: 2,
                  background: 'rgba(0,0,0,0.5)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '50%',
                  width: '40px',
                  height: '40px',
                  cursor: 'pointer',
                  fontSize: '18px',
                }}
              >
                ◀
              </button>


              <img
                src={`/api/drive/file/${activePhoto.id}?token=${encodeURIComponent(accessToken)}`}
                alt={activePhoto.name}
                onClick={() => setLightboxOpen(true)}
                style={{
                  maxHeight: '100%',
                  maxWidth: '100%',
                  objectFit: 'contain',
                  cursor: 'zoom-in',
                }}
                title="Click to view full screen"
              />


              <button
                onClick={() => setActivePhotoIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0))}
                style={{
                  position: 'absolute',
                  right: '16px',
                  zIndex: 2,
                  background: 'rgba(0,0,0,0.5)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '50%',
                  width: '40px',
                  height: '40px',
                  cursor: 'pointer',
                  fontSize: '18px',
                }}
              >
                ▶
              </button>


              <div
                style={{
                  position: 'absolute',
                  bottom: '12px',
                  background: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  padding: '4px 14px',
                  borderRadius: '16px',
                  fontSize: '12px',
                  zIndex: 2,
                  pointerEvents: 'none',
                }}
              >
                {activePhoto.name} ({activePhotoIndex + 1} of {photos.length})
              </div>
            </div>


            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', marginTop: '12px', paddingBottom: '6px' }}>
              {photos.map((photo, idx) => (
                <div
                  key={photo.id}
                  onClick={() => setActivePhotoIndex(idx)}
                  style={{
                    flexShrink: 0,
                    width: '80px',
                    height: '60px',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    border: idx === activePhotoIndex ? '2px solid #1a73e8' : '1px solid #ddd',
                    opacity: idx === activePhotoIndex ? 1 : 0.65,
                  }}
                >
                  <img
                    src={`/api/drive/file/${photo.id}?token=${encodeURIComponent(accessToken)}`}
                    alt={photo.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>


      {/* Section 4: Post-Spec Processing Fields (Column Z onward) */}
      {postSpecsFields.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '16px 20px' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Downstream Processing & Workday Tracking (Col Z+)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {postSpecsFields.map((f) => {
              const isSaving = savingField === f.colLetter;
              return (
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
                      onClick={() => handleSaveField(f.colLetter, f.header, f.colIndex)}
                      disabled={isSaving}
                      style={{
                        minWidth: '72px',
                        padding: '6px 14px',
                        background: '#34a853',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isSaving ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {isSaving ? <ButtonSpinner /> : 'Save'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}


      {/* Fullscreen Lightbox Modal */}
      {lightboxOpen && activePhoto && (
        <div
          onClick={() => setLightboxOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: '20px',
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', maxWidth: '95vw', maxHeight: '95vh', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <a
                href={activePhoto.webViewLink || `https://drive.google.com/file/d/${activePhoto.id}/view`}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#fff', textDecoration: 'underline', fontSize: '14px', fontWeight: 500 }}
              >
                Open Original in Drive ↗
              </a>
              <button
                onClick={() => setLightboxOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '24px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <img
              src={`/api/drive/file/${activePhoto.id}?token=${encodeURIComponent(accessToken)}`}
              alt={activePhoto.name}
              style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain', borderRadius: '4px' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
import { createContext, useContext, useState, useCallback } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = "success") => {
    const id = Date.now() + Math.random().toString(36).substring(2, 9);
    const duration = type === "error" ? 8000 : 5000;

    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Fixed top-right stacking container */}
      <div
        style={{
          position: "fixed",
          top: "20px",
          right: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          zIndex: 999999,
          pointerEvents: "none",
          maxWidth: "380px",
          width: "calc(100vw - 40px)",
        }}
      >
        {toasts.map((toast) => {
          const isSuccess = toast.type === "success";
          return (
            <div
              key={toast.id}
              style={{
                pointerEvents: "auto",
                padding: "12px 18px",
                borderRadius: "8px",
                backgroundColor: "#ffffff",
                color: isSuccess ? "#0f5132" : "#842029",
                border: isSuccess
                  ? "1.5px solid #28a745"
                  : "1.5px solid #dc3545",
                boxShadow: "0 6px 18px rgba(0, 0, 0, 0.12)",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontSize: "13px",
                fontWeight: 500,
                lineHeight: 1.4,
                animation: "toastFadeIn 0.25s ease-out",
              }}
            >
              <span style={{ fontSize: "16px", flexShrink: 0 }}>
                {isSuccess ? "✅" : "⚠️"}
              </span>
              <span style={{ wordBreak: "break-word" }}>{toast.message}</span>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes toastFadeIn {
          from {
            opacity: 0;
            transform: translateY(-8px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

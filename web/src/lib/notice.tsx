import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Kind = "success" | "error";
interface Notice {
  id: number;
  text: string;
  kind: Kind;
}

const NoticeContext = createContext<(text: string, kind?: Kind) => void>(() => {});

export function useNotice() {
  return useContext(NoticeContext);
}

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);

  const notify = useCallback((text: string, kind: Kind = "success") => {
    const id = nextId.current++;
    setNotices((n) => [...n, { id, text, kind }]);
    setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), kind === "error" ? 8000 : 4000);
  }, []);

  return (
    <NoticeContext.Provider value={notify}>
      {children}
      <div className="fixed top-[calc(env(safe-area-inset-top)+4rem)] right-4 left-4 z-50 flex flex-col items-stretch gap-2 sm:top-auto sm:bottom-4 sm:left-auto sm:max-w-sm sm:items-end" role="status">
        {notices.map((n) => (
          <div
            key={n.id}
            className={`flex items-center gap-2.5 rounded-xl bg-raised px-4 py-3 text-sm font-semibold text-ink shadow-xl shadow-black/40 ring-1 ${
              n.kind === "error" ? "ring-rose/50" : "ring-mint/40"
            }`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${n.kind === "error" ? "bg-rose" : "bg-mint"}`} />
            {n.text}
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  );
}

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
      <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2" role="status">
        {notices.map((n) => (
          <div
            key={n.id}
            className={`rounded-lg px-4 py-3 text-sm shadow-lg ${
              n.kind === "error" ? "bg-red-600 text-white" : "bg-zinc-900 text-white"
            }`}
          >
            {n.text}
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  );
}

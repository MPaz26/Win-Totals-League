import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isIos, isStandalone } from "../lib/push";
import { Button } from "./ui";

// Chrome and Edge (Android, desktop) fire beforeinstallprompt early, and only once.
// Holding on to it lets the guide offer a one-tap Install instead of menu directions.
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e as InstallPromptEvent;
  listeners.forEach((l) => l());
});
window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  listeners.forEach((l) => l());
});
function useInstallPrompt() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => deferredPrompt,
  );
}

/** "Get the app" button plus the dialog it opens. Renders nothing once running as the installed app. */
export function InstallButton({ variant = "secondary", label = "Get the app", className }: {
  variant?: "secondary" | "ghost" | "primary";
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (isStandalone()) return null;
  return (
    <>
      <Button variant={variant} size="sm" className={className} onClick={() => setOpen(true)}>
        <PhoneIcon />
        {label}
      </Button>
      {open && <InstallGuide onClose={() => setOpen(false)} />}
    </>
  );
}

function InstallGuide({ onClose }: { onClose: () => void }) {
  const prompt = useInstallPrompt();
  const ios = isIos();
  const android = /android/i.test(navigator.userAgent);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    deferredPrompt = null;
    listeners.forEach((l) => l());
    onClose();
  }

  // Portal to <body>: the header's backdrop-blur makes it the containing block for
  // fixed descendants, which would trap the overlay inside the header.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
        className="w-full max-w-md rounded-t-3xl bg-panel p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] ring-1 ring-line sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}apple-touch-icon.png`} alt="" className="h-12 w-12 rounded-xl" />
          <div className="min-w-0 flex-1">
            <h2 id="install-title" className="font-extrabold">Add Win Totals to your Home Screen</h2>
            <p className="text-xs text-mute">Opens full screen, and lets you get notifications when you're on the clock.</p>
          </div>
        </div>

        {prompt ? (
          <Button className="w-full" onClick={install}>Install app</Button>
        ) : ios ? (
          <Steps>
            <Step n={1}>
              In Safari, tap <b>Share</b> <ShareIcon /> in the toolbar. (In Chrome, it's at the top right.)
            </Step>
            <Step n={2}>Scroll down and tap <b>Add to Home Screen</b>.</Step>
            <Step n={3}>Tap <b>Add</b>, then open <b>Win Totals</b> from your Home Screen.</Step>
            <Step n={4}>To get notifications, open your profile in the app and turn them on.</Step>
          </Steps>
        ) : android ? (
          <Steps>
            <Step n={1}>Open the browser menu <b>⋮</b>.</Step>
            <Step n={2}>Tap <b>Install app</b> or <b>Add to Home screen</b>.</Step>
            <Step n={3}>Open <b>Win Totals</b> from your Home screen.</Step>
          </Steps>
        ) : (
          <Steps>
            <Step n={1}>On your phone, open this site and tap <b>Get the app</b> for steps.</Step>
            <Step n={2}>On this computer: in Chrome or Edge, click the install icon at the right of the address bar. In Safari on a Mac, choose <b>File → Add to Dock</b>.</Step>
          </Steps>
        )}

        <Button variant="ghost" className="mt-3 w-full" onClick={onClose}>Close</Button>
      </div>
    </div>,
    document.body,
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="space-y-3">{children}</ol>;
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3 text-sm">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mint/15 text-xs font-extrabold text-mint">{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mx-0.5 inline h-4 w-4 align-[-2px] text-sky-400" fill="none" stroke="currentColor" strokeWidth={2} aria-label="Share icon">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

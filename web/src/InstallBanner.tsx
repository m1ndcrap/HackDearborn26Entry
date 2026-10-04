import { useState } from "react";
import { useInstall } from "./useInstall";

const KEY = "apothecary:install-banner-dismissed";

/** One-time nudge to install the app. iPhone has no install button, so we show the Share-sheet steps. */
export default function InstallBanner() {
  const pwa = useInstall();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed || pwa.installed || (!pwa.showIOSHint && !pwa.canInstall)) return null;

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode */
    }
  };

  return (
    <div className="install-banner no-print" role="region" aria-label="Install the app">
      <div className="install-text">
        <strong>Add Pocket Apothecary to your home screen</strong>
        {pwa.showIOSHint ? (
          <p>
            Tap the <span className="share-icon" aria-label="Share">Share</span> button at the bottom of Safari, scroll down, then tap{" "}
            <strong>Add to Home Screen</strong>. It opens like a regular app and works offline.
          </p>
        ) : (
          <p>It opens like a regular app and works offline.</p>
        )}
      </div>
      <div className="install-actions">
        {pwa.canInstall && (
          <button className="primary" onClick={() => pwa.install().then(close)}>
            Install
          </button>
        )}
        <button className="ghost" onClick={close}>
          {pwa.showIOSHint ? "Got it" : "Not now"}
        </button>
      </div>
    </div>
  );
}
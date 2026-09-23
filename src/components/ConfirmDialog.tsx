import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";

interface Request {
  title: string;
  message: string;
  action: string;
  resolve: (ok: boolean) => void;
}

/**
 * An in-app replacement for window.confirm, which can't be styled or animated. Render `dialog`
 * and await `ask(...)`.
 */
export function useConfirm(): [dialog: ReactNode, ask: (title: string, message: string, action: string) => Promise<boolean>] {
  const [request, setRequest] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);

  const ask = (title: string, message: string, action: string) =>
    new Promise<boolean>((resolve) => {
      setRequest({ title, message, action, resolve });
      setOpen(true);
    });

  const answer = (ok: boolean) => {
    request?.resolve(ok);
    setOpen(false);
  };

  const dialog = request && (
    <Modal variant="dialog" open={open} onClose={() => answer(false)} onExited={() => setRequest(null)} title={request.title}>
      <div className="form">
        <p className="muted">{request.message}</p>
        <div className="form__actions">
          <button type="button" className="button--secondary" onClick={() => answer(false)}>
            Cancel
          </button>
          <button type="button" className="button--danger-solid" onClick={() => answer(true)}>
            {request.action}
          </button>
        </div>
      </div>
    </Modal>
  );
  return [dialog, ask];
}

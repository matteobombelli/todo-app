import { useState, type ReactNode } from "react";
import { Modal, useModal } from "./Modal";
import { DatePanel } from "./Pickers";

type OnPick = (date: string) => void;

/**
 * A date chosen from code (a menu entry) rather than from a visible field: a sheet with shortcuts, a
 * field to type a date and a month grid. Render `node` somewhere on the page, then call
 * `pick(initial, onPick)`; `onPick` runs only when a day is chosen.
 */
export function useDatePicker(): [node: ReactNode, pick: (initial: string, onPick: OnPick) => void] {
  const [picking, setPicking] = useState<{ initial: string; onPick: OnPick; key: number } | null>(null);
  const pick = (initial: string, onPick: OnPick) => setPicking({ initial, onPick, key: Date.now() });
  const node = picking && (
    <DateSheet key={picking.key} initial={picking.initial} onPick={picking.onPick} onClose={() => setPicking(null)} />
  );
  return [node, pick];
}

function DateSheet({ initial, onPick, onClose }: { initial: string; onPick: OnPick; onClose: () => void }) {
  const [modal, close] = useModal(onClose);
  return (
    <Modal {...modal} variant="dialog" title="Choose Date">
      <DatePanel
        value={initial}
        focus="grid"
        onPick={(date) => {
          close();
          onPick(date);
        }}
      />
    </Modal>
  );
}

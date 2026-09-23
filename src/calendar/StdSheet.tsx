import { ExternalLink } from "lucide-react";
import type { ExternalEvent } from "../../shared/agenda";
import { Modal } from "../components/Modal";
import { formatLongDate, formatTime } from "../format";
import { STD_APP_URL } from "./data";

const STATUS_LABELS = { proposed: "Proposed", upcoming: "Upcoming", saved: "Saved" } as const;

export function StdSheet({ event, onClose }: { event: ExternalEvent; onClose: () => void }) {
  const dates =
    event.start_date === event.end_date
      ? formatLongDate(event.start_date)
      : `${formatLongDate(event.start_date)} to ${formatLongDate(event.end_date)}`;
  return (
    <Modal open onClose={onClose} title={event.title}>
      <dl className="details">
        <dt>When</dt>
        <dd>
          {dates}
          {event.start_time && `, ${formatTime(event.start_time)}`}
        </dd>
        <dt>Status</dt>
        <dd>
          <span className={`chip chip--std chip--${event.status}`}>{STATUS_LABELS[event.status]}</span>
        </dd>
        {event.location && (
          <>
            <dt>Where</dt>
            <dd>{event.location}</dd>
          </>
        )}
      </dl>
      <p className="muted">From Save the Date. Edit it there.</p>
      <div className="form__actions">
        <a className="button-link" href={STD_APP_URL} target="_blank" rel="noreferrer">
          Open Save the Date
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      </div>
    </Modal>
  );
}

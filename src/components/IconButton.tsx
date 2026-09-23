import type { LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { Link } from "react-router";

export interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Renders a router link instead of a button. */
  to?: string;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  ariaHasPopup?: "menu" | "dialog";
  ariaExpanded?: boolean;
}

export function IconButton({ icon: Icon, label, onClick, to, danger, active, disabled, className, type = "button", ariaHasPopup, ariaExpanded }: IconButtonProps) {
  const classes = ["icon-btn", danger && "icon-btn--danger", active && "icon-btn--active", className]
    .filter(Boolean)
    .join(" ");
  const icon = <Icon size={18} strokeWidth={1.75} aria-hidden="true" />;
  if (to) {
    return (
      <Link to={to} className={classes} aria-label={label}>
        {icon}
      </Link>
    );
  }
  return (
    <button
      type={type}
      className={classes}
      aria-label={label}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
    </button>
  );
}

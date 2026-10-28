import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './PaymentTab.css';

interface PaymentTabProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

// A full-width disclosure button on the track page's payment section (update.md F.3): red icon chip
// and edge, chevron, closed by default. The panel stays mounted while closed so a form inside it
// (the proof form, G.3) keeps what was typed.
export const PaymentTab: React.FC<PaymentTabProps> = ({ icon, title, subtitle, children }) => {
  const panelId = `${useId()}-panel`;
  const [open, setOpen] = useState(false);

  return (
    <div className={`sdl-paytab${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="sdl-paytab-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sdl-paytab-chip" aria-hidden="true">{icon}</span>
        <span className="sdl-paytab-text">
          <span className="sdl-paytab-title">{title}</span>
          {subtitle && <span className="sdl-paytab-subtitle">{subtitle}</span>}
        </span>
        <ChevronDown className="sdl-paytab-chevron" size={20} aria-hidden="true" />
      </button>
      <div id={panelId} className="sdl-paytab-panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
};

export default PaymentTab;

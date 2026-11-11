import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...rest,
  };
}

export const ShieldMark = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 2.8 4.5 5.6v6.1c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V5.6L12 2.8Z" />
    <path d="M8.6 12.2c1.6-2.3 5.2-2.3 6.8 0-1.6 2.3-5.2 2.3-6.8 0Z" />
    <circle cx="12" cy="12.2" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

export const RadarIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <path d="M12 12 18.4 5.6" />
    <circle cx="16" cy="9" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const LeakIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5c3 3.6 5.5 6.6 5.5 9.5a5.5 5.5 0 0 1-11 0c0-2.9 2.5-5.9 5.5-9.5Z" />
    <path d="M9.5 14.2a2.6 2.6 0 0 0 2.5 2.3" />
  </svg>
);

export const GaugeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 17a8 8 0 1 1 16 0" />
    <path d="m12 17 4-5.5" />
  </svg>
);

export const BoltIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8Z" />
  </svg>
);

export const MessageIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5H4.5v-10Z" />
    <path d="M8.5 9.5h7M8.5 12.5h4" />
  </svg>
);

export const TicketIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5" y="3.5" width="14" height="17" rx="2" />
    <path d="M9 3.5v2h6v-2M8.5 10.5h7M8.5 14h7M8.5 17.5h4" />
  </svg>
);

export const BlockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m6 6 12 12" />
  </svg>
);

export const RefreshIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M19.5 12a7.5 7.5 0 0 1-13.2 4.9M4.5 12a7.5 7.5 0 0 1 13.2-4.9" />
    <path d="M17.8 3.5v3.7h-3.7M6.2 20.5v-3.7h3.7" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const ChevronIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const QuoteIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9.5 7.5H6.2c-.4 0-.7.3-.7.7v3.6c0 .4.3.7.7.7H9v.6c0 1.4-.9 2.6-2.2 3M18.5 7.5h-3.3c-.4 0-.7.3-.7.7v3.6c0 .4.3.7.7.7H18v.6c0 1.4-.9 2.6-2.2 3" />
  </svg>
);

export const AlertIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4 2.8 19.5h18.4L12 4Z" />
    <path d="M12 10v4.2M12 17h.01" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const InfoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z" />
    <path d="M12 10.5h.01M12 15h.01" />
  </svg>
);

export const CompareIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="7" height="14" rx="1.5" />
    <rect x="13.5" y="5" width="7" height="14" rx="1.5" />
  </svg>
);

export const MotionIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 12h4l3 7 4-14 3 7h4" />
  </svg>
);

export const PrinterIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 8.5V3.5h10v5" />
    <path d="M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5.5A1.5 1.5 0 0 1 5 8.5h14a1.5 1.5 0 0 1 1.5 1.5v5.5A1.5 1.5 0 0 1 19 17h-2" />
    <path d="M7 14h10v6.5H7z" />
  </svg>
);

export const LogoutIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14.5 4.5h3a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3" />
    <path d="M10 8.5 6.5 12l3.5 3.5M6.5 12H15" />
  </svg>
);

export const SunIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
  </svg>
);

export const MoonIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20.2 14.8A8 8 0 0 1 9.2 3.8a8 8 0 1 0 11 11Z" />
  </svg>
);

export const SearchIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);

/** The four sections of the rail. */
export const OverviewIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="7.5" height="10" rx="1.5" />
    <rect x="13" y="3.5" width="7.5" height="6" rx="1.5" />
    <rect x="13" y="11.5" width="7.5" height="9" rx="1.5" />
    <rect x="3.5" y="15.5" width="7.5" height="5" rx="1.5" />
  </svg>
);

export const ToolsIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8 12 3.5Z" />
    <path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" />
  </svg>
);

export const ReviewIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5" y="4.5" width="14" height="16" rx="2" />
    <path d="M9 4.5v-1h6v1M8.8 13l2.3 2.3 4.2-4.6" />
  </svg>
);

export const HeatmapIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
    <path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17" />
    <rect x="9.2" y="9.2" width="5.6" height="5.6" fill="currentColor" stroke="none" />
  </svg>
);

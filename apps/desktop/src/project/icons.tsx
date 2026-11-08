import type { ReactNode } from "react";

/** Drawn here rather than taken from emoji, which each operating system renders differently. */
function Icon({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const RenameIcon = () => (
  <Icon>
    <path d="M10.5 2.5l3 3L5 14H2v-3z" />
  </Icon>
);

export const MoveUpIcon = () => (
  <Icon>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Icon>
);

export const MoveDownIcon = () => (
  <Icon>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M2.5 4.5h11M6 4.5V2.5h4v2M4 4.5l.7 9h6.6l.7-9" />
  </Icon>
);

import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

const CELL_PADDING = "px-4 py-3";

export function Table({ className = "", ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={`w-full border-collapse text-sm ${className}`} {...props} />;
}

export function TableHeader(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

/** `ruled={false}` is for a matrix, where the cells themselves carry the grid. */
export function TableRow({
  ruled = true,
  className = "",
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { ruled?: boolean }) {
  return <tr className={`${ruled ? "border-b border-rule" : ""} ${className}`} {...props} />;
}

/** `padded={false}` is for a matrix, where the fill is the data and the cell sets its own padding. */
export function TableHead({
  padded = true,
  className = "",
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { padded?: boolean }) {
  return <th className={`${padded ? CELL_PADDING : ""} text-left text-xs font-normal text-muted ${className}`} {...props} />;
}

export function TableCell({
  padded = true,
  className = "",
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { padded?: boolean }) {
  return <td className={`${padded ? CELL_PADDING : ""} ${className}`} {...props} />;
}

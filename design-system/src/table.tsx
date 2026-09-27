import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@pytorch-ph/design-system/merge-classes";

export const Table = ({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) => <div className="relative w-full overflow-x-auto"><table className={cn("w-full caption-bottom text-left text-sm", className)} {...props} /></div>;
export const TableHeader = ({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) => <thead className={cn("bg-elevated text-muted [&_tr]:border-b", className)} {...props} />;
export const TableBody = ({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) => <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
export const TableRow = ({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) => <tr className={cn("border-b border-border transition-colors hover:bg-elevated", className)} {...props} />;
export const TableHead = ({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn("h-11 px-4 text-left align-middle font-semibold", className)} {...props} />;
export const TableCell = ({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
